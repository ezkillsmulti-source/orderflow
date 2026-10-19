import { expect, it } from 'vitest';
import { formatPrice, minorAmount, priceInput, priceText } from '../src/money';
import { changedFields, validateFields } from '../src/product-form';
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

it.each([
  ['0', '0'],
  ['0.01', '1'],
  ['1.5', '150'],
  ['1250.50', '125050'],
  ['90071992547409.91', '9007199254740991'],
])('parses explicit decimal ARS %s exactly', (raw, expected) => {
  expect(priceInput(raw)).toBe(expected);
  expect(priceInput(priceText(expected))).toBe(expected);
});
it.each([
  '',
  '01',
  '.5',
  '1.',
  '-1',
  '+1',
  '1e2',
  '1,25',
  '1,000.00',
  '1.234',
  ' 1',
  '1\n',
  '90071992547409.92',
])('rejects ambiguous or out-of-range price %s', (raw) => {
  expect(() => priceInput(raw)).toThrow();
});
it('validates Unicode bounds and computes only normalized changed fields', () => {
  const fields = {
    sku: ' SKU ',
    name: '🦉'.repeat(200),
    description: ' ',
    price: '0',
  };
  const { data, errors } = validateFields(fields);
  expect(errors).toEqual({});
  const original = {
    ...data,
    id: 'id',
    active: true,
    createdAt: '',
    updatedAt: '',
  };
  expect(changedFields(data, original)).toEqual({});
  expect(changedFields({ ...data, name: 'Different' }, original)).toEqual({
    name: 'Different',
  });
  expect(
    validateFields({
      ...fields,
      name: '\ud800',
      description: '\0',
      sku: ' bad sku',
      price: '-1',
    }).errors,
  ).toHaveProperty('name');
  expect(
    validateFields({ ...fields, name: '🦉'.repeat(201) }).errors.name,
  ).toBeTruthy();
});
