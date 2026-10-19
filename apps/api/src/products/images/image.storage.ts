import { Inject, Injectable } from '@nestjs/common';
import { constants } from 'node:fs';
import { mkdir, lstat, open, realpath, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { ImageUnavailable, filesystemError } from './image.errors.js';

export const IMAGE_DIRECTORY = Symbol('IMAGE_DIRECTORY');
export type ImageVariant = 'detail' | 'thumbnail';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function workspace() {
  let path = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(path, 'pnpm-workspace.yaml'))) {
    const parent = dirname(path);
    if (parent === path)
      throw new Error('Cannot identify application workspace.');
    path = parent;
  }
  return path;
}
export function imageDirectory(raw: string | undefined) {
  if (!raw) return undefined;
  const path = resolve(raw);
  const inside = relative(workspace(), path);
  if (!isAbsolute(raw) || !inside.startsWith('..') || path === '/')
    throw new Error(
      'PRODUCT_IMAGE_STORAGE_DIR must be an absolute private directory outside the workspace.',
    );
  return path;
}

/** Only server-generated UUID directories and fixed filenames cross this boundary. */
@Injectable()
export class ImageStorage {
  constructor(
    @Inject(IMAGE_DIRECTORY) private readonly directory: string | undefined,
  ) {}

  async root() {
    if (!this.directory) throw new ImageUnavailable();
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const stat = await lstat(this.directory);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (stat.mode & 0o077) !== 0 ||
        (await realpath(this.directory)) !== this.directory
      )
        throw new ImageUnavailable();
      return this.directory;
    } catch (error) {
      return filesystemError(error);
    }
  }
  async folder(version: string, create = false) {
    if (!uuid.test(version)) throw new Error('Invalid internal image version.');
    const path = join(await this.root(), version);
    try {
      if (create) await mkdir(path, { mode: 0o700 });
      const stat = await lstat(path);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (stat.mode & 0o077) !== 0
      )
        throw new ImageUnavailable();
      return path;
    } catch (error) {
      return filesystemError(error);
    }
  }
  async write(version: string, variant: ImageVariant, bytes: Buffer) {
    const path = join(await this.folder(version), `${variant}.webp`);
    try {
      const file = await open(
        path,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
    } catch (error) {
      return filesystemError(error);
    }
  }
  async sync(version: string) {
    try {
      const folder = await open(await this.folder(version), constants.O_RDONLY);
      try {
        await folder.sync();
      } finally {
        await folder.close();
      }
      const root = await open(await this.root(), constants.O_RDONLY);
      try {
        await root.sync();
      } finally {
        await root.close();
      }
    } catch (error) {
      return filesystemError(error);
    }
  }
  async read(version: string, variant: ImageVariant) {
    try {
      const file = await open(
        join(await this.folder(version), `${variant}.webp`),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const stat = await file.stat();
        if (!stat.isFile()) throw new ImageUnavailable();
        return { file, size: stat.size };
      } catch (error) {
        await file.close();
        throw error;
      }
    } catch (error) {
      return filesystemError(error);
    }
  }
  async remove(version: string) {
    if (!uuid.test(version)) throw new Error('Invalid internal image version.');
    try {
      // rm does not follow symlinks. The root must remain private to the API user.
      await rm(join(await this.root(), version), {
        recursive: true,
        force: true,
      });
    } catch (error) {
      return filesystemError(error);
    }
  }
}
