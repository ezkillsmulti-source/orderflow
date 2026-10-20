import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Roles } from '../auth/roles.js';
import { productId } from '../products/product.validation.js';
import { InventoryService } from './inventory.service.js';
import { historyPage, noInventoryQuery } from './inventory.validation.js';
import { adjustmentResponse } from './inventory.response.js';
@Roles('ADMIN', 'OPERATOR')
@Controller('products/:id/inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}
  @Get()
  balance(
    @Param('id') id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    noInventoryQuery(req.originalUrl);
    res.setHeader('Cache-Control', 'no-store');
    return this.inventory.balance(productId(id));
  }
  @Get('adjustments')
  async history(
    @Param('id') id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const page = historyPage(req.originalUrl);
    const rows = await this.inventory.history(productId(id), page);
    const items = rows.slice(0, page.limit);
    const hasMore = rows.length > page.limit;
    res.setHeader('Cache-Control', 'no-store');
    return {
      items: items.map(adjustmentResponse),
      pagination: {
        limit: page.limit,
        hasMore,
        nextCursor: hasMore ? items.at(-1)!.sequence.toString() : null,
      },
    };
  }
}
