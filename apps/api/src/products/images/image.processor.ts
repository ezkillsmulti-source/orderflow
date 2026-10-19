import {
  Injectable,
  UnsupportedMediaTypeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import sharp from 'sharp';

export const IMAGE_FILE_LIMIT = 5 * 1024 * 1024;
export const IMAGE_MULTIPART_LIMIT = 6 * 1024 * 1024;
export const IMAGE_PIXELS = 24_000_000;

@Injectable()
export class ImageProcessor {
  async process(bytes: Buffer, declaredType: string) {
    const type = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      ? 'jpeg'
      : bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? 'png'
        : bytes.toString('ascii', 0, 4) === 'RIFF' &&
            bytes.toString('ascii', 8, 12) === 'WEBP'
          ? 'webp'
          : undefined;
    if (
      !type ||
      ![`image/${type}`, 'application/octet-stream'].includes(declaredType)
    )
      throw new UnsupportedMediaTypeException();
    if (bytes.length > IMAGE_FILE_LIMIT)
      throw new UnprocessableEntityException();
    const options = {
      failOn: 'warning' as const,
      limitInputPixels: IMAGE_PIXELS,
    };
    try {
      // libvips may expose only the default PNG frame. Reject APNG's animation
      // control chunk explicitly; never search compressed payload bytes as text.
      if (type === 'png') {
        for (let offset = 8; offset + 12 <= bytes.length;) {
          const length = bytes.readUInt32BE(offset);
          if (length > bytes.length - offset - 12)
            throw new UnprocessableEntityException();
          if (bytes.toString('ascii', offset + 4, offset + 8) === 'acTL')
            throw new UnprocessableEntityException();
          if (bytes.toString('ascii', offset + 4, offset + 8) === 'IEND') break;
          offset += length + 12;
        }
      }
      const metadata = await sharp(bytes, options)
        .timeout({ seconds: 5 })
        .metadata();
      if (
        metadata.format !== type ||
        (metadata.pages ?? 1) !== 1 ||
        !metadata.width ||
        !metadata.height ||
        metadata.width > 8192 ||
        metadata.height > 8192 ||
        metadata.width * metadata.height > IMAGE_PIXELS
      )
        throw new UnprocessableEntityException();
      // sharp's native timeout stops processing; no Promise.race cancellation claim.
      // The second pipeline decodes only our metadata-free, bounded detail output.
      const detail = await sharp(bytes, options)
        .rotate()
        .toColourspace('srgb')
        .resize({
          width: 1600,
          height: 1600,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .timeout({ seconds: 5 })
        .toBuffer({ resolveWithObject: true });
      const thumbnail = await sharp(detail.data, options)
        .resize({
          width: 320,
          height: 320,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .timeout({ seconds: 5 })
        .toBuffer({ resolveWithObject: true });
      return { detail, thumbnail };
    } catch {
      throw new UnprocessableEntityException();
    }
  }
}
