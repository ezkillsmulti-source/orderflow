import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';

export class ImageUnavailable extends ServiceUnavailableException {}
export function imageDatabaseError(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2037'].includes(error.code)
  ) {
    throw new ImageUnavailable();
  }
  throw error;
}
export function filesystemError(error: unknown): never {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    [
      'ENOENT',
      'EACCES',
      'EPERM',
      'ENOSPC',
      'EIO',
      'EROFS',
      'EMFILE',
      'ENFILE',
      'ELOOP',
      'ENOTDIR',
    ].includes(String(error.code))
  ) {
    throw new ImageUnavailable();
  }
  throw error;
}
