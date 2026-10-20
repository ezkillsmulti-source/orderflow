import 'reflect-metadata';
import {
  afterAll,
  beforeAll,
  beforeEach,
  expect,
  it,
  jest,
} from '@jest/globals';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { ImagesService } from '../src/products/images/images.service.js';
import { IMAGE_DIRECTORY } from '../src/products/images/image.storage.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ENVIRONMENT } from '../src/config/config.module.js';
import { AUTH_CONFIGURATION } from '../src/auth/auth.configuration.js';
import { PasswordService } from '../src/auth/password.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import { createTestDatabase } from './support/test-database.js';
import { testAuthConfiguration } from './support/auth-configuration.js';

let db: Awaited<ReturnType<typeof createTestDatabase>>;
let app: NestExpressApplication;
let directory: string;
let token: string;
let actorId: string;
let id: string;
let cookie: string;
const origin = testAuthConfiguration.origins[0]!;
const password = 'synthetic inventory passphrase';
function sessionCookie(res: request.Response) {
  return res.headers['set-cookie']![0]!.split(';')[0]!;
}
function read(suffix = '', product = id) {
  return request(app.getHttpServer())
    .get(`/products/${product}/inventory${suffix}`)
    .set('Cookie', cookie);
}
beforeAll(async () => {
  db = await createTestDatabase();
  db.migrate();
  directory = await mkdtemp(join(tmpdir(), 'orderflow-inventory-images-'));
  actorId = (
    await db.client.user.create({
      data: {
        email: 'inventory@example.test',
        passwordHash: await new PasswordService().hash(password),
        role: 'ADMIN',
      },
    })
  ).id;
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENVIRONMENT)
    .useValue({ databaseUrl: db.databaseUrl, port: 3000 })
    .overrideProvider(IMAGE_DIRECTORY)
    .useValue(directory)
    .overrideProvider(AUTH_CONFIGURATION)
    .useValue(testAuthConfiguration)
    .compile();
  app = module.createNestApplication<NestExpressApplication>({ rawBody: true });
  await app.init();
});
beforeEach(async () => {
  jest.restoreAllMocks();
  // Administrative reset of this randomly named test database; immutability stays enabled.
  await db.client.$executeRawUnsafe(
    'TRUNCATE "InventoryAdjustment", "Product", "ProductImage", http_session, login_limit',
  );
  await db.client.user.update({
    where: { id: actorId },
    data: { active: true, role: 'ADMIN' },
  });
  id = (
    await db.client.product.create({
      data: {
        sku: 'INVENTORY',
        name: 'Inventory sample',
        priceMinor: 9007199254740991n,
      },
    })
  ).id;
  const anonymous = await request(app.getHttpServer())
    .get('/auth/csrf')
    .expect(200);
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .set('Cookie', sessionCookie(anonymous))
    .set('Origin', origin)
    .set('x-csrf-token', anonymous.body.csrfToken)
    .send({ email: 'inventory@example.test', password })
    .expect(200);
  cookie = sessionCookie(login);
  token = login.body.csrfToken;
});
afterAll(async () => {
  jest.restoreAllMocks();
  try {
    await app?.close();
  } finally {
    try {
      await db?.close();
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }
});

it('starts new products at zero without movements and preserves catalog serialization', async () => {
  await read().expect(200, {
    productId: id,
    onHand: '0',
    reserved: '0',
    available: '0',
  });
  const response = await read('/adjustments').expect(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body).toEqual({
    items: [],
    pagination: { limit: 25, hasMore: false, nextCursor: null },
  });
  const product = await request(app.getHttpServer())
    .get(`/products/${id}`)
    .set('Cookie', cookie)
    .expect(200);
  expect(product.body.priceMinor).toBe('9007199254740991');
  expect(product.body).not.toHaveProperty('onHand');
  expect(product.body).not.toHaveProperty('inventorySequence');
});
it('requires current authentication and permits both roles to read archives', async () => {
  await request(app.getHttpServer())
    .get(`/products/${id}/inventory`)
    .expect(401);
  await db.client.product.update({ where: { id }, data: { active: false } });
  await db.client.user.update({
    where: { id: actorId },
    data: { role: 'OPERATOR' },
  });
  await read().expect(200);
  await read('/adjustments').expect(200);
  const lookup = jest.spyOn(app.get(InventoryService), 'balance');
  await db.client.user.update({
    where: { id: actorId },
    data: { active: false },
  });
  await read().expect(401);
  expect(lookup).not.toHaveBeenCalled();
});
it.each([
  '?limit=0',
  '?limit=101',
  '?limit=01',
  '?limit=1&limit=2',
  '?before=0',
  '?before=-1',
  '?before=01',
  '?before=9007199254740992',
  '?before=1&before=2',
  '?before=1%0A',
  '?offset=0',
  '?sort=asc',
  '?limit[]=1',
])('rejects invalid history queries %s', async (query) => {
  await read(`/adjustments${query}`).expect(400);
});
it('validates IDs, queries and missing products', async () => {
  await read('', 'bad').expect(400);
  await read('', randomUUID()).expect(404);
  await read('/adjustments', randomUUID()).expect(404);
  await read('?limit=1').expect(400);
});
it('returns exact balances and enforces SQL numeric bounds', async () => {
  for (const value of [-1n, 9007199254740992n])
    await expect(
      db.client.product.update({ where: { id }, data: { onHand: value } }),
    ).rejects.toThrow();
  await db.client
    .$executeRaw`UPDATE "Product" SET "onHand"=9007199254740991 WHERE id=${id}::uuid`;
  await read().expect(200, {
    productId: id,
    onHand: '9007199254740991',
    reserved: '0',
    available: '9007199254740991',
  });
});
it('orders history by unique sequence, fetches limit+1 and excludes the cursor', async () => {
  await db.client.inventoryAdjustment.createMany({
    data: Array.from({ length: 30 }, (_, index) => ({
      productId: id,
      actorId,
      idempotencyKey: randomUUID(),
      sequence: BigInt(index + 1),
      delta: 1n,
      reason: 'Synthetic history',
      balanceAfter: BigInt(index + 1),
      createdAt: new Date(0),
    })),
  });
  const delegate = jest.spyOn(
    app.get(DatabaseService).client.inventoryAdjustment,
    'findMany',
  );
  const first = await read('/adjustments?limit=2').expect(200);
  expect(first.body.items.map((x: { sequence: string }) => x.sequence)).toEqual(
    ['30', '29'],
  );
  expect(first.body.pagination).toEqual({
    limit: 2,
    hasMore: true,
    nextCursor: '29',
  });
  expect(delegate).toHaveBeenCalledWith(
    expect.objectContaining({ take: 3, orderBy: { sequence: 'desc' } }),
  );
  await db.client.inventoryAdjustment.create({
    data: {
      productId: id,
      actorId,
      idempotencyKey: randomUUID(),
      sequence: 31n,
      delta: 1n,
      reason: 'Later',
      balanceAfter: 31n,
    },
  });
  const second = await read('/adjustments?limit=2&before=29').expect(200);
  expect(
    second.body.items.map((x: { sequence: string }) => x.sequence),
  ).toEqual(['28', '27']);
  const end = await read('/adjustments?before=1&limit=100').expect(200);
  expect(end.body.pagination).toEqual({
    limit: 100,
    hasMore: false,
    nextCursor: null,
  });
  expect(first.body.items[0]).not.toHaveProperty('idempotencyKey');
});
it('upgrades image-era products including archives without changing data or owner constraints', async () => {
  const upgrade = await createTestDatabase();
  try {
    upgrade.migrate('20261020000000_product_images');
    const productId = randomUUID();
    const imageId = randomUUID();
    await upgrade.client
      .$executeRaw`INSERT INTO "Product" (id,sku,name,"priceMinor",active,"updatedAt") VALUES (${productId}::uuid,'UPGRADE','Preserved',9007199254740991,false,'2026-01-01'::timestamptz)`;
    await upgrade.client.productImage.create({
      data: {
        id: imageId,
        productId,
        state: 'PUBLISHED',
        detailWidth: 10,
        detailHeight: 8,
        thumbnailWidth: 10,
        thumbnailHeight: 8,
        cleanupAfter: new Date(),
      },
    });
    await upgrade.client
      .$executeRaw`UPDATE "Product" SET "imageId"=${imageId}::uuid WHERE id=${productId}::uuid`;
    const before = await upgrade.client.$queryRaw`SELECT * FROM "Product"`;
    const images = await upgrade.client.productImage.findMany();
    upgrade.migrate();
    upgrade.migrate();
    const after = await upgrade.client.product.findUniqueOrThrow({
      where: { id: productId },
    });
    expect(after).toEqual({
      ...(before as object[])[0],
      onHand: 0n,
      inventorySequence: 0n,
    });
    expect(await upgrade.client.productImage.findMany()).toEqual(images);
    expect(await upgrade.client.inventoryAdjustment.count()).toBe(0);
    const other = await upgrade.client.product.create({
      data: { sku: 'OTHER', name: 'Other', priceMinor: 0n },
    });
    await expect(
      upgrade.client.product.update({
        where: { id: other.id },
        data: { imageId },
      }),
    ).rejects.toThrow();
  } finally {
    await upgrade.close();
  }
});

function adjust(
  body: unknown = { delta: '1', reason: 'Received' },
  key: string = randomUUID(),
  productId = id,
) {
  return request(app.getHttpServer())
    .post(`/products/${productId}/inventory/adjustments`)
    .set('Cookie', cookie)
    .set('Origin', origin)
    .set('x-csrf-token', token)
    .set('Idempotency-Key', key)
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(body));
}
function archive() {
  return request(app.getHttpServer())
    .post(`/products/${id}/archive`)
    .set('Cookie', cookie)
    .set('Origin', origin)
    .set('x-csrf-token', token);
}
async function state(productId = id) {
  return {
    product: await db.client.product.findUniqueOrThrow({
      where: { id: productId },
    }),
    movements: await db.client.inventoryAdjustment.findMany({
      where: { productId },
      orderBy: { sequence: 'asc' },
    }),
  };
}
function gate() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}
async function reached(wait: Promise<unknown>) {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([
      wait,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Synchronization deadline exceeded.')),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function blocked() {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    const [row] = await db.client.$queryRaw<
      { blocked: boolean }[]
    >`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%Product%') AS blocked`;
    if (row?.blocked) return;
  }
  throw new Error('Expected product lock wait was not observed.');
}

it('records exact normalized movements and compensations without touching catalog timestamps', async () => {
  const before = await state();
  const key = randomUUID();
  const created = await adjust(
    { delta: '9007199254740991', reason: '  Received 🦉  ' },
    key,
  ).expect(201);
  expect(created.headers['idempotency-replayed']).toBeUndefined();
  expect(created.body).toEqual({
    id: expect.any(String),
    productId: id,
    sequence: '1',
    delta: '9007199254740991',
    reason: 'Received 🦉',
    balanceAfter: '9007199254740991',
    actorId,
    createdAt: expect.any(String),
  });
  await read().expect(200, {
    productId: id,
    onHand: '9007199254740991',
    reserved: '0',
    available: '9007199254740991',
  });
  await adjust({
    delta: '-9007199254740991',
    reason: 'Compensating count correction',
  }).expect(201);
  const replay = await adjust(
    { delta: '9007199254740991', reason: 'Received 🦉' },
    key,
    id.toUpperCase(),
  ).expect(200, created.body);
  expect(replay.headers['idempotency-replayed']).toBe('true');
  const after = await state();
  expect(after.product.updatedAt).toEqual(before.product.updatedAt);
  expect(after.product.onHand).toBe(0n);
  expect(after.product.inventorySequence).toBe(2n);
  expect(after.movements).toHaveLength(2);
  expect(after.movements[0]!.createdAt.toISOString()).toBe(
    created.body.createdAt,
  );
  await archive().expect(200);
  await adjust(
    { delta: '9007199254740991', reason: 'Received 🦉' },
    key,
  ).expect(200, created.body);
  const archived = await state();
  await adjust().expect(409, {
    statusCode: 409,
    message: 'Archived products cannot be adjusted.',
  });
  expect(await state()).toEqual(archived);
});
it('rejects positive-stock archival without modifying catalog/image state and allows archival at zero', async () => {
  await adjust().expect(201);
  const before = await state();
  await archive().expect(409, {
    statusCode: 409,
    message: 'Products with positive stock cannot be archived.',
  });
  expect(await state()).toEqual(before);
  await expect(
    db.client.product.update({ where: { id }, data: { active: false } }),
  ).rejects.toThrow();
  await adjust({ delta: '-1', reason: 'Corrected before archival' }).expect(
    201,
  );
  const first = await archive().expect(200);
  await archive().expect(200, first.body);
});
it.each([
  null,
  [],
  {},
  { delta: '1' },
  { reason: 'Reason' },
  { delta: '1', reason: 'Valid', actorId: 'forged' },
  ...[
    '0',
    '-0',
    '+1',
    '01',
    '-01',
    '1.0',
    '1e2',
    ' 1',
    '1\n',
    '9007199254740992',
    '-9007199254740992',
    '1'.repeat(1000),
  ].map((delta) => ({ delta, reason: 'Reason' })),
  ...[1, null, true, {}, 1.5].map((delta) => ({ delta, reason: 'Reason' })),
  ...['', '  ', '\ud800', '\udc00', 'a\0b', '🦉'.repeat(501), null, 1].map(
    (reason) => ({ delta: '1', reason }),
  ),
])('rejects invalid adjustment without any writes: %#', async (body) => {
  const before = await state();
  await adjust(body).expect(400);
  expect(await state()).toEqual(before);
});
it('accepts exactly 500 reason code points, validates headers and rejects unknown queries', async () => {
  await adjust({ delta: '1', reason: ' 🦉'.slice(1).repeat(500) }).expect(201);
  const before = await state();
  for (const key of [
    '',
    randomUUID().toUpperCase(),
    '00000000-0000-1000-8000-000000000001',
    'x'.repeat(1000),
  ])
    await adjust(undefined, key).expect(400);
  const req = () =>
    request(app.getHttpServer())
      .post(`/products/${id}/inventory/adjustments`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('x-csrf-token', token);
  await req().send({ delta: '1', reason: 'Missing key' }).expect(400);
  await req()
    .set({ 'Idempotency-Key': [randomUUID(), randomUUID()] })
    .send({ delta: '1', reason: 'Repeated key header' })
    .expect(400);
  await req()
    .set('Idempotency-Key', randomUUID())
    .query({ extra: 'x' })
    .send({ delta: '1', reason: 'Unknown query' })
    .expect(400);
  expect(await state()).toEqual(before);
});
it('rejects malformed UTF-8, forms, oversized and malformed JSON while preserving state', async () => {
  const before = await state();
  const req = () =>
    request(app.getHttpServer())
      .post(`/products/${id}/inventory/adjustments`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('x-csrf-token', token)
      .set('Idempotency-Key', randomUUID());
  for (const bytes of [
    Buffer.concat([
      Buffer.from('{"delta":"1","reason":"'),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('"}'),
    ]),
    Buffer.from('{"reason":"private details",'),
  ])
    await req()
      .set('Content-Type', 'application/json')
      .serialize((b) => b)
      .send(bytes)
      .expect(400);
  await req().type('form').send('delta=1&reason=Reason').expect(400);
  await adjust({ delta: '1', reason: 'x'.repeat(110000) }).expect(413);
  expect(await state()).toEqual(before);
});
it('enforces current ADMIN authorization before validation, lookup or replays', async () => {
  const key = randomUUID();
  const created = await adjust(undefined, key).expect(201);
  const before = await state();
  const service = jest.spyOn(app.get(InventoryService), 'adjust');
  await db.client.user.update({
    where: { id: actorId },
    data: { role: 'OPERATOR' },
  });
  await adjust(undefined, key).expect(403);
  await adjust({}, key, 'bad').expect(403);
  expect(service).not.toHaveBeenCalled();
  await read().expect(200);
  await read('/adjustments').expect(200);
  await db.client.user.update({
    where: { id: actorId },
    data: { active: false },
  });
  await adjust(undefined, key).expect(401);
  expect(service).not.toHaveBeenCalled();
  expect(await state()).toEqual(before);
  expect(created.body.actorId).toBe(actorId);
});
it.each(['token', 'origin', 'anonymous'])(
  'rejects request protection/authentication failure: %s',
  async (kind) => {
    const before = await state();
    const csrf = await request(app.getHttpServer())
      .get('/auth/csrf')
      .expect(200);
    await request(app.getHttpServer())
      .post(`/products/${id}/inventory/adjustments`)
      .set('Cookie', kind === 'anonymous' ? sessionCookie(csrf) : cookie)
      .set('Origin', kind === 'origin' ? 'https://untrusted.example' : origin)
      .set(
        'x-csrf-token',
        kind === 'token'
          ? 'wrong'
          : kind === 'anonymous'
            ? csrf.body.csrfToken
            : token,
      )
      .set('Idempotency-Key', randomUUID())
      .send({ delta: '1', reason: 'Denied' })
      .expect(kind === 'anonymous' ? 401 : 403);
    expect(await state()).toEqual(before);
  },
);
it('rejects result underflow/overflow and sequence exhaustion without reserving keys', async () => {
  const key = randomUUID();
  const before = await state();
  await adjust({ delta: '-1', reason: 'Not enough' }, key).expect(409);
  expect(await state()).toEqual(before);
  await adjust({ delta: '9007199254740991', reason: 'Maximum' }).expect(201);
  const full = await state();
  await adjust().expect(409);
  expect(await state()).toEqual(full);
  await adjust({ delta: '-1', reason: 'Not enough' }, key).expect(201);
  await db.client
    .$executeRaw`UPDATE "Product" SET "inventorySequence"=9007199254740991 WHERE id=${id}::uuid`;
  const exhausted = await state();
  await adjust().expect(409);
  expect(await state()).toEqual(exhausted);
});
it('rolls back a balance update when SQL movement insertion fails, leaving the key usable', async () => {
  const before = await state();
  const key = randomUUID();
  await db.client.$executeRawUnsafe(
    `CREATE FUNCTION fail_inventory_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private insertion failure'; END; $$`,
  );
  await db.client.$executeRawUnsafe(
    'CREATE TRIGGER test_inventory_failure BEFORE INSERT ON "InventoryAdjustment" FOR EACH ROW EXECUTE FUNCTION fail_inventory_insert()',
  );
  try {
    await adjust(undefined, key).expect(500, {
      statusCode: 500,
      message: 'Internal server error.',
    });
    expect(await state()).toEqual(before);
  } finally {
    await db.client.$executeRawUnsafe(
      'DROP TRIGGER test_inventory_failure ON "InventoryAdjustment"',
    );
    await db.client.$executeRawUnsafe('DROP FUNCTION fail_inventory_insert()');
  }
  await adjust(undefined, key).expect(201);
});
it('enforces SQL immutability, foreign keys and numeric bounds without disabling triggers', async () => {
  const created = await adjust().expect(201);
  const before = await state();
  await expect(
    db.client.inventoryAdjustment.update({
      where: { id: created.body.id },
      data: { reason: 'Rewrite' },
    }),
  ).rejects.toThrow();
  await expect(db.client.inventoryAdjustment.deleteMany()).rejects.toThrow();
  await expect(
    db.client.user.delete({ where: { id: actorId } }),
  ).rejects.toThrow();
  await expect(db.client.product.delete({ where: { id } })).rejects.toThrow();
  const row = {
    productId: id,
    actorId,
    sequence: 2n,
    delta: 1n,
    reason: 'Valid',
    balanceAfter: 2n,
    idempotencyKey: randomUUID(),
  };
  for (const invalid of [
    { delta: 0n },
    { delta: 9007199254740992n },
    { balanceAfter: -1n },
    { balanceAfter: 9007199254740992n },
    { sequence: 0n },
    { sequence: 9007199254740992n },
    { reason: '' },
    { reason: ' '.repeat(10) },
    { reason: '🦉'.repeat(501) },
    { actorId: randomUUID() },
    { productId: randomUUID() },
    { idempotencyKey: '00000000-0000-1000-8000-000000000001' },
  ])
    await expect(
      db.client.inventoryAdjustment.create({ data: { ...row, ...invalid } }),
    ).rejects.toThrow();
  await expect(
    db.client.inventoryAdjustment.create({ data: { ...row, sequence: 1n } }),
  ).rejects.toThrow();
  expect(await state()).toEqual(before);
});

// Hold a real row lock until the competing SQL statement is observed waiting.
it.each([
  'decrement',
  'increment',
  'overflow',
  'same key',
  'different content',
] as const)(
  'serializes concurrent %s requests without lost updates',
  async (kind) => {
    if (kind === 'decrement') await adjust().expect(201);
    if (kind === 'overflow')
      await adjust({
        delta: '9007199254740990',
        reason: 'Near maximum',
      }).expect(201);
    const service = app.get(InventoryService);
    const original = service.lock.bind(service);
    const locked = gate(),
      release = gate();
    jest.spyOn(service, 'lock').mockImplementationOnce(async (...args) => {
      const row = await original(...args);
      locked.release();
      await release.wait;
      return row;
    });
    const key = randomUUID();
    const delta = kind === 'decrement' ? '-1' : '1';
    const body = { delta, reason: 'Concurrent' };
    const first = adjust(body, key).then((r) => r);
    let second: Promise<request.Response> | undefined;
    try {
      await reached(locked.wait);
      second = adjust(
        kind === 'different content' ? { ...body, reason: 'Different' } : body,
        kind === 'same key' || kind === 'different content'
          ? key
          : randomUUID(),
      ).then((r) => r);
      await blocked();
    } finally {
      release.release();
      await first;
      await second;
    }
    expect((await first).status).toBe(201);
    expect((await second)!.status).toBe(
      kind === 'same key'
        ? 200
        : ['decrement', 'overflow', 'different content'].includes(kind)
          ? 409
          : 201,
    );
    const stored = await state();
    expect(stored.product.onHand).toBe(
      kind === 'decrement'
        ? 0n
        : kind === 'overflow'
          ? 9007199254740991n
          : kind === 'increment'
            ? 2n
            : 1n,
    );
    expect(stored.movements).toHaveLength(
      ['decrement', 'overflow', 'increment'].includes(kind) ? 2 : 1,
    );
    if (kind === 'same key')
      expect((await second)!.body).toEqual((await first).body);
  },
);
it('resolves an actual cross-product unique-key race after rolling back the losing balance', async () => {
  const other = await db.client.product.create({
    data: { sku: 'OTHER', name: 'Other', priceMinor: 0n },
  });
  const service = app.get(InventoryService);
  const original = service.record.bind(service);
  const arrived = gate(),
    release = gate();
  let count = 0;
  jest.spyOn(service, 'record').mockImplementation(async (...args) => {
    if (++count === 2) arrived.release();
    await release.wait;
    return original(...args);
  });
  const key = randomUUID();
  const responses = Promise.all([
    adjust(undefined, key).then((r) => r),
    adjust(undefined, key, other.id).then((r) => r),
  ]);
  try {
    await reached(arrived.wait);
  } finally {
    release.release();
    await responses;
  }
  expect((await responses).map((r) => r.status).sort()).toEqual([201, 409]);
  const products = await db.client.product.findMany();
  expect(products.map((p) => p.onHand).sort()).toEqual([0n, 1n]);
  expect(products.map((p) => p.inventorySequence).sort()).toEqual([0n, 1n]);
  expect(await db.client.inventoryAdjustment.count()).toBe(1);
  const conflict = (await responses).find((r) => r.status === 409)!;
  expect(conflict.body).toEqual({
    statusCode: 409,
    message: 'Idempotency key conflicts with a previous adjustment.',
  });
});
it('keeps key namespaces independent between authenticated administrators', async () => {
  const key = randomUUID();
  await adjust(undefined, key).expect(201);
  const other = await db.client.user.create({
    data: {
      email: `${randomUUID()}@example.test`,
      passwordHash: await new PasswordService().hash(password),
      role: 'ADMIN',
    },
  });
  const csrf = await request(app.getHttpServer()).get('/auth/csrf').expect(200);
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .set('Cookie', sessionCookie(csrf))
    .set('Origin', origin)
    .set('x-csrf-token', csrf.body.csrfToken)
    .send({ email: other.email, password })
    .expect(200);
  const result = await request(app.getHttpServer())
    .post(`/products/${id}/inventory/adjustments`)
    .set('Cookie', sessionCookie(login))
    .set('Origin', origin)
    .set('x-csrf-token', login.body.csrfToken)
    .set('Idempotency-Key', key)
    .send({ delta: '1', reason: 'Received' })
    .expect(201);
  expect(result.body.actorId).toBe(other.id);
  expect((await state()).product.onHand).toBe(2n);
});
it.each(['adjustment first', 'archive first'] as const)(
  'serializes actual adjustment/archive locks: %s',
  async (order) => {
    if (order === 'adjustment first') {
      const service = app.get(InventoryService);
      const original = service.lock.bind(service);
      const locked = gate(),
        release = gate();
      jest.spyOn(service, 'lock').mockImplementationOnce(async (...args) => {
        const row = await original(...args);
        locked.release();
        await release.wait;
        return row;
      });
      const write = adjust().then((r) => r);
      let arch: Promise<request.Response> | undefined;
      try {
        await reached(locked.wait);
        arch = archive().then((r) => r);
        await blocked();
      } finally {
        release.release();
        await write;
        await arch;
      }
      expect((await write).status).toBe(201);
      expect((await arch)!.status).toBe(409);
      expect((await state()).product.active).toBe(true);
    } else {
      const locked = gate(),
        release = gate();
      const arch = db.client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${id}::uuid FOR UPDATE`;
        await tx.product.update({ where: { id }, data: { active: false } });
        locked.release();
        await release.wait;
      });
      let write: Promise<request.Response> | undefined;
      try {
        await reached(locked.wait);
        write = adjust().then((r) => r);
        await blocked();
      } finally {
        release.release();
        await arch;
        await write;
      }
      expect((await write)!.status).toBe(409);
      expect((await state()).movements).toHaveLength(0);
    }
  },
);
async function upload() {
  const bytes = await sharp({
    create: { width: 32, height: 24, channels: 3, background: '#7A3045' },
  })
    .png()
    .toBuffer();
  return request(app.getHttpServer())
    .put(`/products/${id}/image`)
    .set('Cookie', cookie)
    .set('Origin', origin)
    .set('x-csrf-token', token)
    .attach('image', bytes, {
      filename: 'synthetic.png',
      contentType: 'image/png',
    });
}
it.each(['inventory first', 'image first'] as const)(
  'coordinates images and inventory through the same row lock: %s',
  async (order) => {
    const service =
      order === 'inventory first'
        ? app.get(InventoryService)
        : app.get(ImagesService);
    const original = service.lock.bind(service);
    const locked = gate(),
      release = gate();
    jest.spyOn(service, 'lock').mockImplementationOnce(async (...args) => {
      const row = await original(...args);
      locked.release();
      await release.wait;
      return row;
    });
    const first =
      order === 'inventory first' ? adjust().then((r) => r) : upload();
    let second: Promise<request.Response> | undefined;
    try {
      await reached(locked.wait);
      second = order === 'inventory first' ? upload() : adjust().then((r) => r);
      await blocked();
    } finally {
      release.release();
      await first;
      await second;
    }
    expect((await first).status).toBe(order === 'inventory first' ? 201 : 200);
    expect((await second)!.status).toBe(
      order === 'inventory first' ? 200 : 201,
    );
    const stored = await state();
    expect(stored.product.onHand).toBe(1n);
    expect(stored.product.imageId).not.toBeNull();
    expect(stored.movements).toHaveLength(1);
    const previous = stored.product.imageId;
    await archive().expect(409);
    expect((await state()).product.imageId).toBe(previous);
    const descriptor = await request(app.getHttpServer())
      .get(`/products/${id}`)
      .set('Cookie', cookie)
      .expect(200);
    await request(app.getHttpServer())
      .get(descriptor.body.image.detail.url)
      .set('Cookie', cookie)
      .expect(200);
  },
);
it('does not disguise unrelated unique failures and sanitizes identified availability failures', async () => {
  const database = app.get(DatabaseService);
  const before = await state();
  for (const [code, meta, status, message] of [
    ['P2024', {}, 503, 'Inventory storage unavailable.'],
    ['P2010', { code: '57014' }, 503, 'Inventory storage unavailable.'],
    [
      'P2002',
      { modelName: 'InventoryAdjustment', target: ['id'] },
      500,
      'Internal server error.',
    ],
    ['P2021', {}, 500, 'Internal server error.'],
  ] as const) {
    const spy = jest
      .spyOn(database.client, '$transaction')
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError(
          'private submitted SQL details',
          { code, clientVersion: '7.10.1', meta },
        ),
      );
    await adjust().expect(status, { statusCode: status, message });
    spy.mockRestore();
  }
  expect(await state()).toEqual(before);
});

it('recovers a committed adjustment after an ambiguous database acknowledgement using the same key', async () => {
  const database = app.get(DatabaseService);
  const original = database.client.$transaction.bind(database.client);
  const key = randomUUID();
  const spy = jest
    .spyOn(database.client, '$transaction')
    .mockImplementationOnce(async (...args: Parameters<typeof original>) => {
      await original(...args);
      throw new Prisma.PrismaClientKnownRequestError(
        'private lost commit acknowledgement',
        { code: 'P1017', clientVersion: '7.10.1' },
      );
    });
  await adjust(undefined, key).expect(503, {
    statusCode: 503,
    message: 'Inventory storage unavailable.',
  });
  spy.mockRestore();
  expect((await state()).product.onHand).toBe(1n);
  const replay = await adjust(undefined, key).expect(200);
  expect(replay.headers['idempotency-replayed']).toBe('true');
  expect((await state()).movements).toHaveLength(1);
  expect((await state()).product.inventorySequence).toBe(1n);
});

it('bounds real product lock waits and leaves timed-out adjustments unchanged', async () => {
  const before = await state();
  const locked = gate(),
    release = gate();
  const hold = db.client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${id}::uuid FOR UPDATE`;
    locked.release();
    await release.wait;
  });
  let pending: Promise<request.Response> | undefined;
  try {
    await reached(locked.wait);
    pending = adjust().then((r) => r);
    await blocked();
    await reached(pending);
  } finally {
    release.release();
    await hold;
    await pending;
  }
  expect((await pending)!.status).toBe(503);
  expect((await pending)!.body).toEqual({
    statusCode: 503,
    message: 'Inventory storage unavailable.',
  });
  expect(await state()).toEqual(before);
});
