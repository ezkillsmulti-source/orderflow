import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { inventoryDatabaseError } from './inventory.errors.js';
import type { HistoryPage } from './inventory.validation.js';
@Injectable()
export class InventoryService {
  constructor(private readonly database: DatabaseService) {}
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
