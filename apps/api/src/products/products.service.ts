import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { ProductInput, ProductPage } from './product.validation.js';
import { ProductConflict, productDatabaseError } from './product.errors.js';

@Injectable()
export class ProductsService {
  constructor(private readonly database: DatabaseService) {}

  create(data: ProductInput) {
    return this.database.client.product
      .create({ data: { ...data, active: true }, include: { image: true } })
      .catch(productDatabaseError);
  }
  async get(id: string) {
    const product = await this.database.client.product
      .findUnique({ where: { id }, include: { image: true } })
      .catch(productDatabaseError);
    if (!product) throw new NotFoundException();
    return product;
  }
  async edit(id: string, data: Partial<ProductInput>) {
    // PostgreSQL rechecks active=true after waiting for concurrent row writers.
    const [product] = await this.database.client.product
      .updateManyAndReturn({
        include: { image: true },
        where: { id, active: true },
        data,
      })
      .catch(productDatabaseError);
    if (product) return product;
    await this.get(id); // Distinguish a missing ID from an archived product.
    throw new ProductConflict();
  }
  async archive(id: string) {
    const [product] = await this.database.client.product
      .updateManyAndReturn({
        include: { image: true },
        where: { id, active: true },
        data: { active: false },
      })
      .catch(productDatabaseError);
    // A repeated archive performs no row update, preserving updatedAt.
    return product ?? this.get(id);
  }
  list(page: ProductPage) {
    return this.database.client.product
      .findMany({
        include: { image: true },
        where:
          page.status === 'all' ? {} : { active: page.status === 'active' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: page.limit + 1,
        skip: page.offset,
      })
      .catch(productDatabaseError);
  }
}
