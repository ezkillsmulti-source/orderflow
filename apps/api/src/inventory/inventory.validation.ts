import { toUSVString } from 'node:util';
import type { Request } from 'express';
import { BadRequestException } from '@nestjs/common';

export const INVENTORY_MAX = 9007199254740991n;
export interface HistoryPage {
  limit: number;
  before?: bigint;
}
export function historyPage(url: string): HistoryPage {
  const query = new URLSearchParams(
    url.includes('?') ? url.slice(url.indexOf('?') + 1) : '',
  );
  for (const key of query.keys()) {
    if (!['limit', 'before'].includes(key) || query.getAll(key).length !== 1)
      throw new BadRequestException();
  }
  const raw = query.get('limit') ?? '25';
  if (!/^[1-9][0-9]{0,2}$/.test(raw) || Number(raw) > 100)
    throw new BadRequestException();
  const before = query.get('before');
  if (
    before !== null &&
    (!/^[1-9][0-9]{0,15}$/.test(before) || BigInt(before) > INVENTORY_MAX)
  )
    throw new BadRequestException();
  return {
    limit: Number(raw),
    ...(before === null ? {} : { before: BigInt(before) }),
  };
}
export function noInventoryQuery(url: string) {
  if (
    new URLSearchParams(
      url.includes('?') ? url.slice(url.indexOf('?') + 1) : '',
    ).size
  )
    throw new BadRequestException();
}

export interface AdjustmentInput {
  delta: bigint;
  reason: string;
}
export function adjustmentInput(value: unknown): AdjustmentInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException();
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).length !== 2 ||
    !Object.hasOwn(body, 'delta') ||
    !Object.hasOwn(body, 'reason')
  )
    throw new BadRequestException();
  const { delta, reason } = body;
  if (
    typeof delta !== 'string' ||
    delta.length > 17 ||
    delta !== delta.trim() ||
    !/^-?[1-9][0-9]*$/.test(delta)
  )
    throw new BadRequestException();
  const amount = BigInt(delta);
  if (amount < -INVENTORY_MAX || amount > INVENTORY_MAX)
    throw new BadRequestException();
  if (
    typeof reason !== 'string' ||
    toUSVString(reason) !== reason ||
    reason.includes('\0')
  )
    throw new BadRequestException();
  const normalized = reason.trim();
  if (!normalized || [...normalized].length > 500)
    throw new BadRequestException();
  return { delta: amount, reason: normalized };
}
export function idempotencyKey(req: Request): string {
  // Express combines duplicate headers; rawHeaders also rejects duplicates before normalization.
  const count = req.rawHeaders.filter(
    (_, index) =>
      index % 2 === 0 &&
      req.rawHeaders[index]!.toLowerCase() === 'idempotency-key',
  ).length;
  const key = req.headers['idempotency-key'];
  if (
    count !== 1 ||
    typeof key !== 'string' ||
    key.length !== 36 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      key,
    )
  )
    throw new BadRequestException();
  return key;
}
