const MAX = 9007199254740991n;
export function minorAmount(raw: string): bigint {
  if (raw.length > 16 || !/^(0|[1-9][0-9]*)$/.test(raw) || raw.trim() !== raw)
    throw new Error('Invalid monetary value.');
  const value = BigInt(raw);
  if (value > MAX) throw new Error('Invalid monetary value.');
  return value;
}
export function formatPrice(raw: string): string {
  const amount = minorAmount(raw);
  return `ARS ${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(amount / 100n)},${(amount % 100n).toString().padStart(2, '0')}`;
}

/** User input is ungrouped ARS with a dot and at most two fractional digits. */
export function priceInput(raw: string): string {
  if (
    raw.length > 17 ||
    raw.trim() !== raw ||
    !/^(0|[1-9][0-9]{0,13})(\.[0-9]{1,2})?$/.test(raw)
  )
    throw new Error(
      'Use pesos with a decimal point and up to two decimal digits.',
    );
  const [whole, fraction = ''] = raw.split('.');
  const amount = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (amount > MAX)
    throw new Error('Price must not exceed 90071992547409.91 ARS.');
  return amount.toString();
}
export function priceText(raw: string): string {
  const amount = minorAmount(raw);
  return `${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`;
}
