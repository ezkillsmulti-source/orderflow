import 'reflect-metadata';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  Controller,
  Get,
  Post,
  Req,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ENVIRONMENT } from '../src/config/config.module.js';
import {
  AUTH_CONFIGURATION,
  IDLE_LIFETIME_MS,
  ABSOLUTE_LIFETIME_MS,
} from '../src/auth/auth.configuration.js';
import { PasswordService } from '../src/auth/password.service.js';
import { SessionRuntime } from '../src/auth/session.runtime.js';
import { DatabaseService } from '../src/database/database.service.js';
import { LoginThrottle } from '../src/auth/login-throttle.js';
import { createTestDatabase } from './support/test-database.js';
import { testAuthConfiguration } from './support/auth-configuration.js';
import type { Prisma } from '../src/generated/prisma/client.js';

let mutations = 0;
@Controller('future-probe')
class FutureController {
  @Get() get(@Req() req: Request) {
    return { user: req.authenticatedUser };
  }
  @Post() post() {
    mutations++;
    return { changed: true };
  }
}
let db: Awaited<ReturnType<typeof createTestDatabase>>;
const apps: INestApplication[] = [];
const origin = testAuthConfiguration.origins[0]!;
const email = 'login@example.test';
const password = 'a test-only passphrase 🦉';
let userId: string;
async function create(proxy = false) {
  const module = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [FutureController],
  })
    .overrideProvider(ENVIRONMENT)
    .useValue({ databaseUrl: db.databaseUrl, port: 3000 })
    .overrideProvider(AUTH_CONFIGURATION)
    .useValue({
      ...testAuthConfiguration,
      trustProxy: proxy ? ['127.0.0.1/32', '::1/128'] : false,
    })
    .compile();
  const app = module.createNestApplication();
  apps.push(app);
  await app.init();
  return app;
}
function cookie(response: { headers: Record<string, unknown> }): string {
  return (response.headers['set-cookie'] as string[])[0]!.split(';')[0]!;
}
async function csrf(app = apps[0]!, previous?: string) {
  const req = request(app.getHttpServer())
    .get('/auth/csrf')
    .set('Origin', origin);
  if (previous) req.set('Cookie', previous);
  const response = await req.expect(200);
  expect(response.headers['cache-control']).toBe('no-store');
  return { cookie: cookie(response), token: response.body.csrfToken as string };
}
async function login(app = apps[0]!) {
  const anonymous = await csrf(app);
  const response = await request(app.getHttpServer())
    .post('/auth/login')
    .set('Origin', origin)
    .set('Cookie', anonymous.cookie)
    .set('x-csrf-token', anonymous.token)
    .send({ email, password })
    .expect(200);
  return {
    anonymous,
    cookie: cookie(response),
    token: response.body.csrfToken as string,
    response,
  };
}
beforeAll(async () => {
  db = await createTestDatabase();
  db.migrate();
  db.migrate();
  const user = await db.client.user.create({
    data: {
      email,
      passwordHash: await new PasswordService().hash(password),
      role: 'ADMIN',
    },
  });
  userId = user.id;
  await create();
  await create();
  await create(true);
});
beforeEach(async () => {
  jest.restoreAllMocks();
  mutations = 0;
  await db.client.httpSession.deleteMany();
  await db.client.loginLimit.deleteMany();
  await db.client.user.update({
    where: { id: userId },
    data: { active: true, role: 'ADMIN' },
  });
});
afterAll(async () => {
  jest.restoreAllMocks();
  try {
    for (const app of apps) await app.close();
  } finally {
    await db?.close();
  }
});

describe('session authentication HTTP contract with PostgreSQL', () => {
  it('shares the global admission budget and prevents new session allocation when exhausted', async () => {
    const throttle = apps[0]!.get(LoginThrottle);
    for (let count = 0; count < 200; count++) await throttle.admit();
    await request(apps[1]!.getHttpServer()).get('/auth/csrf').expect(429);
    expect(await db.client.httpSession.count()).toBe(0);
    await request(apps[1]!.getHttpServer())
      .get('/health/live')
      .expect(200, { status: 'ok' });
  });
  it('logs in, rotates identifiers/tokens, exposes only safe identity, and works across instances', async () => {
    const authenticated = await login();
    expect(authenticated.cookie).not.toBe(authenticated.anonymous.cookie);
    expect(authenticated.token).not.toBe(authenticated.anonymous.token);
    expect(authenticated.response.body).toEqual({
      user: { id: userId, email, role: 'ADMIN' },
      csrfToken: authenticated.token,
    });
    expect(authenticated.response.headers['cache-control']).toBe('no-store');
    for (const app of apps.slice(0, 2)) {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', authenticated.cookie)
        .expect(200, { user: { id: userId, email, role: 'ADMIN' } });
    }
    await request(apps[1]!.getHttpServer())
      .get('/auth/me')
      .set('Cookie', authenticated.anonymous.cookie)
      .expect(401);
    const rows = await db.client.httpSession.findMany();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]!.sess)).not.toContain(password);
    expect(JSON.stringify(rows[0]!.sess)).not.toContain('$argon2');
    expect(
      authenticated.response.headers['access-control-allow-origin'],
    ).toBeUndefined();
  });
  it.each(['wrong', 'missing', 'inactive'])(
    'uses the same generic credential response: %s',
    async (kind) => {
      if (kind === 'inactive')
        await db.client.user.update({
          where: { id: userId },
          data: { active: false },
        });
      const anonymous = await csrf();
      const verify = jest.spyOn(apps[0]!.get(PasswordService), 'verify');
      const response = await request(apps[0]!.getHttpServer())
        .post('/auth/login')
        .set('Origin', origin)
        .set('Cookie', anonymous.cookie)
        .set('x-csrf-token', anonymous.token)
        .send({
          email: kind === 'missing' ? 'absent@example.test' : email,
          password: kind === 'wrong' ? 'incorrect long passphrase' : password,
        })
        .expect(401);
      expect(response.body).toEqual({
        statusCode: 401,
        message: 'Invalid email or password.',
      });
      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify.mock.calls[0]![0]).toMatch(/^\$argon2id\$/);
      await request(apps[0]!.getHttpServer())
        .get('/auth/me')
        .set('Cookie', anonymous.cookie)
        .expect(401);
    },
  );
  it('invalidates logout in the shared store and requires a fresh CSRF flow to repeat', async () => {
    const authenticated = await login();
    const current = await csrf(apps[1]!, authenticated.cookie);
    expect(current.token).toBe(authenticated.token);
    await request(apps[1]!.getHttpServer())
      .post('/auth/logout')
      .set('Origin', origin)
      .set('Cookie', authenticated.cookie)
      .set('x-csrf-token', authenticated.anonymous.token)
      .expect(403);
    const ended = await request(apps[0]!.getHttpServer())
      .post('/auth/logout')
      .set('Origin', origin)
      .set('Cookie', authenticated.cookie)
      .set('x-csrf-token', current.token)
      .expect(204);
    expect(ended.headers['set-cookie']![0]!).toContain(
      'Expires=Thu, 01 Jan 1970',
    );
    await request(apps[1]!.getHttpServer())
      .get('/auth/me')
      .set('Cookie', authenticated.cookie)
      .expect(401);
    await request(apps[1]!.getHttpServer())
      .post('/auth/logout')
      .set('Origin', origin)
      .set('Cookie', authenticated.cookie)
      .set('x-csrf-token', current.token)
      .expect(403);
    const anonymous = await csrf(apps[1]!);
    await request(apps[1]!.getHttpServer())
      .post('/auth/logout')
      .set('Origin', origin)
      .set('Cookie', anonymous.cookie)
      .set('x-csrf-token', anonymous.token)
      .expect(204);
    expect(await db.client.httpSession.count()).toBe(0);
  });
  it.each([
    'missing token',
    'invalid token',
    'other session token',
    'missing origin',
    'disallowed origin',
  ])('rejects %s before login mutations', async (kind) => {
    const anonymous = await csrf();
    const verify = jest.spyOn(apps[0]!.get(PasswordService), 'verify');
    const req = request(apps[0]!.getHttpServer())
      .post('/auth/login')
      .set('Cookie', anonymous.cookie);
    if (kind !== 'missing origin')
      req.set(
        'Origin',
        kind === 'disallowed origin' ? 'https://evil.example' : origin,
      );
    if (kind !== 'missing token')
      req.set(
        'x-csrf-token',
        kind === 'invalid token'
          ? 'invalid'
          : kind === 'other session token'
            ? (await csrf(apps[1]!)).token
            : anonymous.token,
      );
    await req.send({ email, password }).expect(403);
    expect(verify).not.toHaveBeenCalled();
    await request(apps[0]!.getHttpServer())
      .get('/auth/me')
      .set('Cookie', anonymous.cookie)
      .expect(401);
  });
  it('protects future routes by default and validates CSRF before state changes', async () => {
    await request(apps[0]!.getHttpServer()).get('/future-probe').expect(401);
    const authenticated = await login();
    await request(apps[0]!.getHttpServer())
      .post('/future-probe')
      .set('Origin', origin)
      .set('Cookie', authenticated.cookie)
      .expect(403);
    expect(mutations).toBe(0);
    await request(apps[0]!.getHttpServer())
      .post('/future-probe')
      .set('Origin', origin)
      .set('Cookie', authenticated.cookie)
      .set('x-csrf-token', authenticated.token)
      .expect(201, { changed: true });
    expect(mutations).toBe(1);
  });
  it('validates bounded inputs and sanitizes malformed JSON before password work', async () => {
    const anonymous = await csrf();
    const verify = jest.spyOn(apps[0]!.get(PasswordService), 'verify');
    for (const body of [
      { email, password: 'x'.repeat(10000) },
      { email, password: 12 },
      { email: 'bad', password },
      { email, password, role: 'ADMIN' },
    ]) {
      await request(apps[0]!.getHttpServer())
        .post('/auth/login')
        .set('Origin', origin)
        .set('Cookie', anonymous.cookie)
        .set('x-csrf-token', anonymous.token)
        .send(body)
        .expect(400);
    }
    const invalid = await request(apps[0]!.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"password":"private-malformed-value",')
      .expect(400);
    expect(JSON.stringify(invalid.body)).not.toContain(
      'private-malformed-value',
    );
    expect(invalid.headers['cache-control']).toBe('no-store');
    expect(verify).not.toHaveBeenCalled();
  });
  it.each(['idle', 'absolute', 'database expiry'])(
    'rejects %s without real-time sleeps',
    async (kind) => {
      const authenticated = await login();
      const row = (await db.client.httpSession.findMany())[0]!;
      if (kind === 'database expiry')
        await db.client.httpSession.update({
          where: { sid: row.sid },
          data: { expire: new Date(0) },
        });
      else {
        const sess = {
          ...(row.sess as Prisma.JsonObject),
          [kind === 'idle' ? 'lastSeen' : 'createdAt']:
            Date.now() -
            (kind === 'idle' ? IDLE_LIFETIME_MS : ABSOLUTE_LIFETIME_MS) -
            1000,
        };
        await db.client.httpSession.update({
          where: { sid: row.sid },
          data: { sess },
        });
      }
      await request(apps[1]!.getHttpServer())
        .get('/auth/me')
        .set('Cookie', authenticated.cookie)
        .expect(401);
    },
  );
  it('renews idle activity without an upsert and caps expiry at the absolute deadline', async () => {
    const authenticated = await login();
    const row = (await db.client.httpSession.findMany())[0]!;
    const createdAt = Date.now() - ABSOLUTE_LIFETIME_MS + 90000;
    await db.client.httpSession.update({
      where: { sid: row.sid },
      data: {
        sess: {
          ...(row.sess as Prisma.JsonObject),
          createdAt,
          lastSeen: Date.now() - 10000,
        },
      },
    });
    const set = jest.spyOn(apps[1]!.get(SessionRuntime).store, 'set');
    await request(apps[1]!.getHttpServer())
      .get('/auth/me')
      .set('Cookie', authenticated.cookie)
      .expect(200);
    expect(set).not.toHaveBeenCalled();
    const after = await db.client.httpSession.findUniqueOrThrow({
      where: { sid: row.sid },
    });
    expect(after.expire.getTime()).toBeLessThanOrEqual(
      createdAt + ABSOLUTE_LIFETIME_MS + 1000,
    );
    expect((after.sess as { lastSeen: number }).lastSeen).toBeGreaterThan(
      (row.sess as { lastSeen: number }).lastSeen - 1000,
    );
  });
  it('reloads current roles and rejects deactivated users', async () => {
    const authenticated = await login();
    await db.client.user.update({
      where: { id: userId },
      data: { role: 'OPERATOR' },
    });
    await request(apps[1]!.getHttpServer())
      .get('/auth/me')
      .set('Cookie', authenticated.cookie)
      .expect(200, { user: { id: userId, email, role: 'OPERATOR' } });
    await db.client.user.update({
      where: { id: userId },
      data: { active: false },
    });
    await request(apps[0]!.getHttpServer())
      .get('/auth/me')
      .set('Cookie', authenticated.cookie)
      .expect(401);
    expect(await db.client.httpSession.count()).toBe(0);
  });
  it('fails closed on real store outages and leaves health public without session creation', async () => {
    const authenticated = await login();
    await db.client.$executeRawUnsafe(
      'ALTER TABLE http_session RENAME TO failed_session',
    );
    try {
      const failed = await request(apps[1]!.getHttpServer())
        .get('/auth/me')
        .set('Cookie', authenticated.cookie)
        .expect(503);
      expect(JSON.stringify(failed.body)).not.toMatch(
        /http_session|SELECT|Prisma|postgresql/,
      );
      const live = await request(apps[0]!.getHttpServer())
        .get('/health/live')
        .set('Cookie', authenticated.cookie)
        .expect(200, { status: 'ok' });
      expect(live.headers['set-cookie']).toBeUndefined();
    } finally {
      await db.client.$executeRawUnsafe(
        'ALTER TABLE failed_session RENAME TO http_session',
      );
    }
  });
  it('reports session-save, logout-destroy, and user-query failures as sanitized 503', async () => {
    const anonymous = await csrf();
    const runtime = apps[0]!.get(SessionRuntime);
    const set = jest
      .spyOn(runtime.store, 'set')
      .mockImplementation((_id, _data, done) =>
        done?.(new Error('private-store-error')),
      );
    const failed = await request(apps[0]!.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('Cookie', anonymous.cookie)
      .set('x-csrf-token', anonymous.token)
      .send({ email, password })
      .expect(503);
    expect(JSON.stringify(failed.body)).not.toContain('private-store-error');
    set.mockRestore();
    if (failed.headers['set-cookie']) {
      await request(apps[1]!.getHttpServer())
        .get('/auth/me')
        .set('Cookie', cookie(failed))
        .expect(401);
    }
    const authenticated = await login();
    const destroy = jest
      .spyOn(runtime.store, 'destroy')
      .mockImplementation((_id, done) =>
        done?.(new Error('private-destroy-error')),
      );
    await request(apps[0]!.getHttpServer())
      .post('/auth/logout')
      .set('Origin', origin)
      .set('Cookie', authenticated.cookie)
      .set('x-csrf-token', authenticated.token)
      .expect(503);
    destroy.mockRestore();
    const query = jest
      .spyOn(apps[1]!.get(DatabaseService).client.user, 'findUnique')
      .mockRejectedValue(new Error('private-driver-error'));
    const response = await request(apps[1]!.getHttpServer())
      .get('/auth/me')
      .set('Cookie', authenticated.cookie)
      .expect(503);
    expect(JSON.stringify(response.body)).not.toContain('private-driver-error');
    query.mockRestore();
  });
  it('does not authenticate after a transient failure of the explicit login save', async () => {
    const anonymous = await csrf();
    const runtime = apps[0]!.get(SessionRuntime);
    jest
      .spyOn(runtime.store, 'set')
      .mockImplementationOnce((_id, _data, done) =>
        done?.(new Error('private-transient-store-error')),
      );
    const failed = await request(apps[0]!.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('Cookie', anonymous.cookie)
      .set('x-csrf-token', anonymous.token)
      .send({ email, password })
      .expect(503);
    expect(await db.client.httpSession.count()).toBe(0);
    if (failed.headers['set-cookie'])
      await request(apps[1]!.getHttpServer())
        .get('/auth/me')
        .set('Cookie', cookie(failed))
        .expect(401);
  });
  it('does not recreate a revoked session through a delayed response-end save', async () => {
    const anonymous = await csrf();
    const runtime = apps[0]!.get(SessionRuntime);
    const set = runtime.store.set.bind(runtime.store);
    let saves = 0;
    jest.spyOn(runtime.store, 'set').mockImplementation((sid, state, done) => {
      if (++saves !== 2) return set(sid, state, done);
      // The first save committed. Another instance now performs logout's delete
      // before express-session's response-end save reaches PostgreSQL.
      void apps[1]!
        .get(SessionRuntime)
        .operation((deleted) =>
          apps[1]!.get(SessionRuntime).store.destroy(sid, deleted),
        )
        .then(
          () => set(sid, state, done),
          (error: unknown) => done?.(error),
        );
    });
    const authenticated = await request(apps[0]!.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('Cookie', anonymous.cookie)
      .set('x-csrf-token', anonymous.token)
      .send({ email, password })
      .expect(200);
    expect(saves).toBe(2);
    expect(await db.client.httpSession.count()).toBe(0);
    await request(apps[1]!.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookie(authenticated))
      .expect(401);
  });
  it('rejects a protected request whose renewal follows concurrent logout', async () => {
    const authenticated = await login();
    const runtime = apps[1]!.get(SessionRuntime);
    const touch = runtime.touch.bind(runtime);
    let markLoaded!: () => void;
    let release!: () => void;
    const loaded = new Promise<void>((resolve) => {
      markLoaded = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    jest.spyOn(runtime, 'touch').mockImplementationOnce(async (req) => {
      markLoaded();
      await released;
      return touch(req);
    });
    const pending = request(apps[1]!.getHttpServer())
      .get('/auth/me')
      .set('Cookie', authenticated.cookie)
      .then((response) => response);
    try {
      await loaded;
      await request(apps[0]!.getHttpServer())
        .post('/auth/logout')
        .set('Origin', origin)
        .set('Cookie', authenticated.cookie)
        .set('x-csrf-token', authenticated.token)
        .expect(204);
    } finally {
      release();
    }
    expect((await pending).status).toBe(401);
    expect(await db.client.httpSession.count()).toBe(0);
  });
  it('shares normalized account limits across instances and source IPs, before Argon2', async () => {
    const anonymous = await csrf(apps[2]!);
    const verify = jest.spyOn(apps[2]!.get(PasswordService), 'verify');
    for (let attempt = 0; attempt < 11; attempt++) {
      await request(apps[2]!.getHttpServer())
        .post('/auth/login')
        .set('Origin', origin)
        .set('X-Forwarded-For', `192.0.2.${attempt + 1}`)
        .set('Cookie', anonymous.cookie)
        .set('x-csrf-token', anonymous.token)
        .send({
          email: attempt % 2 ? 'ABSENT@EXAMPLE.TEST' : 'absent@example.test',
          password,
        })
        .expect(attempt < 10 ? 401 : 429);
    }
    expect(verify).toHaveBeenCalledTimes(10);
    const response = await request(apps[1]!.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('Cookie', anonymous.cookie)
      .set('x-csrf-token', anonymous.token)
      .send({ email: 'absent@example.test', password })
      .expect(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    await db.client.loginLimit.updateMany({
      data: { expire: BigInt(Date.now() - 1000) },
    });
    await request(apps[1]!.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .set('Cookie', anonymous.cookie)
      .set('x-csrf-token', anonymous.token)
      .send({ email: 'absent@example.test', password })
      .expect(401);
  });
  it('shares source-IP limits across instances and ignores untrusted forwarded addresses', async () => {
    const anonymous = await csrf();
    for (let attempt = 0; attempt < 31; attempt++) {
      await request(apps[attempt % 2]!.getHttpServer())
        .post('/auth/login')
        .set('Origin', origin)
        .set('X-Forwarded-For', `192.0.2.${attempt + 1}`)
        .set('Cookie', anonymous.cookie)
        .set('x-csrf-token', anonymous.token)
        .send({ email: `absent${attempt}@example.test`, password })
        .expect(attempt < 30 ? 401 : 429);
    }
  });
  it('does not bypass shared throttling on infrastructure failure', async () => {
    const anonymous = await csrf();
    await db.client.$executeRawUnsafe(
      'ALTER TABLE login_limit RENAME TO failed_limit',
    );
    try {
      const verify = jest.spyOn(apps[0]!.get(PasswordService), 'verify');
      await request(apps[0]!.getHttpServer())
        .post('/auth/login')
        .set('Origin', origin)
        .set('Cookie', anonymous.cookie)
        .set('x-csrf-token', anonymous.token)
        .send({ email, password })
        .expect(503);
      expect(verify).not.toHaveBeenCalled();
    } finally {
      await db.client.$executeRawUnsafe(
        'ALTER TABLE failed_limit RENAME TO login_limit',
      );
    }
  });
});
