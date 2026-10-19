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
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ENVIRONMENT } from '../src/config/config.module.js';
import { AUTH_CONFIGURATION } from '../src/auth/auth.configuration.js';
import { PasswordService } from '../src/auth/password.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import { ProductsService } from '../src/products/products.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { createTestDatabase } from './support/test-database.js';
import { testAuthConfiguration } from './support/auth-configuration.js';

let db: Awaited<ReturnType<typeof createTestDatabase>>;
let app: NestExpressApplication;
let userId: string;
let authenticated: { cookie: string; token: string };
const origin = testAuthConfiguration.origins[0]!;
const password = 'catalog test-only passphrase';
const valid = { sku: 'CAF-001', name: 'Coffee', priceMinor: '125000' };
function cookie(response: { headers: Record<string, unknown> }): string {
  return (response.headers['set-cookie'] as string[])[0]!.split(';')[0]!;
}
function read(path = '/products') {
  return request(app.getHttpServer())
    .get(path)
    .set('Cookie', authenticated.cookie);
}
function create(body: unknown = valid) {
  return request(app.getHttpServer())
    .post('/products')
    .set('Cookie', authenticated.cookie)
    .set('Origin', origin)
    .set('x-csrf-token', authenticated.token)
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(body));
}
async function login() {
  const anonymous = await request(app.getHttpServer())
    .get('/auth/csrf')
    .expect(200);
  const result = await request(app.getHttpServer())
    .post('/auth/login')
    .set('Cookie', cookie(anonymous))
    .set('Origin', origin)
    .set('x-csrf-token', anonymous.body.csrfToken)
    .send({ email: 'catalog@example.test', password })
    .expect(200);
  return { cookie: cookie(result), token: result.body.csrfToken as string };
}
async function reached(promise: Promise<void>): Promise<void> {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Synchronization deadline exceeded')),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function gate() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}
beforeAll(async () => {
  db = await createTestDatabase();
  try {
    db.migrate();
    userId = (
      await db.client.user.create({
        data: {
          email: 'catalog@example.test',
          passwordHash: await new PasswordService().hash(password),
          role: 'ADMIN',
        },
      })
    ).id;
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENVIRONMENT)
      .useValue({ databaseUrl: db.databaseUrl, port: 3000 })
      .overrideProvider(AUTH_CONFIGURATION)
      .useValue(testAuthConfiguration)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    await app.init();
  } catch (error) {
    await app?.close();
    throw error;
  }
});
beforeEach(async () => {
  jest.restoreAllMocks();
  await db.client.product.deleteMany();
  await db.client.httpSession.deleteMany();
  await db.client.loginLimit.deleteMany();
  await db.client.user.update({
    where: { id: userId },
    data: { active: true, role: 'ADMIN' },
  });
  authenticated = await login();
});
afterAll(async () => {
  jest.restoreAllMocks();
  try {
    await app?.close();
  } finally {
    await db?.close();
  }
});

describe('catalog creation and reads', () => {
  it('creates normalized safe representations and preserves exact monetary boundaries', async () => {
    for (const priceMinor of ['0', '9007199254740991']) {
      const response = await create({
        sku: ` ${priceMinor} `,
        name: '  Coffee 🦉  ',
        description: '  bag  ',
        priceMinor,
      }).expect(201);
      expect(response.headers.location).toBe(`/products/${response.body.id}`);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toEqual({
        id: expect.any(String),
        sku: priceMinor,
        name: 'Coffee 🦉',
        description: 'bag',
        priceMinor,
        active: true,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      await read(`/products/${response.body.id}`).expect(200, response.body);
      expect(
        (
          await db.client.product.findUniqueOrThrow({
            where: { id: response.body.id },
          })
        ).priceMinor,
      ).toBe(BigInt(priceMinor));
    }
  });
  it('normalizes optional and empty descriptions and counts Unicode code points', async () => {
    const first = await create({
      ...valid,
      name: '🦉'.repeat(200),
      description: ' ',
    }).expect(201);
    expect(first.body.description).toBeNull();
    const second = await create({ ...valid, sku: 'OTHER' }).expect(201);
    expect(second.body.description).toBeNull();
    await create({ ...valid, sku: 'NULL', description: null }).expect(201);
    await create({
      ...valid,
      sku: 'A'.repeat(64),
      description: '🦉'.repeat(2000),
    }).expect(201);
  });
  it.each([
    null,
    [],
    {},
    { ...valid, active: false },
    { ...valid, id: 'client-id' },
    { ...valid, updatedAt: 'now' },
    { ...valid, sku: '' },
    { ...valid, sku: '-ABC' },
    { ...valid, sku: 'a b' },
    { ...valid, sku: 'é' },
    { ...valid, sku: 'a'.repeat(65) },
    { ...valid, sku: 1 },
    { ...valid, name: ' ' },
    { ...valid, name: null },
    { ...valid, name: '🦉'.repeat(201) },
    { ...valid, name: '\ud800' },
    { ...valid, name: '\udc00' },
    { ...valid, name: 'x\0y' },
    { ...valid, description: '\ud800' },
    { ...valid, description: 1 },
    { ...valid, description: 'x'.repeat(2001) },
    ...[
      '',
      '01',
      '+1',
      '-1',
      '1.0',
      '1e2',
      ' 1',
      '1 ',
      '1\n',
      '9007199254740992',
      '1'.repeat(1000),
    ].map((priceMinor) => ({ ...valid, priceMinor })),
    ...[0, 1.5, null, true, {}].map((priceMinor) => ({ ...valid, priceMinor })),
  ])('rejects invalid creation without writes: %#', async (body) => {
    // Send JSON text so null is not interpreted as an absent Supertest body.
    await request(app.getHttpServer())
      .post('/products')
      .set('Cookie', authenticated.cookie)
      .set('Origin', origin)
      .set('x-csrf-token', authenticated.token)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(body))
      .expect(400);
    expect(await db.client.product.count()).toBe(0);
  });
  it('rejects malformed UTF-8, malformed JSON, and oversized bodies without writes', async () => {
    for (const body of [
      Buffer.concat([
        Buffer.from('{"name":"'),
        Buffer.from([0xc3, 0x28]),
        Buffer.from('","sku":"UTF8","priceMinor":"0"}'),
      ]),
      Buffer.from('{"private":"broken",'),
    ]) {
      const response = await request(app.getHttpServer())
        .post('/products')
        .set('Cookie', authenticated.cookie)
        .set('Origin', origin)
        .set('x-csrf-token', authenticated.token)
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(400);
      expect(response.body).toEqual({
        statusCode: 400,
        message: 'Invalid request.',
      });
    }
    await create({ ...valid, description: 'x'.repeat(110000) }).expect(413);
    expect(await db.client.product.count()).toBe(0);
  });
  it('enforces authentication, current roles and inactive users before product access', async () => {
    await request(app.getHttpServer()).get('/products').expect(401);
    const product = await create().expect(201);
    const service = app.get(ProductsService);
    const lookup = jest.spyOn(service, 'get');
    const write = jest.spyOn(service, 'create');
    await db.client.user.update({
      where: { id: userId },
      data: { role: 'OPERATOR' },
    });
    await create({ ...valid, sku: 'DENIED' }).expect(403);
    expect(write).not.toHaveBeenCalled();
    await read(`/products/${product.body.id}`).expect(200);
    await db.client.user.update({
      where: { id: userId },
      data: { active: false },
    });
    lookup.mockClear();
    await read(`/products/${product.body.id}`).expect(401);
    expect(lookup).not.toHaveBeenCalled();
    expect(await db.client.product.findMany()).toHaveLength(1);
  });
  it.each([
    'missing token',
    'wrong token',
    'other token',
    'missing origin',
    'wrong origin',
  ])('rejects %s before catalog mutations', async (kind) => {
    const before = await db.client.product.findMany();
    const req = request(app.getHttpServer())
      .post('/products')
      .set('Cookie', authenticated.cookie);
    if (kind !== 'missing origin')
      req.set(
        'Origin',
        kind === 'wrong origin' ? 'https://evil.example' : origin,
      );
    if (kind !== 'missing token') {
      const other =
        kind === 'other token'
          ? await request(app.getHttpServer()).get('/auth/csrf').expect(200)
          : undefined;
      req.set(
        'x-csrf-token',
        kind === 'wrong token'
          ? 'wrong'
          : (other?.body.csrfToken ?? authenticated.token),
      );
    }
    await req.send(valid).expect(403);
    expect(await db.client.product.findMany()).toEqual(before);
  });
  it('keeps SKU uniqueness across archived products and preserves case sensitivity', async () => {
    const product = await create().expect(201);
    await db.client.product.update({
      where: { id: product.body.id },
      data: { active: false },
    });
    const before = await db.client.product.findMany();
    await create({ ...valid, sku: ' CAF-001 ' }).expect(409, {
      statusCode: 409,
      message: 'Product conflict.',
    });
    expect(await db.client.product.findMany()).toEqual(before);
    await create({ ...valid, sku: 'caf-001' }).expect(201);
  });
  it('arbitrates duplicate SKU races in PostgreSQL', async () => {
    const service = app.get(ProductsService);
    const original = service.create.bind(service);
    const arrived = gate();
    const release = gate();
    let count = 0;
    jest.spyOn(service, 'create').mockImplementation(async (data) => {
      if (++count === 2) arrived.release();
      await release.wait;
      return original(data);
    });
    const responses = Promise.all([
      create().then((r) => r),
      create().then((r) => r),
    ]);
    try {
      await reached(arrived.wait);
    } finally {
      release.release();
    }
    expect((await responses).map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.client.product.count()).toBe(1);
  });
  it('validates IDs and handles missing products', async () => {
    await read('/products/not-a-uuid').expect(400);
    await read('/products/00000000-0000-0000-0000-000000000000%0A').expect(400);
    await read('/products/00000000-0000-0000-0000-000000000000').expect(404);
  });
  it.each([
    'limit=0',
    'limit=101',
    'limit=-1',
    'limit=1.5',
    'limit=01',
    'limit=',
    'limit=1%0A',
    'offset=-1',
    'offset=10001',
    'offset=1e2',
    'status=',
    'status=ACTIVE',
    'search=x',
    'limit=1&limit=2',
    'status=all&status=active',
    'offset=0&offset=1',
    'limit[]=1',
  ])('rejects invalid query %s', async (query) => {
    await read(`/products?${query}`).expect(400);
  });
  it('filters before bounded deterministic pagination and lets operators read archives', async () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    await db.client.product.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
        sku: `SKU-${i}`,
        name: 'Same',
        priceMinor: 0n,
        active: i % 2 === 0,
        createdAt,
      })),
    });
    await db.client.user.update({
      where: { id: userId },
      data: { role: 'OPERATOR' },
    });
    const defaults = await read().expect(200);
    expect(defaults.body.items).toHaveLength(15);
    expect(
      defaults.body.items.every((p: { active: boolean }) => p.active),
    ).toBe(true);
    expect(defaults.body.pagination).toEqual({
      limit: 25,
      offset: 0,
      hasMore: false,
    });
    const first = await read('/products?status=all').expect(200);
    expect(first.body.items).toHaveLength(25);
    expect(first.body.pagination).toEqual({
      limit: 25,
      offset: 0,
      hasMore: true,
    });
    const page = await read(
      '/products?status=archived&limit=2&offset=1',
    ).expect(200);
    expect(page.body.items.map((p: { sku: string }) => p.sku)).toEqual([
      'SKU-3',
      'SKU-5',
    ]);
    expect(page.body.pagination).toEqual({
      limit: 2,
      offset: 1,
      hasMore: true,
    });
    await read(`/products/${page.body.items[0].id}`).expect(
      200,
      page.body.items[0],
    );
    const empty = await read(
      '/products?status=all&limit=100&offset=10000',
    ).expect(200);
    expect(empty.body).toEqual({
      items: [],
      pagination: { limit: 100, offset: 10000, hasMore: false },
    });
    const find = jest.spyOn(
      app.get(DatabaseService).client.product,
      'findMany',
    );
    await read('/products?limit=1').expect(200);
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
        skip: 0,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
  });
  it('maps only identified catalog database errors and sanitizes unexpected failures', async () => {
    const delegate = app.get(DatabaseService).client.product;
    for (const [code, meta, status, message] of [
      ['P2024', {}, 503, 'Product storage unavailable.'],
      [
        'P2002',
        { modelName: 'Product', target: ['id'] },
        500,
        'Internal server error.',
      ],
      ['P2021', {}, 500, 'Internal server error.'],
    ] as const) {
      const spy = jest.spyOn(delegate, 'create').mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('private driver details', {
          code,
          clientVersion: '7.10.1',
          meta,
        }),
      );
      await create().expect(status, { statusCode: status, message });
      spy.mockRestore();
    }
    expect(await db.client.product.count()).toBe(0);
  });
});
