import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { ProductInput, ProductPage } from './product.validation.js';
import { productDatabaseError } from './product.errors.js';

@Injectable()
export class ProductsService {
  constructor(private readonly database: DatabaseService) {}

  create(data: ProductInput) {
    return this.database.client.product
      .create({ data: { ...data, active: true } })
      .catch(productDatabaseError);
  }
  async get(id: string) {
    const product = await this.database.client.product
      .findUnique({ where: { id } })
      .catch(productDatabaseError);
    if (!product) throw new NotFoundException();
    return product;
  }
  list(page: ProductPage) {
    return this.database.client.product
      .findMany({
        where:
          page.status === 'all' ? {} : { active: page.status === 'active' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: page.limit + 1,
        skip: page.offset,
      })
      .catch(productDatabaseError);
  }
}
