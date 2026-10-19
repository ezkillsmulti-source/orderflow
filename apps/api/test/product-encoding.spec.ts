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
import { Body, Controller, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ProductsController } from '../src/products/products.controller.js';
import { ProductsService } from '../src/products/products.service.js';
import { ApiExceptionFilter } from '../src/auth/api-exception.filter.js';

// Test-only route verifies catalog validation does not change unrelated parsers.
@Controller('wire-probe')
class WireProbe {
  @Post() echo(@Body() body: unknown) {
    return body;
  }
}
let app: NestExpressApplication;
const create = jest.fn<ProductsService['create']>();
const valid = { sku: 'WIRE', name: 'Coffee 🦉', priceMinor: '0' };
beforeAll(async () => {
  const module = await Test.createTestingModule({
    controllers: [ProductsController, WireProbe],
    providers: [{ provide: ProductsService, useValue: { create } }],
  }).compile();
  app = module.createNestApplication<NestExpressApplication>({ rawBody: true });
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
});
beforeEach(() => {
  create.mockReset().mockImplementation(async (data) => ({
    id: '00000000-0000-0000-0000-000000000001',
    ...data,
    description: data.description ?? null,
    active: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }));
});
afterAll(async () => {
  await app?.close();
});

describe('catalog wire encoding boundary', () => {
  it('accepts UTF-8 JSON and preserves its text', async () => {
    const result = await request(app.getHttpServer())
      .post('/products')
      .set('Content-Type', 'application/json; charset=UTF-8')
      .send(JSON.stringify(valid))
      .expect(201);
    expect(result.body.name).toBe(valid.name);
    expect(create).toHaveBeenCalledWith({ ...valid, priceMinor: 0n });
  });
  it('accepts a valid JSON Buffer sent as unchanged wire bytes', async () => {
    await request(app.getHttpServer())
      .post('/products')
      .set('Content-Type', 'application/json')
      .serialize((body) => body)
      .send(Buffer.from(JSON.stringify(valid), 'utf8'))
      .expect(201);
    expect(create).toHaveBeenCalledWith({ ...valid, priceMinor: 0n });
  });
  it.each(['Coffee', '%C3%28'])(
    'rejects form encoding before writes, including lossy percent decoding: %s',
    async (name) => {
      await request(app.getHttpServer())
        .post('/products')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`sku=WIRE&name=${name}&priceMinor=0`)
        .expect(400);
      expect(create).not.toHaveBeenCalled();
    },
  );
  it('rejects malformed raw UTF-8 in an otherwise valid JSON product', async () => {
    await request(app.getHttpServer())
      .post('/products')
      .set('Content-Type', 'application/json')
      .serialize((body) => body) // Preserve deliberately malformed wire bytes.
      .send(
        Buffer.concat([
          Buffer.from('{"sku":"WIRE","priceMinor":"0","name":"'),
          Buffer.from([0xc3, 0x28]),
          Buffer.from('"}'),
        ]),
      )
      .expect(400);
    expect(create).not.toHaveBeenCalled();
  });
  it('rejects non-UTF-8 JSON without writes', async () => {
    await request(app.getHttpServer())
      .post('/products')
      .set('Content-Type', 'application/json; charset=utf-16le')
      .serialize((body) => body)
      .send(Buffer.from(JSON.stringify(valid), 'utf16le'))
      .expect(400);
    expect(create).not.toHaveBeenCalled();
  });
  it('keeps the existing 100 KiB JSON limit before catalog service access', async () => {
    await request(app.getHttpServer())
      .post('/products')
      .send({ ...valid, name: 'x'.repeat(110000) })
      .expect(413);
    expect(create).not.toHaveBeenCalled();
  });
  it('preserves unrelated JSON and form parsing with raw body capture enabled', async () => {
    await request(app.getHttpServer())
      .post('/wire-probe')
      .send({ value: '🦉' })
      .expect(201, { value: '🦉' });
    await request(app.getHttpServer())
      .post('/wire-probe')
      .type('form')
      .send('value=unchanged')
      .expect(201, { value: 'unchanged' });
  });
});
