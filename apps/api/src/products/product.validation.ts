import { toUSVString } from 'node:util';
import { BadRequestException, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

export interface ProductInput {
  sku: string;
  name: string;
  description?: string | null;
  priceMinor: bigint;
}
export interface ProductPage {
  status: 'active' | 'archived' | 'all';
  limit: number;
  offset: number;
}
function invalid(): never {
  throw new BadRequestException();
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || toUSVString(value) !== value) invalid();
  const result = value.trim();
  // PostgreSQL TEXT cannot store U+0000.
  if (result.includes('\0') || [...result].length > max) invalid();
  return result;
}
/** Nest retains bytes with rawBody=true, so invalid UTF-8 cannot be hidden by decoding. */
export function productEncoding(req: RawBodyRequest<Request>): void {
  if (!req.is('application/json')) invalid();
  const charset = /charset\s*=\s*"?([^";\s]+)/i.exec(
    req.headers['content-type'] ?? '',
  )?.[1];
  if (charset && charset.toLowerCase() !== 'utf-8') invalid();
  if (!req.rawBody) invalid();
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(req.rawBody);
  } catch {
    invalid();
  }
}
export function productId(value: string): string {
  if (
    value.length !== 36 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    invalid();
  return value.toLowerCase();
}
export function productInput(value: unknown): ProductInput;
export function productInput(
  value: unknown,
  patch: true,
): Partial<ProductInput>;
export function productInput(
  value: unknown,
  patch = false,
): Partial<ProductInput> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  const fields = Object.keys(body);
  if (
    !fields.length ||
    fields.some(
      (key) => !['sku', 'name', 'description', 'priceMinor'].includes(key),
    )
  )
    invalid();
  if (
    !patch &&
    ['sku', 'name', 'priceMinor'].some((key) => !Object.hasOwn(body, key))
  )
    invalid();
  const result: Partial<ProductInput> = {};
  if (Object.hasOwn(body, 'sku')) {
    const sku = text(body.sku, 64);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sku)) invalid();
    result.sku = sku;
  }
  if (Object.hasOwn(body, 'name')) {
    const name = text(body.name, 200);
    if (!name.length) invalid();
    result.name = name;
  }
  if (Object.hasOwn(body, 'description')) {
    result.description =
      body.description === null ? null : text(body.description, 2000) || null;
  }
  if (Object.hasOwn(body, 'priceMinor')) {
    const raw = body.priceMinor;
    if (
      typeof raw !== 'string' ||
      raw.length > 16 ||
      raw !== raw.trim() ||
      !/^(0|[1-9][0-9]*)$/.test(raw)
    )
      invalid();
    const amount = BigInt(raw);
    if (amount > 9007199254740991n) invalid();
    result.priceMinor = amount;
  }
  return result;
}
/** Parse the original query so repeated keys cannot be hidden by parser settings. */
export function productPage(url: string): ProductPage {
  const query = new URLSearchParams(
    url.includes('?') ? url.slice(url.indexOf('?') + 1) : '',
  );
  for (const key of query.keys()) {
    if (
      !['status', 'limit', 'offset'].includes(key) ||
      query.getAll(key).length !== 1
    )
      invalid();
  }
  const status = query.get('status') ?? 'active';
  if (status !== 'active' && status !== 'archived' && status !== 'all')
    invalid();
  function bounded(
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const raw = query.get(key);
    if (raw === null) return fallback;
    if (raw !== raw.trim() || raw.length > 5 || !/^(0|[1-9][0-9]*)$/.test(raw))
      invalid();
    const value = Number(raw);
    if (value < min || value > max) invalid();
    return value;
  }
  return {
    status,
    limit: bounded('limit', 25, 1, 100),
    offset: bounded('offset', 0, 0, 10000),
  };
}

export function archiveInput(
  value: unknown,
  req: RawBodyRequest<Request>,
): void {
  if (req.rawBody) productEncoding(req);
  else if (
    req.headers['transfer-encoding'] ||
    Number(req.headers['content-length'] ?? 0) > 0
  )
    invalid();
  if (value === undefined) return;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length
  )
    invalid();
}
