import 'reflect-metadata';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HealthController } from '../src/health/health.controller.js';
import { DatabaseService } from '../src/database/database.service.js';

let app: INestApplication;
const isReady = jest.fn<() => Promise<boolean>>();

beforeEach(async () => {
  isReady.mockReset();
  const module = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: DatabaseService, useValue: { isReady } }],
  }).compile();
  app = module.createNestApplication();
  await app.init();
});
afterEach(async () => {
  await app.close();
});

describe('health HTTP contract', () => {
  it('reports liveness without touching the database', async () => {
    await request(app.getHttpServer())
      .get('/health/live')
      .expect(200, { status: 'ok' });
    expect(isReady).not.toHaveBeenCalled();
  });
  it('reports readiness after a successful probe', async () => {
    isReady.mockResolvedValue(true);
    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200, { status: 'ok' });
    expect(isReady).toHaveBeenCalledTimes(1);
  });
  it('returns a minimal 503 response on database failure', async () => {
    isReady.mockResolvedValue(false);
    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503, { status: 'not_ready' });
    await request(app.getHttpServer())
      .get('/health/live')
      .expect(200, { status: 'ok' });
  });
});
