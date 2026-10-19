import { expect, it } from 'vitest';
import { formatPrice, minorAmount } from '../src/money';
import { pageFrom, listing } from '../src/catalog-data';
it('formats exact ARS without floating-point business values', () => {
  expect(formatPrice('0')).toBe('ARS 0,00');
  expect(formatPrice('1')).toBe('ARS 0,01');
  expect(formatPrice('125000')).toBe('ARS 1.250,00');
  expect(formatPrice('9007199254740991')).toBe('ARS 90.071.992.547.409,91');
});
it.each(['01', '-1', '1.0', '1\n', '9007199254740992'])(
  'rejects noncanonical API money %s',
  (raw) => {
    expect(() => minorAmount(raw)).toThrow();
  },
);
it('bounds route pagination before requesting the API and rejects malformed response prices', () => {
  expect(pageFrom('')).toEqual({ status: 'active', limit: 25, offset: 0 });
  expect(pageFrom('status=all&offset=10000&limit=100').offset).toBe(10000);
  for (const query of [
    'limit=101',
    'limit=0',
    'offset=10001',
    'status=no',
    'limit=1&limit=2',
  ])
    expect(() => pageFrom(query)).toThrow();
  expect(() =>
    listing({
      items: [{}],
      pagination: { limit: 25, offset: 0, hasMore: false },
    }),
  ).toThrow();
});
