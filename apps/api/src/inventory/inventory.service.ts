import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type {
  Prisma,
  InventoryAdjustment,
} from '../generated/prisma/client.js';
import { lockProduct } from '../products/product-row.js';
import { INVENTORY_MAX, type AdjustmentInput } from './inventory.validation.js';
import {
  InventoryConflict,
  idempotencyCollision,
  inventoryDatabaseError,
} from './inventory.errors.js';
import type { HistoryPage } from './inventory.validation.js';
@Injectable()
export class InventoryService {
  constructor(private readonly database: DatabaseService) {}
  async lock(tx: Prisma.TransactionClient, id: string) {
    return lockProduct(tx, id);
  }
  async record(
    tx: Prisma.TransactionClient,
    data: Prisma.InventoryAdjustmentUncheckedCreateInput,
  ) {
    return tx.inventoryAdjustment.create({ data });
  }
  private replay(
    row: InventoryAdjustment,
    productId: string,
    input: AdjustmentInput,
  ) {
    if (
      row.productId !== productId ||
      row.delta !== input.delta ||
      row.reason !== input.reason
    )
      throw new InventoryConflict('key');
    return { row, replayed: true };
  }
  async adjust(
    productId: string,
    actorId: string,
    key: string,
    input: AdjustmentInput,
  ) {
    const where = { actorId_idempotencyKey: { actorId, idempotencyKey: key } };
    try {
      return await this.database.client.$transaction(
        async (tx) => {
          // Every write locks exactly one product. Never acquire a second product or a
          // user/key lock first; cross-product unique-index losers roll back in full.
          const product = await this.lock(tx, productId);
          const previous = await tx.inventoryAdjustment.findUnique({ where });
          if (previous) return this.replay(previous, productId, input);
          if (!product.active) throw new InventoryConflict('archived');
          const balanceAfter = product.onHand + input.delta;
          if (balanceAfter < 0n || balanceAfter > INVENTORY_MAX)
            throw new InventoryConflict('balance');
          const sequence = product.inventorySequence + 1n;
          if (sequence > INVENTORY_MAX) throw new InventoryConflict('sequence');
          // Explicit SQL deliberately leaves catalog updatedAt and image fields alone.
          await tx.$executeRaw`UPDATE "Product" SET "onHand"=${balanceAfter}, "inventorySequence"=${sequence} WHERE id=${productId}::uuid`;
          const row = await this.record(tx, {
            productId,
            actorId,
            idempotencyKey: key,
            sequence,
            ...input,
            balanceAfter,
          });
          return { row, replayed: false };
        },
        { maxWait: 1000, timeout: 3000 },
      );
    } catch (error) {
      if (idempotencyCollision(error)) {
        // PostgreSQL aborted the entire transaction: query only after leaving it.
        const previous = await this.database.client.inventoryAdjustment
          .findUnique({ where })
          .catch(inventoryDatabaseError);
        if (previous) return this.replay(previous, productId, input);
        // An unexplained unique failure is not proof of a successful replay.
      }
      return inventoryDatabaseError(error);
    }
  }
  async balance(productId: string) {
    const row = await this.database.client.product
      .findUnique({ where: { id: productId }, select: { onHand: true } })
      .catch(inventoryDatabaseError);
    if (!row) throw new NotFoundException();
    return {
      productId,
      onHand: row.onHand.toString(),
      reserved: '0',
      available: row.onHand.toString(),
    };
  }
  async history(productId: string, page: HistoryPage) {
    await this.balance(productId);
    return this.database.client.inventoryAdjustment
      .findMany({
        where: {
          productId,
          ...(page.before === undefined
            ? {}
            : { sequence: { lt: page.before } }),
        },
        orderBy: { sequence: 'desc' },
        take: page.limit + 1,
      })
      .catch(inventoryDatabaseError);
  }
}
