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
