import { ApiError } from './api';
import { primaryImage, type PrimaryImage } from './product-image';
import { minorAmount } from './money';
export interface Product {
  image: PrimaryImage | null;
  id: string;
  sku: string;
  name: string;
  description: string | null;
  priceMinor: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface Listing {
  items: Product[];
  pagination: { limit: number; offset: number; hasMore: boolean };
}
export interface Page {
  status: 'active' | 'archived' | 'all';
  limit: number;
  offset: number;
}
export function product(value: unknown): Product {
  const data = value as Partial<Product> | null;
  if (
    !data ||
    typeof data.id !== 'string' ||
    typeof data.sku !== 'string' ||
    typeof data.name !== 'string' ||
    (data.description !== null && typeof data.description !== 'string') ||
    typeof data.active !== 'boolean' ||
    typeof data.priceMinor !== 'string' ||
    typeof data.createdAt !== 'string' ||
    typeof data.updatedAt !== 'string'
  )
    throw new ApiError(502);
  try {
    minorAmount(data.priceMinor);
  } catch {
    throw new ApiError(502);
  }
  return { ...data, image: primaryImage(data.id, data.image) } as Product;
}
export function listing(value: unknown): Listing {
  const data = value as Partial<Listing> | null;
  if (
    !data ||
    !Array.isArray(data.items) ||
    !data.pagination ||
    typeof data.pagination.hasMore !== 'boolean' ||
    !Number.isInteger(data.pagination.limit) ||
    !Number.isInteger(data.pagination.offset)
  )
    throw new ApiError(502);
  return { items: data.items.map(product), pagination: data.pagination };
}
export function pageFrom(query: string): Page {
  const params = new URLSearchParams(query);
  const status = params.get('status') ?? 'active';
  const limit = params.get('limit') ?? '25';
  const offset = params.get('offset') ?? '0';
  if (
    [...params.keys()].some(
      (key) =>
        !['status', 'limit', 'offset'].includes(key) ||
        params.getAll(key).length !== 1,
    ) ||
    !['active', 'archived', 'all'].includes(status) ||
    limit.trim() !== limit ||
    offset.trim() !== offset ||
    !/^(?:[1-9][0-9]?|100)$/.test(limit) ||
    !/^(?:0|[1-9][0-9]{0,4})$/.test(offset) ||
    Number(offset) > 10000
  )
    throw new ApiError(400);
  return {
    status: status as Page['status'],
    limit: Number(limit),
    offset: Number(offset),
  };
}
export function listLink(page: Page) {
  return `#products?${new URLSearchParams({ status: page.status, limit: String(page.limit), offset: String(page.offset) })}`;
}
