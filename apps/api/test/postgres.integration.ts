import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer, type Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ENVIRONMENT } from '../src/config/config.module.js';
import { DatabaseService } from '../src/database/database.service.js';

const name = `orderflow_test_${randomUUID().replaceAll('-', '')}`;
let admin: Client;
let app: INestApplication | undefined;
let database: DatabaseService;
let databaseCreationAttempted = false;
let databaseUrl: string;

beforeAll(async () => {
  const raw = process.env.TEST_DATABASE_ADMIN_URL;
  if (!raw)
    throw new Error(
      'TEST_DATABASE_ADMIN_URL is required; use a dedicated local/CI PostgreSQL server with CREATEDB permission.',
    );
  const url = new URL(raw);
  admin = new Client({
    connectionString: raw,
    connectionTimeoutMillis: 3000,
    query_timeout: 5000,
    statement_timeout: 5000,
  });
  await admin.connect();
  databaseCreationAttempted = true;
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  databaseUrl = url.toString();
  for (let attempt = 0; attempt < 2; attempt++) {
    execFileSync(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: 'pipe',
        timeout: 20000,
      },
    );
  }
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENVIRONMENT)
    .useValue({ databaseUrl, port: 3000 })
    .compile();
  app = module.createNestApplication();
  await app.init();
  database = app.get(DatabaseService);
});

afterAll(async () => {
  try {
    await app?.close();
  } finally {
    try {
      if (databaseCreationAttempted)
        await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await admin?.end();
    }
  }
});

describe('real PostgreSQL foundation', () => {
  it('applies the initial migration once and serves readiness through Prisma', async () => {
    await request(app!.getHttpServer())
      .get('/health/ready')
      .expect(200, { status: 'ok' });
    const migrations = await database.client.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    expect(migrations[0]?.count).toBe(1n);
  });

  it('persists exact monetary boundaries, defaults, uniqueness, and updates', async () => {
    const zero = await database.client.product.create({
      data: { sku: 'ZERO', name: 'Zero', priceMinor: 0n },
    });
    const max = await database.client.product.create({
      data: { sku: 'MAX', name: 'Maximum', priceMinor: 9007199254740991n },
    });
    expect(zero).toMatchObject({
      priceMinor: 0n,
      active: true,
      description: null,
    });
    expect(max.priceMinor).toBe(9007199254740991n);
    expect(zero.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(zero.createdAt).toBeInstanceOf(Date);
    expect(zero.updatedAt).toBeInstanceOf(Date);
    await expect(
      database.client.product.create({
        data: { sku: 'MAX', name: 'Duplicate', priceMinor: 1n },
      }),
    ).rejects.toThrow();
    for (const priceMinor of [-1n, 9007199254740992n]) {
      await expect(
        database.client.product.create({
          data: { sku: `INVALID_${priceMinor}`, name: 'Invalid', priceMinor },
        }),
      ).rejects.toThrow();
    }
    const updated = await database.client.product.update({
      where: { id: zero.id },
      data: { name: 'Updated' },
    });
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
      zero.updatedAt.getTime(),
    );
    expect(await database.client.product.count()).toBe(2);
  });

  it('becomes unready during a PostgreSQL outage and recovers', async () => {
    await admin.query(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS false`);
    try {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1',
        [name],
      );
      await request(app!.getHttpServer())
        .get('/health/ready')
        .expect(503, { status: 'not_ready' });
      await request(app!.getHttpServer())
        .get('/health/live')
        .expect(200, { status: 'ok' });
    } finally {
      await admin.query(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS true`);
    }
    await request(app!.getHttpServer())
      .get('/health/ready')
      .expect(200, { status: 'ok' });
  });

  it('releases PostgreSQL sessions when the application closes', async () => {
    const before = await admin.query(
      'SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = $1',
      [name],
    );
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENVIRONMENT)
      .useValue({ databaseUrl: databaseUrl, port: 3000 })
      .compile();
    const closingApp = module.createNestApplication();
    try {
      await closingApp.init();
      await request(closingApp.getHttpServer())
        .get('/health/ready')
        .expect(200);
      const connected = await admin.query(
        'SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = $1',
        [name],
      );
      expect(connected.rows[0].count).toBeGreaterThan(before.rows[0].count);
    } finally {
      await closingApp.close();
    }
    const after = await admin.query(
      'SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = $1',
      [name],
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it('returns 503 with bounded waiting for a real stalled TCP connection; liveness survives', async () => {
    // A real TCP peer that never completes the PostgreSQL handshake exercises
    // driver connection timeouts without depending on a particular unused port.
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing test listener');
    let failedApp: INestApplication | undefined;
    try {
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(ENVIRONMENT)
        .useValue({
          databaseUrl: `postgresql://test:placeholder@127.0.0.1:${address.port}/test`,
          port: 3000,
        })
        .compile();
      failedApp = module.createNestApplication();
      await failedApp.init();
      const start = performance.now();
      await request(failedApp.getHttpServer())
        .get('/health/ready')
        .expect(503, { status: 'not_ready' });
      expect(performance.now() - start).toBeLessThan(2500);
      await request(failedApp.getHttpServer())
        .get('/health/live')
        .expect(200, { status: 'ok' });
    } finally {
      for (const socket of sockets) socket.destroy();
      await failedApp?.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
