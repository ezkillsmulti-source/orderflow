import { NotFoundException } from '@nestjs/common';
import { Prisma, type Product } from '../generated/prisma/client.js';

export class ProductRowTimeout extends Error {}

function sqlTimeout(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2010'
  )
    return false;
  // Prisma's pg adapter retains SQLSTATE in DriverAdapterError.cause rather than
  // meta.code. Accept only its PostgreSQL variant, plus the direct SQLSTATE shape.
  const adapter = error.meta?.driverAdapterError as
    { cause?: { kind?: string; code?: string } } | undefined;
  const cause = adapter?.cause;
  const code = cause?.kind === 'postgres' ? cause.code : error.meta?.code;
  return code === '57014' || code === '55P03';
}

/** Shared lock protocol for inventory, archive and image publication/removal. */
export async function lockProduct(tx: Prisma.TransactionClient, id: string) {
  const [row] = await tx.$queryRaw<
    Product[]
  >`SELECT * FROM "Product" WHERE id=${id}::uuid FOR UPDATE`.catch(
    (error: unknown) => {
      // Classification is confined to this SQL lock boundary. Keep the original
      // cause privately; neither SQLSTATE nor cause details are HTTP response data.
      if (
        sqlTimeout(error) ||
        (error instanceof Error && error.message === 'Query read timeout')
      )
        throw new ProductRowTimeout('Product row lock timed out.', {
          cause: error,
        });
      throw error;
    },
  );
  if (!row) throw new NotFoundException();
  return row;
}
