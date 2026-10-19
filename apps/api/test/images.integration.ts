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
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module.js';
import { ENVIRONMENT } from '../src/config/config.module.js';
import { AUTH_CONFIGURATION } from '../src/auth/auth.configuration.js';
import { PasswordService } from '../src/auth/password.service.js';
import {
  IMAGE_DIRECTORY,
  ImageStorage,
} from '../src/products/images/image.storage.js';
import { createTestDatabase } from './support/test-database.js';
import { testAuthConfiguration } from './support/auth-configuration.js';

let db: Awaited<ReturnType<typeof createTestDatabase>>;
let app: NestExpressApplication;
let directory: string;
let userId: string;
let id: string;
let cookie: string;
const origin = testAuthConfiguration.origins[0]!;
function sessionCookie(response: request.Response) {
  return response.headers['set-cookie']![0]!.split(';')[0]!;
}
function read(path: string) {
  return request(app.getHttpServer()).get(path).set('Cookie', cookie);
}
beforeAll(async () => {
  db = await createTestDatabase();
  try {
    db.migrate();
    directory = await mkdtemp(join(tmpdir(), 'orderflow-images-'));
    userId = (
      await db.client.user.create({
        data: {
          email: 'images@example.test',
          passwordHash: await new PasswordService().hash(
            'test image passphrase',
          ),
          role: 'ADMIN',
        },
      })
    ).id;
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENVIRONMENT)
      .useValue({ databaseUrl: db.databaseUrl, port: 3000 })
      .overrideProvider(AUTH_CONFIGURATION)
      .useValue(testAuthConfiguration)
      .overrideProvider(IMAGE_DIRECTORY)
      .useValue(directory)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    await app.init();
  } catch (error) {
    await app?.close();
    await db.close();
    if (directory) await rm(directory, { recursive: true, force: true });
    throw error;
  }
});
beforeEach(async () => {
  jest.restoreAllMocks();
  await db.client.product.deleteMany();
  await db.client.productImage.deleteMany();
  await db.client.httpSession.deleteMany();
  await db.client.loginLimit.deleteMany();
  await db.client.user.update({
    where: { id: userId },
    data: { role: 'ADMIN', active: true },
  });
  id = (
    await db.client.product.create({
      data: {
        sku: 'IMAGE',
        name: 'Image product',
        priceMinor: 9007199254740991n,
      },
    })
  ).id;
  const anonymous = await request(app.getHttpServer())
    .get('/auth/csrf')
    .expect(200);
  const result = await request(app.getHttpServer())
    .post('/auth/login')
    .set('Cookie', sessionCookie(anonymous))
    .set('Origin', origin)
    .set('x-csrf-token', anonymous.body.csrfToken)
    .send({ email: 'images@example.test', password: 'test image passphrase' })
    .expect(200);
  cookie = sessionCookie(result);
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
it('migrates existing products without changing monetary values and exposes no storage keys', async () => {
  const result = await read(`/products/${id}`).expect(200);
  expect(result.body.image).toBeNull();
  expect(result.body.priceMinor).toBe('9007199254740991');
  expect(result.body).not.toHaveProperty('imageId');
});
it('streams only the current version to authenticated current roles, including archived products', async () => {
  const version = randomUUID();
  const storage = app.get(ImageStorage);
  await storage.folder(version, true);
  const bytes = await sharp({
    create: { width: 10, height: 8, channels: 3, background: 'red' },
  })
    .webp()
    .toBuffer();
  await storage.write(version, 'detail', bytes);
  await storage.write(version, 'thumbnail', bytes);
  await db.client.productImage.create({
    data: {
      id: version,
      productId: id,
      state: 'PUBLISHED',
      detailWidth: 10,
      detailHeight: 8,
      thumbnailWidth: 10,
      thumbnailHeight: 8,
      cleanupAfter: new Date(),
    },
  });
  await db.client.product.update({
    where: { id },
    data: { imageId: version, active: false },
  });
  const product = await read(`/products/${id}`).expect(200);
  expect(product.body.image).toEqual({
    version,
    detail: {
      url: `/products/${id}/image/${version}/detail`,
      width: 10,
      height: 8,
    },
    thumbnail: {
      url: `/products/${id}/image/${version}/thumbnail`,
      width: 10,
      height: 8,
    },
  });
  const url = product.body.image.detail.url;
  await request(app.getHttpServer()).get(url).expect(401);
  await db.client.user.update({
    where: { id: userId },
    data: { role: 'OPERATOR' },
  });
  const result = await read(url).expect(200);
  expect(result.body).toEqual(bytes);
  expect(result.headers['content-type']).toBe('image/webp');
  expect(result.headers['cache-control']).toBe('private, no-store');
  expect(result.headers['x-content-type-options']).toBe('nosniff');
  expect(result.headers['cross-origin-resource-policy']).toBe('same-origin');
  await read(`/products/${id}/image/${randomUUID()}/detail`).expect(404);
  await read(`/products/${id}/image/${version}/source`).expect(400);
  await db.client.user.update({
    where: { id: userId },
    data: { active: false },
  });
  await read(url).expect(401);
});
it('returns a sanitized availability error for a missing current file', async () => {
  const image = await db.client.productImage.create({
    data: {
      productId: id,
      state: 'PUBLISHED',
      detailWidth: 1,
      detailHeight: 1,
      thumbnailWidth: 1,
      thumbnailHeight: 1,
      cleanupAfter: new Date(),
    },
  });
  await db.client.product.update({
    where: { id },
    data: { imageId: image.id },
  });
  await read(`/products/${id}/image/${image.id}/detail`).expect(503, {
    statusCode: 503,
    message: 'Product image storage unavailable.',
  });
});
