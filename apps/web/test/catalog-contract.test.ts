import { expect, it } from 'vitest';
import { product, listing } from '../src/catalog-data';

it('preserves the existing catalog and exact money with additive backend image metadata', () => {
  const value = {
    id: '00000000-0000-4000-8000-000000000001',
    sku: 'IMAGE',
    name: 'Product',
    description: null,
    priceMinor: '9007199254740991',
    active: true,
    createdAt: '2026-10-19T00:00:00Z',
    updatedAt: '2026-10-19T00:00:00Z',
    image: {
      version: '00000000-0000-4000-8000-000000000002',
      thumbnail: {
        url: '/products/00000000-0000-4000-8000-000000000001/image/00000000-0000-4000-8000-000000000002/thumbnail',
        width: 10,
        height: 8,
      },
      detail: {
        url: '/products/00000000-0000-4000-8000-000000000001/image/00000000-0000-4000-8000-000000000002/detail',
        width: 10,
        height: 8,
      },
    },
  };
  expect(product(value).priceMinor).toBe(value.priceMinor);
  expect(product({ ...value, image: null }).sku).toBe('IMAGE');
  expect(
    listing({
      items: [value],
      pagination: { limit: 25, offset: 0, hasMore: false },
    }).items,
  ).toHaveLength(1);
});
