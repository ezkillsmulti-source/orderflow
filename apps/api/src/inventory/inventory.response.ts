import type { InventoryAdjustment } from '../generated/prisma/client.js';
export function adjustmentResponse(row: InventoryAdjustment) {
  return {
    id: row.id,
    productId: row.productId,
    sequence: row.sequence.toString(),
    delta: row.delta.toString(),
    reason: row.reason,
    balanceAfter: row.balanceAfter.toString(),
    actorId: row.actorId,
    createdAt: row.createdAt.toISOString(),
  };
}
