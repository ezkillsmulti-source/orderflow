import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
export class InventoryUnavailable extends ServiceUnavailableException {}
export function inventoryDatabaseError(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2037'].includes(error.code)
  )
    throw new InventoryUnavailable();
  throw error;
}
