import type { Product } from './catalog-data';
import { priceInput } from './money';
export interface Fields {
  sku: string;
  name: string;
  description: string;
  price: string;
}
export interface ProductInput {
  sku: string;
  name: string;
  description: string | null;
  priceMinor: string;
}
export type FieldErrors = Partial<Record<keyof Fields, string>>;
function textValid(raw: string, max: number) {
  return (
    !/[\uD800-\uDFFF]/u.test(raw) &&
    !raw.includes('\0') &&
    [...raw.trim()].length <= max
  );
}
export function validateFields(fields: Fields): {
  errors: FieldErrors;
  data: ProductInput;
} {
  const errors: FieldErrors = {};
  if (
    !textValid(fields.sku, 64) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fields.sku.trim())
  )
    errors.sku =
      'Use 1–64 ASCII letters, digits, dots, underscores or hyphens, starting with a letter or digit.';
  if (!textValid(fields.name, 200) || !fields.name.trim())
    errors.name = 'Enter a valid name of 1–200 Unicode characters.';
  if (!textValid(fields.description, 2000))
    errors.description =
      'Use valid text of no more than 2,000 Unicode characters.';
  let priceMinor = '0';
  try {
    priceMinor = priceInput(fields.price);
  } catch (error) {
    errors.price =
      error instanceof Error ? error.message : 'Enter a valid price.';
  }
  return {
    errors,
    data: {
      sku: fields.sku.trim(),
      name: fields.name.trim(),
      description: fields.description.trim() || null,
      priceMinor,
    },
  };
}
export function changedFields(
  data: ProductInput,
  original: Product,
): Partial<ProductInput> {
  const changes: Partial<ProductInput> = {};
  if (data.sku !== original.sku) changes.sku = data.sku;
  if (data.name !== original.name) changes.name = data.name;
  if (data.description !== original.description)
    changes.description = data.description;
  if (data.priceMinor !== original.priceMinor)
    changes.priceMinor = data.priceMinor;
  return changes;
}
