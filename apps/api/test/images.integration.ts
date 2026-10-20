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
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
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
import { ImagesService } from '../src/products/images/images.service.js';
import { ImageProcessor } from '../src/products/images/image.processor.js';
import { ImageCleanup } from '../src/products/images/image.cleanup.js';
import { ImageUnavailable } from '../src/products/images/image.errors.js';
import { DatabaseService } from '../src/database/database.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { createTestDatabase } from './support/test-database.js';
import { testAuthConfiguration } from './support/auth-configuration.js';

let db: Awaited<ReturnType<typeof createTestDatabase>>;
let app: NestExpressApplication;
let directory: string;
let userId: string;
let id: string;
let cookie: string;
let token: string;
const origin = testAuthConfiguration.origins[0]!;
function sessionCookie(response: request.Response) {
  return response.headers['set-cookie']![0]!.split(';')[0]!;
}
function read(path: string) {
  return request(app.getHttpServer()).get(path).set('Cookie', cookie);
}
beforeAll(async () => {
  db = await createTestDatabase();
  // Jest runs afterAll even when setup fails; one owner closes each resource.
  db.migrate();
  directory = await mkdtemp(join(tmpdir(), 'orderflow-images-'));
  userId = (
    await db.client.user.create({
      data: {
        email: 'images@example.test',
        passwordHash: await new PasswordService().hash('test image passphrase'),
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
  await app.listen(0, '127.0.0.1');
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
  token = result.body.csrfToken;
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

function mutate(method: 'put' | 'delete' = 'put', product = id) {
  const agent = request(app.getHttpServer());
  return agent[method](`/products/${product}/image`)
    .set('Cookie', cookie)
    .set('Origin', origin)
    .set('x-csrf-token', token);
}
async function fixture(format: 'jpeg' | 'png' | 'webp' = 'png') {
  return sharp({
    create: { width: 640, height: 400, channels: 3, background: 'blue' },
  })
    .toFormat(format)
    .toBuffer();
}
async function upload(bytes?: Buffer) {
  return mutate().attach('image', bytes ?? (await fixture()), {
    filename: 'ignored.png',
    contentType: 'image/png',
  });
}
function gate() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}
async function reached(promise: Promise<void>) {
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

it('publishes normalized variants, strips metadata, keeps exact money, and retires replacements', async () => {
  const bytes = await sharp(await fixture())
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const first = await mutate()
    .attach('image', bytes, {
      filename: '../../client.jpg',
      contentType: 'image/jpeg',
    })
    .expect(200);
  expect(first.body.priceMinor).toBe('9007199254740991');
  expect(first.body.image.detail).toEqual({
    width: 400,
    height: 640,
    url: expect.any(String),
  });
  const response = await read(first.body.image.detail.url).expect(200);
  const metadata = await sharp(response.body).metadata();
  expect(metadata.format).toBe('webp');
  expect(metadata.orientation).toBeUndefined();
  expect(metadata.exif).toBeUndefined();
  expect(metadata.icc).toBeUndefined();
  expect(metadata.xmp).toBeUndefined();
  const thumb = await read(first.body.image.thumbnail.url).expect(200);
  expect((await sharp(thumb.body).metadata()).height).toBe(320);
  const second = await upload();
  expect(second.status).toBe(200);
  expect(second.body.image.version).not.toBe(first.body.image.version);
  await read(first.body.image.detail.url).expect(404);
  expect(
    (
      await db.client.productImage.findUniqueOrThrow({
        where: { id: first.body.image.version },
      })
    ).state,
  ).toBe('RETIRED');
  const stored = await app
    .get(ImageStorage)
    .read(second.body.image.version, 'detail');
  await stored.file.close();
});
it('enforces current-role authorization, authentication, origin, and CSRF before multipart processing', async () => {
  const prepare = jest.spyOn(app.get(ImagesService), 'prepare');
  await request(app.getHttpServer())
    .put(`/products/${id}/image`)
    .set('Origin', origin)
    .expect(403);
  for (const kind of ['csrf', 'origin']) {
    await request(app.getHttpServer())
      .put(`/products/${id}/image`)
      .set('Cookie', cookie)
      .set('Origin', kind === 'origin' ? 'https://evil.example' : origin)
      .set('x-csrf-token', kind === 'csrf' ? 'invalid' : token)
      .attach('image', await fixture(), 'image.png')
      .expect(403);
  }
  await db.client.user.update({
    where: { id: userId },
    data: { role: 'OPERATOR' },
  });
  await mutate('put', 'not-an-id')
    .attach('image', await fixture(), 'image.png')
    .expect(403);
  await mutate('delete').expect(403);
  expect(prepare).not.toHaveBeenCalled();
  expect(await db.client.productImage.count()).toBe(0);
  await db.client.user.update({
    where: { id: userId },
    data: { active: false },
  });
  await mutate()
    .attach('image', await fixture(), 'image.png')
    .expect(401);
});
it('removes idempotently without updating absent images and rejects archived mutations', async () => {
  const first = await upload();
  expect(first.status).toBe(200);
  await mutate('delete').expect(204);
  const before = await db.client.product.findUniqueOrThrow({ where: { id } });
  await Promise.all([
    mutate('delete').expect(204),
    mutate('delete').expect(204),
  ]);
  expect(await db.client.product.findUniqueOrThrow({ where: { id } })).toEqual(
    before,
  );
  await read(first.body.image.detail.url).expect(404);
  await db.client.product.update({ where: { id }, data: { active: false } });
  await mutate('delete').expect(409);
  expect((await upload()).status).toBe(409);
});
it.each([
  'field',
  'wrong file',
  'two files',
  'no file',
  'corrupt',
  'truncated',
  'SVG',
  'spoof',
  'too big',
  'total too big',
])(
  'rejects %s while preserving the published product and image',
  async (kind) => {
    const first = await upload();
    expect(first.status).toBe(200);
    const before = await db.client.product.findUniqueOrThrow({ where: { id } });
    const bytes = await fixture();
    let req = mutate();
    const expected = ['too big', 'total too big'].includes(kind)
      ? 413
      : ['SVG', 'spoof'].includes(kind)
        ? 415
        : ['corrupt', 'truncated'].includes(kind)
          ? 422
          : 400;
    if (kind === 'field')
      req = req
        .field('unexpected', 'private submitted data')
        .attach('image', bytes, 'a.png');
    if (kind === 'wrong file') req = req.attach('other', bytes, 'a.png');
    if (kind === 'two files')
      req = req.attach('image', bytes, 'a.png').attach('image', bytes, 'b.png');
    if (kind === 'no file')
      req = req
        .set('Content-Type', 'multipart/form-data; boundary=empty')
        .send('--empty--\r\n');
    if (kind === 'corrupt')
      req = req.attach(
        'image',
        Buffer.concat([
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
          Buffer.from('private invalid bytes'),
        ]),
        'a.png',
      );
    if (kind === 'truncated')
      req = req.attach('image', bytes.subarray(0, bytes.length - 20), 'a.png');
    if (kind === 'SVG')
      req = req.attach(
        'image',
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        'a.png',
      );
    if (kind === 'spoof')
      req = req.attach('image', bytes, {
        filename: 'a.jpeg',
        contentType: 'image/jpeg',
      });
    if (kind === 'too big')
      req = req.attach('image', Buffer.alloc(5 * 1024 * 1024 + 1), 'a.png');
    if (kind === 'total too big')
      req = req
        .set('Content-Type', 'multipart/form-data; boundary=oversize')
        .send(Buffer.alloc(6 * 1024 * 1024 + 1));
    const response = await req.expect(expected);
    expect(JSON.stringify(response.body)).not.toMatch(
      /private|ProductImage|source|postgres|sharp|filename/,
    );
    expect(
      await db.client.product.findUniqueOrThrow({ where: { id } }),
    ).toEqual(before);
    await read(first.body.image.detail.url).expect(200);
  },
);
it('rejects JSON image assignment and retains the existing JSON body limit', async () => {
  for (const body of [
    { image: null },
    { imageId: randomUUID() },
    { image: { version: 'client' } },
  ]) {
    await request(app.getHttpServer())
      .patch(`/products/${id}`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('x-csrf-token', token)
      .send(body)
      .expect(400);
  }
  await request(app.getHttpServer())
    .patch(`/products/${id}`)
    .set('Cookie', cookie)
    .set('Origin', origin)
    .set('x-csrf-token', token)
    .send({ name: 'x'.repeat(110000) })
    .expect(413);
});
it.each(['write', 'publication database'])(
  'preserves the prior version on %s failure',
  async (kind) => {
    const first = await upload();
    expect(first.status).toBe(200);
    const before = await db.client.product.findUniqueOrThrow({ where: { id } });
    if (kind === 'write') {
      const storage = app.get(ImageStorage);
      const original = storage.write.bind(storage);
      jest
        .spyOn(storage, 'write')
        .mockImplementationOnce(original)
        .mockRejectedValueOnce(new ImageUnavailable());
    } else {
      jest
        .spyOn(app.get(DatabaseService).client, '$transaction')
        .mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('private driver', {
            code: 'P2024',
            clientVersion: '7.10.1',
          }),
        );
    }
    const response = await upload();
    expect(response.status).toBe(503);
    expect(response.body.message).not.toMatch(/private/);
    expect(
      await db.client.product.findUniqueOrThrow({ where: { id } }),
    ).toEqual(before);
    await read(first.body.image.detail.url).expect(200);
  },
);
it.each(['replacement', 'removal', 'archive'])(
  'serializes a paused publication against %s',
  async (operation) => {
    const first = await upload();
    expect(first.status).toBe(200);
    const service = app.get(ImagesService);
    const original = service.publish.bind(service);
    const arrived = gate();
    const release = gate();
    jest.spyOn(service, 'publish').mockImplementationOnce(async (...args) => {
      arrived.release();
      await release.wait;
      return original(...args);
    });
    const pending = upload();
    try {
      await reached(arrived.wait);
      if (operation === 'replacement')
        expect((await upload()).status).toBe(200);
      if (operation === 'removal') await mutate('delete').expect(204);
      if (operation === 'archive')
        await request(app.getHttpServer())
          .post(`/products/${id}/archive`)
          .set('Cookie', cookie)
          .set('Origin', origin)
          .set('x-csrf-token', token)
          .expect(200);
    } finally {
      release.release();
      await pending;
    }
    const result = await pending;
    expect(result.status).toBe(operation === 'archive' ? 409 : 200);
    const current = await read(`/products/${id}`).expect(200);
    expect(current.body.image.version).toBe(
      operation === 'archive'
        ? first.body.image.version
        : result.body.image.version,
    );
  },
);
it('uses bounded dry runs, safety ages, durable deletion claims, and retryable failures', async () => {
  const first = await upload();
  expect(first.status).toBe(200);
  await mutate('delete').expect(204);
  const cleanup = app.get(ImageCleanup);
  expect((await cleanup.run(1, false)).eligible).toBe(0);
  await db.client.productImage.update({
    where: { id: first.body.image.version },
    data: { cleanupAfter: new Date(0) },
  });
  expect(await cleanup.run(1, false)).toEqual({
    mode: 'dry-run',
    eligible: 1,
    deleted: 0,
    missing: 0,
    failed: 0,
  });
  const storage = app.get(ImageStorage);
  const failure = jest
    .spyOn(storage, 'remove')
    .mockRejectedValueOnce(new Error('private deletion failure'));
  expect((await cleanup.run(1, true)).failed).toBe(1);
  failure.mockRestore();
  expect(
    (
      await db.client.productImage.findUniqueOrThrow({
        where: { id: first.body.image.version },
      })
    ).state,
  ).toBe('DELETING');
  await db.client.productImage.update({
    where: { id: first.body.image.version },
    data: { cleanupAfter: new Date(0) },
  });
  expect((await cleanup.run(1, true)).deleted).toBe(1);
  expect(
    (
      await db.client.productImage.findUniqueOrThrow({
        where: { id: first.body.image.version },
      })
    ).state,
  ).toBe('DELETED');
  // Missing files are a recoverable no-op on subsequent cleanup.
  await db.client.productImage.update({
    where: { id: first.body.image.version },
    data: { cleanupAfter: new Date(0) },
  });
  expect((await cleanup.run(1, true)).deleted).toBe(1);
});
it('cannot publish a candidate claimed by cleanup, even if its writer resumes', async () => {
  const first = await upload();
  expect(first.status).toBe(200);
  const service = app.get(ImagesService);
  const original = service.publish.bind(service);
  const arrived = gate();
  const release = gate();
  let candidate!: string;
  jest.spyOn(service, 'publish').mockImplementationOnce(async (...args) => {
    candidate = args[1];
    arrived.release();
    await release.wait;
    return original(...args);
  });
  const pending = upload();
  try {
    await reached(arrived.wait);
    await db.client.productImage.update({
      where: { id: candidate },
      data: { cleanupAfter: new Date(0) },
    });
    expect((await app.get(ImageCleanup).run(100, true)).deleted).toBe(1);
  } finally {
    release.release();
    await pending;
  }
  expect((await pending).status).toBe(409);
  const result = await read(`/products/${id}`).expect(200);
  expect(result.body.image.version).toBe(first.body.image.version);
});

it('bounds concurrent reception and processing without queueing more uploads', async () => {
  const processor = app.get(ImageProcessor);
  const original = processor.process.bind(processor);
  const arrived = gate();
  const release = gate();
  let count = 0;
  jest.spyOn(processor, 'process').mockImplementation(async (...args) => {
    if (++count === 2) arrived.release();
    await release.wait;
    return original(...args);
  });
  const pending = Promise.all([upload(), upload()]);
  try {
    await reached(arrived.wait);
    expect((await upload()).status).toBe(429);
  } finally {
    release.release();
    await pending;
  }
  expect((await pending).map((response) => response.status)).toEqual([
    200, 200,
  ]);
});
it('skips live and already-claimed versions across simultaneous cleanup runs', async () => {
  const first = await upload();
  const second = await upload();
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  await db.client.productImage.updateMany({
    data: { cleanupAfter: new Date(0) },
  });
  const storage = app.get(ImageStorage);
  const original = storage.remove.bind(storage);
  const arrived = gate();
  const release = gate();
  jest.spyOn(storage, 'remove').mockImplementationOnce(async (version) => {
    arrived.release();
    await release.wait;
    return original(version);
  });
  const pending = app.get(ImageCleanup).run(1, true);
  try {
    await reached(arrived.wait);
    expect((await app.get(ImageCleanup).run(1, true)).eligible).toBe(0);
  } finally {
    release.release();
    await pending;
  }
  await read(second.body.image.detail.url).expect(200);
});

function rawUpload() {
  const port = (app.getHttpServer().address() as AddressInfo).port;
  const outgoing = httpRequest({
    hostname: '127.0.0.1',
    port,
    path: `/products/${id}/image`,
    method: 'PUT',
    headers: {
      Cookie: cookie,
      Origin: origin,
      'x-csrf-token': token,
      'Content-Type': 'multipart/form-data; boundary=raw-test',
    },
  });
  const response = new Promise<{ status: number; body: string }>(
    (resolve, reject) => {
      outgoing.on('error', reject);
      outgoing.on('response', (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk) => chunks.push(chunk));
        incoming.on('end', () =>
          resolve({
            status: incoming.statusCode!,
            body: Buffer.concat(chunks).toString(),
          }),
        );
        incoming.on('error', reject);
      });
    },
  );
  return { outgoing, response };
}
it('enforces actual chunked multipart bytes at exactly 6 MiB and the next byte', async () => {
  const png = await fixture();
  const file = Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024 - png.length)]);
  const header = Buffer.from(
    '\r\n--raw-test\r\nContent-Disposition: form-data; name="image"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n',
  );
  const footer = Buffer.from('\r\n--raw-test--\r\n');
  const body = Buffer.concat([
    Buffer.alloc(
      6 * 1024 * 1024 - header.length - footer.length - file.length,
      120,
    ),
    header,
    file,
    footer,
  ]);
  const accepted = rawUpload();
  accepted.outgoing.end(body);
  expect((await accepted.response).status).toBe(200);
  const before = await db.client.product.findUniqueOrThrow({ where: { id } });
  const rejected = rawUpload();
  rejected.outgoing.end(Buffer.concat([body, Buffer.from('x')]));
  expect((await rejected.response).status).toBe(413);
  expect(await db.client.product.findUniqueOrThrow({ where: { id } })).toEqual(
    before,
  );
});
it('terminates incomplete receives with a bounded timeout and releases the upload slot', async () => {
  const incoming = rawUpload();
  incoming.outgoing.write(
    '--raw-test\r\nContent-Disposition: form-data; name="image"; filename="a.png"\r\nContent-Type: image/png\r\n\r\npartial',
  );
  const result = await incoming.response;
  expect(result.status).toBe(408);
  expect(result.body).toBe(
    JSON.stringify({ statusCode: 408, message: 'Request timeout.' }),
  );
  // Reception has no published side effects; a subsequent valid request works.
  expect((await upload()).status).toBe(200);
});
it('holds the actual product row lock while a concurrent archive waits', async () => {
  const service = app.get(ImagesService);
  const original = service.lock.bind(service);
  const arrived = gate();
  const release = gate();
  jest.spyOn(service, 'lock').mockImplementationOnce(async (...args) => {
    const product = await original(...args);
    arrived.release();
    await release.wait;
    return product;
  });
  const publication = upload();
  let archive: Promise<request.Response> | undefined;
  try {
    await reached(arrived.wait);
    archive = request(app.getHttpServer())
      .post(`/products/${id}/archive`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('x-csrf-token', token)
      .then((response) => response);
    const deadline = Date.now() + 5000;
    while (true) {
      const [state] = await db.client.$queryRaw<
        { blocked: boolean }[]
      >`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%Product%' AND query LIKE '%UPDATE%') AS blocked`;
      if (state?.blocked) break;
      if (Date.now() > deadline)
        throw new Error('Archive did not reach the product row lock.');
    }
  } finally {
    release.release();
    await publication;
    await archive;
  }
  expect((await publication).status).toBe(200);
  expect((await archive)!.status).toBe(200);
  const product = await read(`/products/${id}`).expect(200);
  expect(product.body.active).toBe(false);
  expect(product.body.image.version).toBe(
    (await publication).body.image.version,
  );
});

it('cleans up a client abort during candidate preparation without publishing', async () => {
  const service = app.get(ImagesService);
  const original = service.prepare.bind(service);
  const arrived = gate();
  const release = gate();
  let candidate!: string;
  jest.spyOn(service, 'prepare').mockImplementationOnce(async (...args) => {
    const row = await original(...args);
    candidate = row.id;
    arrived.release();
    await release.wait;
    return row;
  });
  const incoming = rawUpload();
  const outcome = incoming.response.catch(() => undefined);
  incoming.outgoing.write(
    '--raw-test\r\nContent-Disposition: form-data; name="image"; filename="a.png"\r\nContent-Type: image/png\r\n\r\npartial',
  );
  try {
    await reached(arrived.wait);
    incoming.outgoing.destroy();
    await outcome;
  } finally {
    release.release();
  }
  const deadline = Date.now() + 5000;
  while (true) {
    const row = await db.client.productImage.findUnique({
      where: { id: candidate },
    });
    if (row?.state === 'DELETED') break;
    if (Date.now() > deadline)
      throw new Error('Aborted candidate was not cleaned.');
  }
  expect(
    (await db.client.product.findUniqueOrThrow({ where: { id } })).imageId,
  ).toBeNull();
  expect((await upload()).status).toBe(200);
});
it('preserves the previous publication when its database transaction rolls back', async () => {
  const first = await upload();
  expect(first.status).toBe(200);
  const before = await db.client.product.findUniqueOrThrow({ where: { id } });
  const service = app.get(ImagesService);
  const original = service.publish.bind(service);
  jest
    .spyOn(service, 'publish')
    .mockImplementationOnce((product, version, dimensions) =>
      original(product, version, { ...dimensions, detailWidth: 0 }),
    );
  expect((await upload()).status).toBe(500);
  expect(await db.client.product.findUniqueOrThrow({ where: { id } })).toEqual(
    before,
  );
  await read(first.body.image.detail.url).expect(200);
});
it('never deletes the new image when publication committed but its response is uncertain', async () => {
  const service = app.get(ImagesService);
  const original = service.publish.bind(service);
  jest.spyOn(service, 'publish').mockImplementationOnce(async (...args) => {
    await original(...args);
    throw new ImageUnavailable();
  });
  expect((await upload()).status).toBe(503);
  const current = await read(`/products/${id}`).expect(200);
  expect(current.body.image).not.toBeNull();
  await read(current.body.image.detail.url).expect(200);
  expect(
    (
      await db.client.productImage.findUniqueOrThrow({
        where: { id: current.body.image.version },
      })
    ).state,
  ).toBe('PUBLISHED');
});
it('maps only identified database availability failures and keeps errors sanitized', async () => {
  jest
    .spyOn(app.get(DatabaseService).client, '$transaction')
    .mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError(
        'private connection information',
        { code: 'P2024', clientVersion: '7.10.1' },
      ),
    );
  const response = await upload();
  expect(response.status).toBe(503);
  expect(response.body).toEqual({
    statusCode: 503,
    message: 'Product image storage unavailable.',
  });
  expect(
    (await db.client.product.findUniqueOrThrow({ where: { id } })).imageId,
  ).toBeNull();
});

it('executes the bounded cleanup CLI with dry-run default and explicit apply', async () => {
  const first = await upload();
  const second = await upload();
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  await db.client.productImage.update({
    where: { id: first.body.image.version },
    data: { cleanupAfter: new Date(0) },
  });
  function cli(args: string[]) {
    return JSON.parse(
      execFileSync(
        process.execPath,
        [resolve('.test-dist/src/products/images/cleanup-main.js'), ...args],
        {
          env: {
            ...process.env,
            DATABASE_URL: db.databaseUrl,
            PRODUCT_IMAGE_STORAGE_DIR: directory,
          },
          stdio: 'pipe',
          timeout: 10000,
        },
      ).toString(),
    ) as {
      mode: string;
      eligible: number;
      deleted: number;
      missing: number;
      failed: number;
    };
  }
  expect(cli(['--limit=1'])).toEqual({
    mode: 'dry-run',
    eligible: 1,
    deleted: 0,
    missing: 0,
    failed: 0,
  });
  expect(
    (
      await db.client.productImage.findUniqueOrThrow({
        where: { id: first.body.image.version },
      })
    ).state,
  ).toBe('RETIRED');
  expect(cli(['--limit=1', '--apply'])).toEqual({
    mode: 'apply',
    eligible: 1,
    deleted: 1,
    missing: 0,
    failed: 0,
  });
  await read(second.body.image.detail.url).expect(200);
});
it.each([
  'missing boundary',
  'incomplete boundary',
  'extra query',
  'JSON body',
  'missing product',
  'invalid id',
])('rejects %s without changing product state', async (kind) => {
  const before = await db.client.product.findMany();
  let req = mutate();
  let status = 400;
  if (kind === 'missing boundary')
    req = req.set('Content-Type', 'multipart/form-data').send('invalid');
  if (kind === 'incomplete boundary')
    req = req
      .set('Content-Type', 'multipart/form-data; boundary=incomplete')
      .send(
        '--incomplete\r\nContent-Disposition: form-data; name="image"; filename="x.png"\r\nContent-Type: image/png\r\n\r\npartial',
      );
  if (kind === 'extra query')
    req = req
      .query({ unexpected: 'private' })
      .attach('image', await fixture(), 'a.png');
  if (kind === 'JSON body') req = req.send({ image: 'private client key' });
  if (kind === 'missing product') {
    req = mutate('put', randomUUID()).attach('image', await fixture(), 'a.png');
    status = 404;
  }
  if (kind === 'invalid id')
    req = mutate('put', 'invalid').attach('image', await fixture(), 'a.png');
  await req.expect(status);
  expect(await db.client.product.findMany()).toEqual(before);
});
