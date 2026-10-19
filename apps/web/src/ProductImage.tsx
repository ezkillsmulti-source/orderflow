import { useState } from 'react';
import type { Product } from './catalog-data';
import { imageSource } from './product-image';

export function ProductImage({
  data,
  thumbnail = false,
}: {
  data: Product;
  thumbnail?: boolean;
}) {
  // A new server version gets its own load/error state, without retrying a failed URL.
  return (
    <ImageVersion
      key={data.image?.version ?? 'none'}
      data={data}
      thumbnail={thumbnail}
    />
  );
}
function ImageVersion({
  data,
  thumbnail,
}: {
  data: Product;
  thumbnail: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const variant = thumbnail ? 'thumbnail' : 'detail';
  const image = data.image?.[variant];
  const label = !image
    ? 'No image'
    : failed
      ? 'Image unavailable'
      : 'Loading image';
  return (
    <div
      className={`product-picture ${thumbnail ? 'thumbnail' : 'detail-picture'}`}
    >
      {image && !failed ? (
        <>
          {!loaded && (
            <span className="sr-only">Loading image for {data.name}</span>
          )}
          <img
            src={imageSource(data.id, data.image!.version, variant, image.url)}
            width={image.width}
            height={image.height}
            alt={`Product image: ${data.name}`}
            loading={thumbnail ? 'lazy' : 'eager'}
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        </>
      ) : (
        <span
          className="image-fallback"
          role="img"
          aria-label={`${label} for ${data.name}`}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="m3 17 6-6 4 4 3-3 5 5" />
            <circle cx="15.5" cy="7.5" r="1.5" />
          </svg>
          <span className={thumbnail ? 'sr-only' : ''}>{label}</span>
        </span>
      )}
    </div>
  );
}
