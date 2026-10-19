import {
  BadRequestException,
  Controller,
  Get,
  Put,
  Delete,
  HttpCode,
  UseInterceptors,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { Roles } from '../../auth/roles.js';
import { productId } from '../product.validation.js';
import { productResponse } from '../product.response.js';
import {
  ImageUploadInterceptor,
  type ImageUploadRequest,
} from './image-upload.interceptor.js';
import { ImagesService } from './images.service.js';

@Roles('ADMIN', 'OPERATOR')
@Controller('products')
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  @Get(':id/image/:version/:variant')
  async read(
    @Param('id') id: string,
    @Param('version') version: string,
    @Param('variant') variant: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (
      Object.keys(req.query).length ||
      !['thumbnail', 'detail'].includes(variant)
    )
      throw new BadRequestException();
    const { file, size } = await this.images.read(
      productId(id),
      productId(version),
      variant as 'thumbnail' | 'detail',
    );
    res.set({
      'Content-Type': 'image/webp',
      'Content-Length': String(size),
      'Content-Disposition': 'inline; filename="product.webp"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    try {
      await pipeline(file.createReadStream(), res);
    } catch {
      if (!res.destroyed) res.destroy();
    }
  }

  @Roles('ADMIN')
  @Put(':id/image')
  @UseInterceptors(ImageUploadInterceptor)
  async replace(
    @Param('id') id: string,
    @Req() req: ImageUploadRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    if (!req.file || !req.imageVersion) throw new BadRequestException();
    return productResponse(
      await this.images.replace(
        productId(id),
        req.imageVersion,
        req.file.path,
        req.file.mimetype,
      ),
    );
  }

  @Roles('ADMIN')
  @Delete(':id/image')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (
      Object.keys(req.query).length ||
      (req.headers['content-length'] &&
        req.headers['content-length'] !== '0') ||
      req.headers['transfer-encoding']
    )
      throw new BadRequestException();
    res.setHeader('Cache-Control', 'no-store');
    await this.images.remove(productId(id));
  }
}
