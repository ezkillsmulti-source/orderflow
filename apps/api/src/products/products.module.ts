import { ImageProcessor } from './images/image.processor.js';
import { ImageCleanup } from './images/image.cleanup.js';
import { ImageUploadInterceptor } from './images/image-upload.interceptor.js';
import { ImagesController } from './images/images.controller.js';
import { ImagesService } from './images/images.service.js';
import {
  IMAGE_DIRECTORY,
  ImageStorage,
  imageDirectory,
} from './images/image.storage.js';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [ProductsController, ImagesController],
  providers: [
    ProductsService,
    ImagesService,
    ImageProcessor,
    ImageCleanup,
    ImageUploadInterceptor,
    ImageStorage,
    {
      provide: IMAGE_DIRECTORY,
      useFactory: () => imageDirectory(process.env.PRODUCT_IMAGE_STORAGE_DIR),
    },
  ],
})
export class ProductsModule {}
