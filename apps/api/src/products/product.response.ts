import type { Product } from '../generated/prisma/client.js';

export function productResponse(product: Product) {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    priceMinor: product.priceMinor.toString(),
    active: product.active,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}
