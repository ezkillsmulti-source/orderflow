import { expect, it } from '@jest/globals';
import sharp from 'sharp';
import {
  ImageProcessor,
  IMAGE_FILE_LIMIT,
} from '../src/products/images/image.processor.js';

const processor = new ImageProcessor();
async function fixture(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: 'green' } })
    .png()
    .toBuffer();
}
it.each(['jpeg', 'png', 'webp'] as const)(
  'decodes actual %s content, strips metadata, and does not upscale',
  async (format) => {
    const bytes = await sharp(await fixture(16, 8))
      .withMetadata()
      .toFormat(format)
      .toBuffer();
    const result = await processor.process(bytes, `image/${format}`);
    expect(result.detail.info).toMatchObject({
      width: 16,
      height: 8,
      format: 'webp',
    });
    expect(result.thumbnail.info).toMatchObject({ width: 16, height: 8 });
    const metadata = await sharp(result.detail.data).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
  },
);
it('accepts exactly 5 MiB and rejects the next byte', async () => {
  const bytes = await fixture(2, 2);
  const padded = Buffer.concat([
    bytes,
    Buffer.alloc(IMAGE_FILE_LIMIT - bytes.length),
  ]);
  await expect(processor.process(padded, 'image/png')).resolves.toBeDefined();
  await expect(
    processor.process(Buffer.concat([padded, Buffer.alloc(1)]), 'image/png'),
  ).rejects.toThrow();
});
it('enforces the 8192 dimension boundary independently of pixel count', async () => {
  await expect(
    processor.process(await fixture(8192, 1), 'image/png'),
  ).resolves.toBeDefined();
  await expect(
    processor.process(await fixture(8193, 1), 'image/png'),
  ).rejects.toThrow();
});
it('enforces the 24 million decoded pixel boundary', async () => {
  await expect(
    processor.process(await fixture(6000, 4000), 'image/png'),
  ).resolves.toBeDefined();
  await expect(
    processor.process(await fixture(6000, 4001), 'image/png'),
  ).rejects.toThrow();
});
it('rejects animated WebP rather than silently selecting the first frame', async () => {
  const bytes = await sharp(Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]), {
    raw: { width: 1, height: 2, channels: 4, pageHeight: 1 },
  })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
  expect((await sharp(bytes, { animated: true }).metadata()).pages).toBe(2);
  await expect(processor.process(bytes, 'image/webp')).rejects.toThrow();
});

it('rejects APNG control chunks rather than accepting a default static frame', async () => {
  const png = await fixture(1, 1);
  const chunk = Buffer.alloc(20);
  chunk.writeUInt32BE(8);
  chunk.write('acTL', 4);
  chunk.writeUInt32BE(2, 8);
  const animated = Buffer.concat([
    png.subarray(0, 33),
    chunk,
    png.subarray(33),
  ]);
  await expect(processor.process(animated, 'image/png')).rejects.toThrow();
});

it.each(['jpeg', 'png', 'webp'] as const)(
  'rejects truncated %s content during decode',
  async (format) => {
    const bytes = await sharp(await fixture(64, 48))
      .toFormat(format)
      .toBuffer();
    await expect(
      processor.process(
        bytes.subarray(0, bytes.length - 20),
        `image/${format}`,
      ),
    ).rejects.toThrow();
  },
);
