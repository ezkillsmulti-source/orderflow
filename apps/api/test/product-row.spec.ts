import { expect, it, jest } from '@jest/globals';
import { Prisma } from '../src/generated/prisma/client.js';
import { lockProduct, ProductRowTimeout } from '../src/products/product-row.js';
import {
  inventoryDatabaseError,
  InventoryUnavailable,
} from '../src/inventory/inventory.errors.js';
import {
  productDatabaseError,
  ProductStorageUnavailable,
} from '../src/products/product.errors.js';
import {
  imageDatabaseError,
  ImageUnavailable,
} from '../src/products/images/image.errors.js';

function known(code: string, meta: Record<string, unknown> = {}) {
  return new Prisma.PrismaClientKnownRequestError('Synthetic driver failure.', {
    code,
    meta,
    clientVersion: '7.10.1',
  });
}
function transaction(error: unknown) {
  return {
    $queryRaw: jest.fn<() => Promise<never>>().mockRejectedValue(error),
  } as unknown as Prisma.TransactionClient;
}
it.each(['57014', '55P03'])(
  'recognizes structured SQLSTATE %s only at the product lock boundary',
  async (code) => {
    for (const error of [
      known('P2010', { code }),
      known('P2010', {
        driverAdapterError: {
          cause: { kind: 'postgres', code, originalCode: code },
        },
      }),
    ]) {
      const result = await lockProduct(
        transaction(error),
        '00000000-0000-4000-8000-000000000001',
      ).catch((e) => e);
      expect(result instanceof ProductRowTimeout).toBe(true);
      expect(result.cause).toBe(error);
      expect(() => inventoryDatabaseError(result)).toThrow(
        InventoryUnavailable,
      );
      expect(() => productDatabaseError(result)).toThrow(
        ProductStorageUnavailable,
      );
      expect(() => imageDatabaseError(result)).toThrow(ImageUnavailable);
    }
  },
);
it('preserves the exact pg client deadline as a private cause', async () => {
  const error = new Error('Query read timeout');
  const result = await lockProduct(
    transaction(error),
    '00000000-0000-4000-8000-000000000001',
  ).catch((e) => e);
  expect(result instanceof ProductRowTimeout).toBe(true);
  expect(result.cause).toBe(error);
});
it.each([
  known('P2010', {
    driverAdapterError: {
      cause: { kind: 'postgres', code: '23505', originalCode: '23505' },
    },
  }),
  known('P2010', {
    driverAdapterError: { cause: { kind: 'other', code: '57014' } },
  }),
  known('P2002', {
    driverAdapterError: { cause: { kind: 'postgres', code: '57014' } },
  }),
  known('P2010', { code: '23505' }),
  known('P2010'),
  known('P2028'),
  new Error('Unrelated Query read timeout detail'),
])(
  'does not disguise unrelated database or transaction errors: %#',
  async (error) => {
    await expect(
      lockProduct(transaction(error), '00000000-0000-4000-8000-000000000001'),
    ).rejects.toBe(error);
  },
);
