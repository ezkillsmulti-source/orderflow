import { afterEach, expect, it } from '@jest/globals';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ImageStorage,
  imageDirectory,
} from '../src/products/images/image.storage.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
it('requires a private absolute storage directory outside the workspace', () => {
  expect(imageDirectory(undefined)).toBeUndefined();
  expect(() => imageDirectory('relative')).toThrow();
  expect(() => imageDirectory(process.cwd())).toThrow();
});
it('uses immutable private variant files, supports streaming, and tolerates repeated deletion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orderflow-storage-'));
  directories.push(directory);
  const storage = new ImageStorage(directory);
  const version = randomUUID();
  await storage.folder(version, true);
  await storage.write(version, 'detail', Buffer.from('synthetic bytes'));
  await storage.sync(version);
  await expect(
    storage.write(version, 'detail', Buffer.from('replacement')),
  ).rejects.toThrow();
  const { file, size } = await storage.read(version, 'detail');
  try {
    expect(size).toBe(15);
    expect((await file.readFile()).toString()).toBe('synthetic bytes');
  } finally {
    await file.close();
  }
  await storage.remove(version);
  await storage.remove(version);
  await expect(storage.read(version, 'detail')).rejects.toThrow();
  await expect(storage.folder('../escape')).rejects.toThrow();
});
it('rejects symlink roots and version directories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orderflow-symlinks-'));
  directories.push(directory);
  const link = join(directory, 'link');
  await symlink(directory, link);
  await expect(new ImageStorage(link).root()).rejects.toThrow();
  const version = randomUUID();
  await symlink(directory, join(directory, version));
  await expect(new ImageStorage(directory).folder(version)).rejects.toThrow();
});
