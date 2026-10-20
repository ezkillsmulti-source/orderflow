import { NotFoundException } from '@nestjs/common';
import type { Prisma, Product } from '../generated/prisma/client.js';

/** pg emits this exact unstructured error when its configured query deadline wins. */
export class ProductRowTimeout extends Error {}

/** Shared lock protocol for inventory, archive and image publication/removal. */
export async function lockProduct(tx: Prisma.TransactionClient, id: string) {
  const [row] = await tx.$queryRaw<
    Product[]
  >`SELECT * FROM "Product" WHERE id=${id}::uuid FOR UPDATE`.catch(
    (error: unknown) => {
      // Classify only at this known SQL boundary, never by arbitrary message substrings.
      if (error instanceof Error && error.message === 'Query read timeout')
        throw new ProductRowTimeout();
      throw error;
    },
  );
  if (!row) throw new NotFoundException();
  return row;
}
