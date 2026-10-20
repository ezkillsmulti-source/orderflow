import 'reflect-metadata';
import {
  afterAll,
  beforeAll,
  beforeEach,
  expect,
  it,
  jest,
} from '@jest/globals';
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
});
afterAll(async () => {
  jest.restoreAllMocks();
  try {
    await app?.close();
  } finally {
    await db?.close();
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
