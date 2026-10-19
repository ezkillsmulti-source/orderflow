import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  Controller,
  Get,
  Module,
  Req,
  Res,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request, Response } from 'express';
import request from 'supertest';
import { SessionModule } from '../src/auth/session.module.js';
import { SessionRuntime } from '../src/auth/session.runtime.js';
import {
  AUTH_CONFIGURATION,
  ABSOLUTE_LIFETIME_MS,
  IDLE_LIFETIME_MS,
} from '../src/auth/auth.configuration.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { ENVIRONMENT } from '../src/config/config.module.js';
import { createTestDatabase } from './support/test-database.js';
import { testAuthConfiguration } from './support/auth-configuration.js';

// Test-only routes exercise lifecycle without introducing application endpoints.
@Controller('probe')
class ProbeController {
  constructor(private readonly sessions: SessionRuntime) {}
  @Get('start')
  async start(@Req() req: Request) {
    req.session.userId = 'probe';
    await this.sessions.save(req);
    return { saved: true };
  }
  @Get('state')
  state(@Req() req: Request) {
    return { identified: req.session.userId === 'probe' };
  }
  @Get('end')
  async end(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.sessions.destroy(req, res);
    return { ended: true };
  }
}
@Module({ imports: [SessionModule], controllers: [ProbeController] })
class ProbeModule {}

let db: Awaited<ReturnType<typeof createTestDatabase>>;
const apps: INestApplication[] = [];
async function create(production = false) {
  const module = await Test.createTestingModule({ imports: [ProbeModule] })
    .overrideProvider(ENVIRONMENT)
    .useValue({ databaseUrl: db.databaseUrl, port: 3000 })
    .overrideProvider(AUTH_CONFIGURATION)
    .useValue({
      ...testAuthConfiguration,
      production,
      trustProxy: production ? ['loopback'] : false,
    })
    .compile();
  const app = module.createNestApplication();
  apps.push(app);
  await app.init();
  return app;
}
beforeAll(async () => {
  db = await createTestDatabase();
  db.migrate();
  await create();
  await create();
});
afterAll(async () => {
  try {
    for (const app of apps) await app.close();
  } finally {
    await db?.close();
  }
});
function cookie(response: { headers: Record<string, unknown> }): string {
  return (response.headers['set-cookie'] as string[])[0]!.split(';')[0]!;
}

describe('persistent session infrastructure', () => {
  it('persists across instances and destroys the server-side session', async () => {
    const started = await request(apps[0]!.getHttpServer())
      .get('/probe/start')
      .expect(200);
    expect(started.headers['cache-control']).toBe('no-store');
    expect(started.headers['set-cookie']![0]!).toMatch(/HttpOnly/);
    expect(started.headers['set-cookie']![0]!).toMatch(/SameSite=Lax/);
    await request(apps[1]!.getHttpServer())
      .get('/probe/state')
      .set('Cookie', cookie(started))
      .expect(200, { identified: true });
    const ended = await request(apps[0]!.getHttpServer())
      .get('/probe/end')
      .set('Cookie', cookie(started))
      .expect(200);
    expect(ended.headers['set-cookie']![0]!).toContain(
      'Expires=Thu, 01 Jan 1970',
    );
    await request(apps[1]!.getHttpServer())
      .get('/probe/state')
      .set('Cookie', cookie(started))
      .expect(200, { identified: false });
  });
  it.each(['idle', 'absolute', 'store expiry'])(
    'enforces %s expiration without sleeps',
    async (kind) => {
      await db.client.httpSession.deleteMany();
      const started = await request(apps[0]!.getHttpServer())
        .get('/probe/start')
        .expect(200);
      const row = (await db.client.httpSession.findMany())[0]!;
      if (kind === 'store expiry') {
        await db.client.httpSession.update({
          where: { sid: row.sid },
          data: { expire: new Date(0) },
        });
      } else {
        const sess = { ...(row.sess as Prisma.JsonObject) };
        sess[kind === 'idle' ? 'lastSeen' : 'createdAt'] =
          Date.now() -
          (kind === 'idle' ? IDLE_LIFETIME_MS : ABSOLUTE_LIFETIME_MS) -
          1000;
        await db.client.httpSession.update({
          where: { sid: row.sid },
          data: { sess },
        });
      }
      await request(apps[1]!.getHttpServer())
        .get('/probe/state')
        .set('Cookie', cookie(started))
        .expect(200, { identified: false });
    },
  );
  it('does not create uninitialized sessions', async () => {
    await db.client.httpSession.deleteMany();
    const response = await request(apps[0]!.getHttpServer())
      .get('/probe/state')
      .expect(200);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(await db.client.httpSession.count()).toBe(0);
  });
  it('does not resurrect a deleted session during activity renewal', async () => {
    await db.client.httpSession.deleteMany();
    await request(apps[0]!.getHttpServer()).get('/probe/start').expect(200);
    const row = (await db.client.httpSession.findMany())[0]!;
    const loaded = {
      sessionID: row.sid,
      session: row.sess,
    } as unknown as Request;
    await db.client.httpSession.deleteMany();
    expect(await apps[0]!.get(SessionRuntime).touch(loaded)).toBe(false);
    expect(await db.client.httpSession.count()).toBe(0);
  });
  it('fails closed on a real missing store table without runtime recreation', async () => {
    const started = await request(apps[0]!.getHttpServer())
      .get('/probe/start')
      .expect(200);
    await db.client.$executeRawUnsafe(
      'ALTER TABLE http_session RENAME TO unavailable_session',
    );
    try {
      const response = await request(apps[1]!.getHttpServer())
        .get('/probe/state')
        .set('Cookie', cookie(started))
        .expect(503);
      expect(response.body).toEqual({
        statusCode: 503,
        message: 'Authentication storage unavailable.',
      });
      await request(apps[1]!.getHttpServer()).get('/probe/start').expect(503);
    } finally {
      await db.client.$executeRawUnsafe(
        'ALTER TABLE unavailable_session RENAME TO http_session',
      );
    }
  });
  it('bounds cleanup batches and ignores live sessions', async () => {
    await db.client.httpSession.deleteMany();
    await db.client.httpSession.createMany({
      data: Array.from({ length: 501 }, (_, index) => ({
        sid: `expired-${index}`,
        sess: {},
        expire: new Date(0),
      })),
    });
    await db.client.httpSession.create({
      data: {
        sid: 'live',
        sess: {},
        expire: new Date(Date.now() + IDLE_LIFETIME_MS),
      },
    });
    await apps[0]!.get(SessionRuntime).cleanupExpired();
    expect(await db.client.httpSession.count()).toBe(2);
    expect(
      await db.client.httpSession.findUnique({ where: { sid: 'live' } }),
    ).not.toBeNull();
  });
  it('sets production cookie attributes and requires trusted HTTPS forwarding', async () => {
    const app = await create(true);
    await request(app.getHttpServer()).get('/probe/start').expect(403);
    const response = await request(app.getHttpServer())
      .get('/probe/start')
      .set('X-Forwarded-Proto', 'https')
      .expect(200);
    const header = response.headers['set-cookie']![0]! as string;
    expect(header).toMatch(/^__Host-orderflow.sid=/);
    for (const value of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax'])
      expect(header).toContain(value);
    expect(header).not.toContain('Domain=');
  });
});
