import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { ImageStorage, type ImageVariant } from './image.storage.js';
import { imageDatabaseError } from './image.errors.js';

@Injectable()
export class ImagesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: ImageStorage,
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
}
