import {
  Body,
  Controller,
  Get,
  Patch,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Roles } from '../auth/roles.js';
import {
  archiveInput,
  productId,
  productInput,
  productPage,
  productEncoding,
} from './product.validation.js';
import { productResponse } from './product.response.js';
import { ProductsService } from './products.service.js';

@Roles('ADMIN', 'OPERATOR')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Roles('ADMIN')
  @Post()
  async create(
    @Body() body: unknown,
    @Req() req: RawBodyRequest<Request>,
    @Res({ passthrough: true }) res: Response,
  ) {
    productEncoding(req);
    const product = await this.products.create(productInput(body));
    res.setHeader('Location', `/products/${product.id}`);
    res.setHeader('Cache-Control', 'no-store');
    return productResponse(product);
  }
  @Roles('ADMIN')
  @Patch(':id')
  async edit(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: RawBodyRequest<Request>,
    @Res({ passthrough: true }) res: Response,
  ) {
    productEncoding(req);
    const product = await this.products.edit(
      productId(id),
      productInput(body, true),
    );
    res.setHeader('Cache-Control', 'no-store');
    return productResponse(product);
  }
  @Roles('ADMIN')
  @Post(':id/archive')
  @HttpCode(200)
  async archive(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: RawBodyRequest<Request>,
    @Res({ passthrough: true }) res: Response,
  ) {
    archiveInput(body, req);
    const product = await this.products.archive(productId(id));
    res.setHeader('Cache-Control', 'no-store');
    return productResponse(product);
  }
  @Get(':id')
  async get(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return productResponse(await this.products.get(productId(id)));
  }
  @Get()
  async list(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const page = productPage(req.originalUrl);
    const products = await this.products.list(page);
    res.setHeader('Cache-Control', 'no-store');
    return {
      items: products.slice(0, page.limit).map(productResponse),
      pagination: {
        limit: page.limit,
        offset: page.offset,
        hasMore: products.length > page.limit,
      },
    };
  }
}
