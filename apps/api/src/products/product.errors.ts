import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';

export class ProductConflict extends ConflictException {}
export class ProductStorageUnavailable extends ServiceUnavailableException {}

export function productDatabaseError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const target = error.meta?.target;
    const adapter = error.meta?.driverAdapterError as
      | {
          cause?: {
            originalCode?: string;
            kind?: string;
            table?: string;
            constraint?: { index?: string };
          };
        }
      | undefined;
    const cause = adapter?.cause;
    const skuConstraint =
      (Array.isArray(target) && target.length === 1 && target[0] === 'sku') ||
      (cause?.originalCode === '23505' &&
        cause.kind === 'UniqueConstraintViolation' &&
        cause.table === 'Product' &&
        cause.constraint?.index === 'Product_sku_key');
    if (
      error.code === 'P2002' &&
      error.meta?.modelName === 'Product' &&
      skuConstraint
    ) {
      throw new ProductConflict();
    }
    if (
      ['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2037'].includes(
        error.code,
      )
    ) {
      throw new ProductStorageUnavailable();
    }
  }
  throw error;
}
