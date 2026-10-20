import { expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import {
  adjustmentInput,
  historyPage,
} from '../src/inventory/inventory.validation.js';
import {
  idempotencyCollision,
  inventoryDatabaseError,
  InventoryUnavailable,
} from '../src/inventory/inventory.errors.js';
import { ProductRowTimeout } from '../src/products/product-row.js';
import { Prisma } from '../src/generated/prisma/client.js';

it('normalizes only reason whitespace and preserves exact signed quantity boundaries', () => {
  expect(
    adjustmentInput({ delta: '-9007199254740991', reason: ' \tCount 🦉\n' }),
  ).toEqual({ delta: -9007199254740991n, reason: 'Count 🦉' });
  expect(historyPage('/history?before=9007199254740991&limit=100')).toEqual({
    limit: 100,
    before: 9007199254740991n,
  });
});
function known(code: string, meta: Record<string, unknown> = {}) {
  return new Prisma.PrismaClientKnownRequestError('private details', {
    code,
    meta,
    clientVersion: '7.10.1',
  });
}
it('recognizes only the actor/key constraint, including the adapter constraint shape', () => {
  expect(
    idempotencyCollision(
      known('P2002', {
        modelName: 'InventoryAdjustment',
        target: ['actorId', 'idempotencyKey'],
      }),
    ),
  ).toBe(true);
  expect(
    idempotencyCollision(
      known('P2002', {
        modelName: 'InventoryAdjustment',
        driverAdapterError: {
          cause: {
            originalCode: '23505',
            kind: 'UniqueConstraintViolation',
            table: 'InventoryAdjustment',
            constraint: {
              index: 'InventoryAdjustment_actorId_idempotencyKey_key',
            },
          },
        },
      }),
    ),
  ).toBe(true);
  for (const error of [
    known('P2002'),
    known('P2002', { modelName: 'InventoryAdjustment', target: ['id'] }),
    known('P2002', {
      modelName: 'InventoryAdjustment',
      target: ['productId', 'sequence'],
    }),
    known('P2002', {
      modelName: 'Other',
      target: ['actorId', 'idempotencyKey'],
    }),
    new Error(randomUUID()),
  ])
    expect(idempotencyCollision(error)).toBe(false);
});
it.each(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2037'])(
  'maps identified availability code %s only',
  (code) => {
    expect(() => inventoryDatabaseError(known(code))).toThrow(
      InventoryUnavailable,
    );
  },
);
it('maps bounded SQL lock/query timeouts but preserves unexplained failures', () => {
  expect(() => inventoryDatabaseError(new ProductRowTimeout())).toThrow(
    InventoryUnavailable,
  );
  for (const code of ['57014', '55P03'])
    expect(() => inventoryDatabaseError(known('P2010', { code }))).toThrow(
      InventoryUnavailable,
    );
  for (const error of [
    known('P2010', { code: '23505' }),
    known('P2028'),
    known('P2021'),
    new Error('unexpected'),
    new Error('unrelated Query read timeout details'),
    new Error('Query read timeout'),
  ]) {
    let caught;
    try {
      inventoryDatabaseError(error);
    } catch (value) {
      caught = value;
    }
    expect(caught).toBe(error);
  }
});
