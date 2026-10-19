import { expect, it, vi } from 'vitest';
import {
  ImagePreview,
  imageFileError,
  IMAGE_FILE_LIMIT,
} from '../src/image-selection';
it('releases each old preview on replacement/disposal, including repeated cleanup', () => {
  const createObjectURL = vi
    .fn()
    .mockReturnValueOnce('blob:first')
    .mockReturnValueOnce('blob:second');
  const revokeObjectURL = vi.fn();
  const owner = new ImagePreview({
    createObjectURL,
    revokeObjectURL,
  } as unknown as typeof URL);
  const file = new File(['synthetic'], 'file.png', { type: 'image/png' });
  expect(owner.replace(file)).toBe('blob:first');
  expect(owner.replace(file)).toBe('blob:second');
  expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:first');
  owner.clear();
  owner.clear();
  expect(revokeObjectURL.mock.calls).toEqual([['blob:first'], ['blob:second']]);
});
it('checks empty/type/size without treating browser MIME as authoritative', () => {
  expect(
    imageFileError(new File([], 'empty.png', { type: 'image/png' })),
  ).toBeTruthy();
  expect(
    imageFileError(new File(['x'], 'file.svg', { type: 'image/svg+xml' })),
  ).toBeTruthy();
  expect(imageFileError(new File(['x'], 'file'))).toBeUndefined();
  expect(
    imageFileError(
      new File([new Uint8Array(IMAGE_FILE_LIMIT)], 'file.png', {
        type: 'image/png',
      }),
    ),
  ).toBeUndefined();
  expect(
    imageFileError(
      new File([new Uint8Array(IMAGE_FILE_LIMIT + 1)], 'file.png', {
        type: 'image/png',
      }),
    ),
  ).toMatch(/5 MiB/);
});
