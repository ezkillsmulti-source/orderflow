import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { ImageStorage, type ImageVariant } from './image.storage.js';
import { ProductConflict } from '../product.errors.js';
import { lockProduct } from '../product-row.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ImageProcessor } from './image.processor.js';
import { IMAGE_SAFETY_MS } from './image.cleanup.js';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { filesystemError, imageDatabaseError } from './image.errors.js';

@Injectable()
export class ImagesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: ImageStorage,
    private readonly processor: ImageProcessor,
  ) {}

  async read(productId: string, version: string, variant: ImageVariant) {
    const product = await this.database.client.product
      .findUnique({
        where: { id: productId },
        select: { imageId: true },
      })
      .catch(imageDatabaseError);
    if (!product || product.imageId !== version) throw new NotFoundException();
    return this.storage.read(version, variant);
  }

  async prepare(id: string) {
    const product = await this.database.client.product
      .findUnique({ where: { id } })
      .catch(imageDatabaseError);
    if (!product) throw new NotFoundException();
    if (!product.active) throw new ProductConflict();
    // Storage readiness before recording the candidate, but no uploaded bytes yet.
    await this.storage.root();
    return this.database.client.productImage
      .create({
        data: {
          id: randomUUID(),
          productId: id,
          cleanupAfter: new Date(Date.now() + IMAGE_SAFETY_MS),
        },
      })
      .catch(imageDatabaseError);
  }

  async replace(id: string, version: string, path: string, mime: string) {
    const bytes = await readFile(path).catch(filesystemError);
    const result = await this.processor.process(bytes, mime);
    await this.storage.write(version, 'detail', result.detail.data);
    await this.storage.write(version, 'thumbnail', result.thumbnail.data);
    // Never retain the submitted original in a successfully published directory.
    await rm(join(await this.storage.folder(version), 'source')).catch(
      filesystemError,
    );
    await this.storage.sync(version);
    return this.publish(id, version, {
      detailWidth: result.detail.info.width,
      detailHeight: result.detail.info.height,
      thumbnailWidth: result.thumbnail.info.width,
      thumbnailHeight: result.thumbnail.info.height,
    });
  }

  async lock(tx: Prisma.TransactionClient, id: string) {
    const product = await lockProduct(tx, id);
    if (!product.active) throw new ProductConflict();
    return product;
  }

  async publish(
    id: string,
    version: string,
    dimensions: {
      detailWidth: number;
      detailHeight: number;
      thumbnailWidth: number;
      thumbnailHeight: number;
    },
  ) {
    return this.database.client
      .$transaction(async (tx) => {
        const product = await this.lock(tx, id);
        const count =
          await tx.$executeRaw`UPDATE "ProductImage" SET "state" = 'PUBLISHED',
        "detailWidth" = ${dimensions.detailWidth}, "detailHeight" = ${dimensions.detailHeight},
        "thumbnailWidth" = ${dimensions.thumbnailWidth}, "thumbnailHeight" = ${dimensions.thumbnailHeight}
        WHERE "id" = ${version}::uuid AND "productId" = ${id}::uuid AND "state" = 'PENDING'
          AND "cleanupAfter" > clock_timestamp()`;
        if (count !== 1) throw new ProductConflict();
        if (product.imageId)
          await tx.productImage.update({
            where: { id: product.imageId },
            data: {
              state: 'RETIRED',
              cleanupAfter: new Date(Date.now() + IMAGE_SAFETY_MS),
            },
          });
        return tx.product.update({
          where: { id },
          data: { imageId: version },
          include: { image: true },
        });
      })
      .catch(imageDatabaseError);
  }

  async remove(id: string) {
    await this.database.client
      .$transaction(async (tx) => {
        const product = await this.lock(tx, id);
        if (!product.imageId) return;
        await tx.product.update({ where: { id }, data: { imageId: null } });
        await tx.productImage.update({
          where: { id: product.imageId },
          data: {
            state: 'RETIRED',
            cleanupAfter: new Date(Date.now() + IMAGE_SAFETY_MS),
          },
        });
      })
      .catch(imageDatabaseError);
  }
}
