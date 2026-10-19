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
import { ProductStorageUnavailable } from '../src/products/product.errors.js';
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
        image: null,
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
        .serialize((body) => body) // Keep Buffer bytes; do not JSON-serialize them.
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
      await responses;
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

function edit(id: string, body: unknown) {
  return request(app.getHttpServer())
    .patch(`/products/${id}`)
    .set('Cookie', authenticated.cookie)
    .set('Origin', origin)
    .set('x-csrf-token', authenticated.token)
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(body));
}
function archive(id: string, body?: object) {
  return request(app.getHttpServer())
    .post(`/products/${id}/archive`)
    .set('Cookie', authenticated.cookie)
    .set('Origin', origin)
    .set('x-csrf-token', authenticated.token)
    .send(body);
}

describe('catalog editing and archival', () => {
  it('requires authentication for all catalog routes even with valid anonymous CSRF', async () => {
    const created = await create().expect(201);
    const before = await db.client.product.findMany();
    const anonymous = await request(app.getHttpServer())
      .get('/auth/csrf')
      .expect(200);
    const previous = authenticated;
    authenticated = {
      cookie: cookie(anonymous),
      token: anonymous.body.csrfToken as string,
    };
    try {
      await read().expect(401);
      await read(`/products/${created.body.id}`).expect(401);
      await create({ ...valid, sku: 'ANONYMOUS' }).expect(401);
      await edit(created.body.id, { name: 'Denied' }).expect(401);
      await archive(created.body.id).expect(401);
    } finally {
      authenticated = previous;
    }
    expect(await db.client.product.findMany()).toEqual(before);
  });
  it.each(['create', 'edit', 'archive'] as const)(
    'denies %s for a newly inactive user without writes',
    async (action) => {
      const created = await create().expect(201);
      const before = await db.client.product.findMany();
      await db.client.user.update({
        where: { id: userId },
        data: { active: false },
      });
      if (action === 'create')
        await create({ ...valid, sku: 'INACTIVE' }).expect(401);
      else if (action === 'edit')
        await edit(created.body.id, { name: 'Denied' }).expect(401);
      else await archive(created.body.id).expect(401);
      expect(await db.client.product.findMany()).toEqual(before);
    },
  );
  it('classifies a real refused PostgreSQL connection as catalog unavailability', async () => {
    const url = new URL(db.databaseUrl);
    url.port = '1';
    const unavailable = new DatabaseService({
      databaseUrl: url.toString(),
      port: 3000,
    });
    try {
      await expect(
        new ProductsService(unavailable).create({
          sku: 'UNAVAILABLE',
          name: 'No write',
          priceMinor: 0n,
        }),
      ).rejects.toBeInstanceOf(ProductStorageUnavailable);
    } finally {
      await unavailable.onApplicationShutdown();
    }
    expect(await db.client.product.count()).toBe(0);
  });

  it('edits only submitted fields, normalizes text, clears descriptions, and preserves exact prices', async () => {
    const created = await create({ ...valid, description: 'original' }).expect(
      201,
    );
    const changed = await edit(created.body.id, {
      name: '  Updated 🦉  ',
      priceMinor: '9007199254740991',
    }).expect(200);
    expect(changed.body).toEqual({
      ...created.body,
      name: 'Updated 🦉',
      priceMinor: '9007199254740991',
      updatedAt: expect.any(String),
    });
    const cleared = await edit(created.body.id, { description: null }).expect(
      200,
    );
    expect(cleared.body.description).toBeNull();
    expect(cleared.body.name).toBe('Updated 🦉');
    const zero = await edit(created.body.id, {
      priceMinor: '0',
      description: ' ',
    }).expect(200);
    expect(zero.body.priceMinor).toBe('0');
    expect(zero.body.description).toBeNull();
    const renamed = await edit(created.body.id, { sku: ' NEXT._-1 ' }).expect(
      200,
    );
    expect(renamed.body.sku).toBe('NEXT._-1');
    await create().expect(201); // Renaming releases the old SKU.
  });
  it.each([
    {},
    null,
    [],
    { active: true },
    { id: 'client' },
    { createdAt: 'now' },
    { stock: '1' },
    { name: ' ' },
    { name: '\ud800' },
    { description: '\udc00' },
    { description: '\0' },
    { name: 'x'.repeat(201) },
    { description: 'x'.repeat(2001) },
    { sku: 'a b' },
    { sku: null },
    { priceMinor: 0 },
    { priceMinor: '9007199254740992' },
    { priceMinor: '1\n' },
    { priceMinor: '-1' },
    { priceMinor: '1.5' },
    { priceMinor: '01' },
  ])(
    'rejects invalid PATCH without changing any persisted field: %#',
    async (body) => {
      const created = await create().expect(201);
      const before = await db.client.product.findMany();
      await edit(created.body.id, body).expect(400);
      expect(await db.client.product.findMany()).toEqual(before);
    },
  );
  it('denies operator mutations before lookups, applies role changes and rejects inactive users', async () => {
    const created = await create().expect(201);
    const before = await db.client.product.findMany();
    const service = app.get(ProductsService);
    const edits = jest.spyOn(service, 'edit');
    const archives = jest.spyOn(service, 'archive');
    await db.client.user.update({
      where: { id: userId },
      data: { role: 'OPERATOR' },
    });
    for (const id of [
      created.body.id,
      'not-a-uuid',
      '00000000-0000-0000-0000-000000000000',
    ]) {
      await edit(id, { name: 'Denied' }).expect(403);
      await archive(id).expect(403);
    }
    expect(edits).not.toHaveBeenCalled();
    expect(archives).not.toHaveBeenCalled();
    await db.client.user.update({
      where: { id: userId },
      data: { active: false },
    });
    await edit(created.body.id, { name: 'Denied' }).expect(401);
    expect(await db.client.product.findMany()).toEqual(before);
  });
  it.each(['patch', 'archive'] as const)(
    'preserves CSRF and Origin checks on %s',
    async (action) => {
      const created = await create().expect(201);
      const before = await db.client.product.findMany();
      for (const kind of [
        'missing token',
        'wrong token',
        'missing origin',
        'wrong origin',
      ]) {
        const req =
          action === 'patch'
            ? request(app.getHttpServer()).patch(`/products/${created.body.id}`)
            : request(app.getHttpServer()).post(
                `/products/${created.body.id}/archive`,
              );
        req.set('Cookie', authenticated.cookie);
        if (kind !== 'missing origin')
          req.set(
            'Origin',
            kind === 'wrong origin' ? 'https://evil.example' : origin,
          );
        if (kind !== 'missing token')
          req.set(
            'x-csrf-token',
            kind === 'wrong token' ? 'wrong' : authenticated.token,
          );
        await req
          .send(action === 'patch' ? { name: 'Denied' } : {})
          .expect(403);
        expect(await db.client.product.findMany()).toEqual(before);
      }
    },
  );
  it('rejects form bodies across catalog mutations without persisted changes', async () => {
    const created = await create().expect(201);
    const before = await db.client.product.findMany();
    const requests = [
      () => request(app.getHttpServer()).post('/products'),
      () => request(app.getHttpServer()).patch(`/products/${created.body.id}`),
      () =>
        request(app.getHttpServer()).post(
          `/products/${created.body.id}/archive`,
        ),
    ];
    for (const build of requests) {
      await build()
        .set('Cookie', authenticated.cookie)
        .set('Origin', origin)
        .set('x-csrf-token', authenticated.token)
        .type('form')
        .send('sku=FORM&name=%C3%28&priceMinor=0')
        .expect(400);
      expect(await db.client.product.findMany()).toEqual(before);
    }
  });
  it('rejects malformed UTF-8 PATCH even when parsed fields would otherwise be valid', async () => {
    const created = await create().expect(201);
    const before = await db.client.product.findMany();
    await request(app.getHttpServer())
      .patch(`/products/${created.body.id}`)
      .set('Cookie', authenticated.cookie)
      .set('Origin', origin)
      .set('x-csrf-token', authenticated.token)
      .set('Content-Type', 'application/json')
      .serialize((body) => body)
      .send(
        Buffer.concat([
          Buffer.from('{"name":"'),
          Buffer.from([0xc3, 0x28]),
          Buffer.from('"}'),
        ]),
      )
      .expect(400);
    expect(await db.client.product.findMany()).toEqual(before);
  });
  it('archives without deletion, reserves the SKU, and makes repeated archive a true no-op', async () => {
    const created = await create().expect(201);
    await db.client.product.update({
      where: { id: created.body.id },
      data: { updatedAt: new Date(0) },
    });
    const first = await archive(created.body.id).expect(200);
    expect(first.body.active).toBe(false);
    expect(first.body.updatedAt).not.toBe(new Date(0).toISOString());
    const before = await db.client.product.findMany();
    await archive(created.body.id, {}).expect(200, first.body);
    await edit(created.body.id, { name: 'Denied' }).expect(409);
    await edit(created.body.id, { active: true }).expect(400);
    await create().expect(409);
    expect(await db.client.product.findMany()).toEqual(before);
    const defaults = await read().expect(200);
    expect(defaults.body.items).toEqual([]);
    await db.client.user.update({
      where: { id: userId },
      data: { role: 'OPERATOR' },
    });
    await read(`/products/${created.body.id}`).expect(200, first.body);
    const all = await read('/products?status=archived').expect(200);
    expect(all.body.items).toEqual([first.body]);
  });
  it('rejects archive bodies with fields and handles malformed/missing mutation IDs without writes', async () => {
    const created = await create().expect(201);
    const before = await db.client.product.findMany();
    await archive(created.body.id, { active: false }).expect(400);
    await archive('bad-id').expect(400);
    await edit('bad-id', { name: 'New' }).expect(400);
    await archive('00000000-0000-0000-0000-000000000000').expect(404);
    await edit('00000000-0000-0000-0000-000000000000', { name: 'New' }).expect(
      404,
    );
    expect(await db.client.product.findMany()).toEqual(before);
    await request(app.getHttpServer())
      .delete(`/products/${created.body.id}`)
      .set('Cookie', authenticated.cookie)
      .set('Origin', origin)
      .set('x-csrf-token', authenticated.token)
      .expect(404);
    expect(await db.client.product.findMany()).toEqual(before);
  });
  it('rejects a conflicting SKU edit atomically, including against an archived product', async () => {
    const first = await create().expect(201);
    const second = await create({ ...valid, sku: 'OTHER' }).expect(201);
    await archive(first.body.id).expect(200);
    const before = await db.client.product.findMany({ orderBy: { id: 'asc' } });
    await edit(second.body.id, {
      sku: valid.sku,
      name: 'Must not change',
      priceMinor: '0',
    }).expect(409);
    expect(
      await db.client.product.findMany({ orderBy: { id: 'asc' } }),
    ).toEqual(before);
  });
  it('arbitrates concurrent edits competing for one SKU without partial updates', async () => {
    const products = [
      await create().expect(201),
      await create({ ...valid, sku: 'OTHER' }).expect(201),
    ];
    const service = app.get(ProductsService);
    const original = service.edit.bind(service);
    const arrived = gate();
    const release = gate();
    let count = 0;
    jest.spyOn(service, 'edit').mockImplementation(async (...args) => {
      if (++count === 2) arrived.release();
      await release.wait;
      return original(...args);
    });
    const pending = Promise.all(
      products.map((p) =>
        edit(p.body.id, { sku: 'COMPETING', name: 'Winner' }).then((r) => r),
      ),
    );
    try {
      await reached(arrived.wait);
    } finally {
      release.release();
      await pending;
    }
    const responses = await pending;
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = products[responses.findIndex((r) => r.status === 409)]!;
    await read(`/products/${loser.body.id}`).expect(200, loser.body);
    expect(await db.client.product.count({ where: { sku: 'COMPETING' } })).toBe(
      1,
    );
  });
  it('preserves submitted-field last-write-wins semantics during overlapping edits', async () => {
    const created = await create().expect(201);
    const service = app.get(ProductsService);
    const original = service.edit.bind(service);
    const arrived = gate();
    const release = gate();
    jest.spyOn(service, 'edit').mockImplementationOnce(async (...args) => {
      arrived.release();
      await release.wait;
      return original(...args);
    });
    const first = edit(created.body.id, { name: 'Last name' }).then((r) => r);
    try {
      await reached(arrived.wait);
      await edit(created.body.id, {
        name: 'Earlier name',
        description: 'Keep this',
        priceMinor: '0',
      }).expect(200);
    } finally {
      release.release();
      await first;
    }
    expect((await first).status).toBe(200);
    const final = await read(`/products/${created.body.id}`).expect(200);
    expect(final.body).toEqual({
      ...created.body,
      name: 'Last name',
      description: 'Keep this',
      priceMinor: '0',
      updatedAt: expect.any(String),
    });
  });
  it.each(['edit first', 'archive first'])(
    'serializes overlapping edit/archive requests: %s',
    async (order) => {
      const created = await create().expect(201);
      const service = app.get(ProductsService);
      const arrived = gate();
      const release = gate();
      const method = order === 'archive first' ? 'edit' : 'archive';
      if (method === 'edit') {
        const original = service.edit.bind(service);
        jest.spyOn(service, 'edit').mockImplementationOnce(async (...args) => {
          arrived.release();
          await release.wait;
          return original(...args);
        });
      } else {
        const original = service.archive.bind(service);
        jest
          .spyOn(service, 'archive')
          .mockImplementationOnce(async (...args) => {
            arrived.release();
            await release.wait;
            return original(...args);
          });
      }
      const pending = (
        method === 'edit'
          ? edit(created.body.id, { name: 'Edited' })
          : archive(created.body.id)
      ).then((r) => r);
      try {
        await reached(arrived.wait);
        await (
          method === 'edit'
            ? archive(created.body.id)
            : edit(created.body.id, { name: 'Edited' })
        ).expect(200);
      } finally {
        release.release();
        await pending;
      }
      expect((await pending).status).toBe(method === 'edit' ? 409 : 200);
      const stored = await db.client.product.findUniqueOrThrow({
        where: { id: created.body.id },
      });
      expect(stored.active).toBe(false);
      expect(stored.name).toBe(method === 'edit' ? valid.name : 'Edited');
    },
  );
  it('rechecks active after a blocked SQL edit follows an uncommitted archive', async () => {
    const created = await create().expect(201);
    const locked = gate();
    const release = gate();
    const transaction = db.client.$transaction(
      async (tx) => {
        await tx.product.update({
          where: { id: created.body.id },
          data: { active: false },
        });
        locked.release();
        await release.wait;
      },
      { timeout: 10000 },
    );
    let pending: Promise<request.Response> | undefined;
    try {
      await reached(locked.wait);
      pending = edit(created.body.id, { name: 'Must not change' }).then(
        (r) => r,
      );
      // Observe the actual lock wait, not elapsed time or a mocked database result.
      const deadline = Date.now() + 5000;
      while (true) {
        const [state] = await db.client.$queryRaw<{ blocked: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query LIKE '%UPDATE%Product%'
          ) AS blocked`;
        if (state?.blocked) break;
        if (Date.now() > deadline)
          throw new Error('SQL edit did not reach row lock');
      }
    } finally {
      release.release();
      await transaction;
      await pending;
    }
    expect((await pending)!.status).toBe(409);
    const stored = await db.client.product.findUniqueOrThrow({
      where: { id: created.body.id },
    });
    expect(stored.active).toBe(false);
    expect(stored.name).toBe(valid.name);
  });
  it('makes concurrent archive requests share the same persisted state and timestamp', async () => {
    const created = await create().expect(201);
    await db.client.product.update({
      where: { id: created.body.id },
      data: { updatedAt: new Date(0) },
    });
    const service = app.get(ProductsService);
    const original = service.archive.bind(service);
    const arrived = gate();
    const release = gate();
    let count = 0;
    jest.spyOn(service, 'archive').mockImplementation(async (...args) => {
      if (++count === 2) arrived.release();
      await release.wait;
      return original(...args);
    });
    const pending = Promise.all([
      archive(created.body.id).then((r) => r),
      archive(created.body.id).then((r) => r),
    ]);
    try {
      await reached(arrived.wait);
    } finally {
      release.release();
      await pending;
    }
    const [first, second] = await pending;
    expect(first!.status).toBe(200);
    expect(second!.status).toBe(200);
    expect(first!.body).toEqual(second!.body);
    await archive(created.body.id).expect(200, first!.body);
    expect(await db.client.product.count()).toBe(1);
  });
});
