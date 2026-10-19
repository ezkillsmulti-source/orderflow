import type { Product, ProductImage } from '../generated/prisma/client.js';

export function productResponse(
  product: Product & { image: ProductImage | null },
) {
  return {
    id: product.id,
    image: product.image ? imageResponse(product.id, product.image) : null,
    sku: product.sku,
    name: product.name,
    description: product.description,
    priceMinor: product.priceMinor.toString(),
    active: product.active,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

export function imageResponse(productId: string, image: ProductImage) {
  const base = `/products/${productId}/image/${image.id}`;
  return {
    version: image.id,
    thumbnail: {
      url: `${base}/thumbnail`,
      width: image.thumbnailWidth!,
      height: image.thumbnailHeight!,
    },
    detail: {
      url: `${base}/detail`,
      width: image.detailWidth!,
      height: image.detailHeight!,
    },
  };
}
