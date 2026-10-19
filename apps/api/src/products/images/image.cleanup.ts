import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { ImageStorage } from './image.storage.js';
import { imageDatabaseError } from './image.errors.js';

export const IMAGE_SAFETY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ImageCleanup {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: ImageStorage,
  ) {}

  async run(limit: number, apply: boolean) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new Error('Cleanup limit must be 1–1000.');
    // One short transaction claims a bounded batch. Publication locks the same
    // candidate and can never revive a claimed or expired candidate.
    const versions = await this.database.client
      .$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT i."id" FROM "ProductImage" i
        WHERE i."state" IN ('PENDING', 'RETIRED', 'DELETING', 'DELETED')
          AND i."cleanupAfter" <= clock_timestamp()
          AND NOT EXISTS (SELECT 1 FROM "Product" p WHERE p."imageId" = i."id")
        ORDER BY i."cleanupAfter", i."id" LIMIT ${limit}
        FOR UPDATE OF i SKIP LOCKED`;
        if (apply && rows.length)
          await tx.productImage.updateMany({
            where: { id: { in: rows.map((row) => row.id) } },
            data: {
              state: 'DELETING',
              cleanupAfter: new Date(Date.now() + IMAGE_SAFETY_MS),
            },
          });
        return rows;
      })
      .catch(imageDatabaseError);
    let missing = 0;
    let deleted = 0;
    let failed = 0;
    if (apply)
      for (const { id } of versions) {
        try {
          const removed = await this.storage.remove(id);
          if (removed.missing) missing++;
          await this.database.client.productImage.updateMany({
            where: { id, state: 'DELETING' },
            data: {
              state: 'DELETED',
              cleanupAfter: new Date(Date.now() + IMAGE_SAFETY_MS),
            },
          });
          deleted++;
        } catch {
          failed++;
        } // Keep the durable claim; retry after its safety lease.
      }
    return {
      mode: apply ? 'apply' : 'dry-run',
      eligible: versions.length,
      deleted,
      missing,
      failed,
    };
  }

  /** Cleanup only an unpublished candidate; an uncertain commit is never deleted. */
  async abandon(id: string) {
    try {
      const claim = await this.database.client.productImage.updateMany({
        where: { id, state: 'PENDING' },
        data: {
          state: 'DELETING',
          cleanupAfter: new Date(Date.now() + IMAGE_SAFETY_MS),
        },
      });
      if (!claim.count) return;
      await this.storage.remove(id);
      await this.database.client.productImage.updateMany({
        where: { id, state: 'DELETING' },
        data: {
          state: 'DELETED',
          cleanupAfter: new Date(Date.now() + IMAGE_SAFETY_MS),
        },
      });
    } catch {
      // Recovery is persisted before I/O. Do not replace the request outcome or
      // expose submitted values, paths, driver details, or session information.
      console.warn('Product image candidate cleanup deferred.');
    }
  }
}
