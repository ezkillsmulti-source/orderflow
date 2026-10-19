import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { Roles } from '../../auth/roles.js';
import { productId } from '../product.validation.js';
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
}
