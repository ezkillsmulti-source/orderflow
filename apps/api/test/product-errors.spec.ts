import { describe, expect, it } from '@jest/globals';
import { Prisma } from '../src/generated/prisma/client.js';
import {
  productDatabaseError,
  ProductConflict,
  ProductStorageUnavailable,
} from '../src/products/product.errors.js';

function known(code: string, meta = {}) {
  return new Prisma.PrismaClientKnownRequestError('private details', {
    code,
    clientVersion: '7.10.1',
    meta,
  });
}
describe('catalog database error classification', () => {
  it.each(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2037'])(
    'recognizes availability code %s',
    (code) => {
      expect(() => productDatabaseError(known(code))).toThrow(
        ProductStorageUnavailable,
      );
    },
  );
  it('identifies only the Product SKU constraint, including the PostgreSQL adapter shape', () => {
    expect(() =>
      productDatabaseError(
        known('P2002', { modelName: 'Product', target: ['sku'] }),
      ),
    ).toThrow(ProductConflict);
    expect(() =>
      productDatabaseError(
        known('P2002', {
          modelName: 'Product',
          driverAdapterError: {
            cause: {
              originalCode: '23505',
              kind: 'UniqueConstraintViolation',
              table: 'Product',
              constraint: { index: 'Product_sku_key' },
            },
          },
        }),
      ),
    ).toThrow(ProductConflict);
  });
  it.each([
    new Error('private unexpected details'),
    known('P2021'),
    known('P2002'),
    known('P2002', { modelName: 'Product', target: ['id'] }),
    known('P2002', { modelName: 'User', target: ['sku'] }),
    known('P2002', {
      modelName: 'Product',
      driverAdapterError: {
        cause: {
          originalCode: '23505',
          kind: 'UniqueConstraintViolation',
          table: 'Product',
          constraint: { index: 'other_key' },
        },
      },
    }),
  ])(
    'preserves unexpected failures instead of disguising them: %#',
    (error) => {
      try {
        productDatabaseError(error);
      } catch (caught) {
        expect(caught).toBe(error);
        return;
      }
      throw new Error('Expected original error');
    },
  );
});
