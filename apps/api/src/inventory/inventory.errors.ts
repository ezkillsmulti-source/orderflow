import { ProductRowTimeout } from '../products/product-row.js';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
export class InventoryConflict extends ConflictException {
  constructor(readonly kind: 'archived' | 'balance' | 'key' | 'sequence') {
    super();
  }
}
export function idempotencyCollision(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002' ||
    error.meta?.modelName !== 'InventoryAdjustment'
  )
    return false;
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
  return (
    (Array.isArray(target) &&
      target.length === 2 &&
      target.includes('actorId') &&
      target.includes('idempotencyKey')) ||
    (cause?.originalCode === '23505' &&
      cause.kind === 'UniqueConstraintViolation' &&
      cause.table === 'InventoryAdjustment' &&
      cause.constraint?.index ===
        'InventoryAdjustment_actorId_idempotencyKey_key')
  );
}
export class InventoryUnavailable extends ServiceUnavailableException {}
export function inventoryDatabaseError(error: unknown): never {
  if (error instanceof ProductRowTimeout) throw new InventoryUnavailable();
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2037'].includes(
      error.code,
    ) ||
      (error.code === 'P2010' &&
        ['57014', '55P03'].includes(String(error.meta?.code))))
  )
    throw new InventoryUnavailable();
  throw error;
}
