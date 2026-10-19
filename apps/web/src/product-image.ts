import { ApiError } from './api';

export interface ImageVariant {
  url: string;
  width: number;
  height: number;
}
export interface PrimaryImage {
  version: string;
  thumbnail: ImageVariant;
  detail: ImageVariant;
}
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

/** Accept only the exact application-owned path for this product/version/variant. */
export function imageSource(
  id: string,
  version: string,
  variant: 'thumbnail' | 'detail',
  path: unknown,
) {
  if (
    !uuid.test(id) ||
    !uuid.test(version) ||
    path !== `/products/${id}/image/${version}/${variant}`
  )
    throw new ApiError(502);
  return `/api${path}`;
}
export function primaryImage(id: string, value: unknown): PrimaryImage | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object') throw new ApiError(502);
  const image = value as PrimaryImage;
  if (typeof image.version !== 'string') throw new ApiError(502);
  for (const variant of ['thumbnail', 'detail'] as const) {
    const size = image[variant];
    const max = variant === 'thumbnail' ? 320 : 1600;
    if (
      !size ||
      !Number.isInteger(size.width) ||
      !Number.isInteger(size.height) ||
      size.width < 1 ||
      size.height < 1 ||
      size.width > max ||
      size.height > max
    )
      throw new ApiError(502);
    imageSource(id, image.version, variant, size.url);
  }
  return {
    version: image.version,
    thumbnail: { ...image.thumbnail },
    detail: { ...image.detail },
  };
}
