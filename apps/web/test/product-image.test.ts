import { expect, it } from 'vitest';
import { imageSource, primaryImage } from '../src/product-image';
const id = '00000000-0000-4000-8000-000000000001';
const version = '00000000-0000-4000-8000-000000000002';
const path = `/products/${id}/image/${version}/detail`;
it('adds the proxy prefix exactly once and rejects foreign or malformed descriptor URLs', () => {
  expect(imageSource(id, version, 'detail', path)).toBe(`/api${path}`);
  for (const value of [
    `/api${path}`,
    `https://evil.example${path}`,
    `//evil.example${path}`,
    `${path}?token=x`,
    `${path}#fragment`,
    path.replace(id, version),
    path.replace('/detail', '/%64etail'),
    '/products/../image',
    null,
  ])
    expect(() => imageSource(id, version, 'detail', value)).toThrow();
});
it('validates dimensions and image versions before rendering', () => {
  const value = {
    version,
    detail: { url: path, width: 1600, height: 1000 },
    thumbnail: {
      url: path.replace('/detail', '/thumbnail'),
      width: 320,
      height: 200,
    },
  };
  expect(primaryImage(id, null)).toBeNull();
  expect(primaryImage(id, value)).toEqual(value);
  for (const image of [
    undefined,
    {},
    { ...value, version: 'bad' },
    { ...value, detail: { ...value.detail, width: 1601 } },
    { ...value, thumbnail: { ...value.thumbnail, height: 0 } },
  ])
    expect(() => primaryImage(id, image)).toThrow();
});
