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
