import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  cpSync,
  rmSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';

/** Only creates/drops a random database on the explicitly configured test server. */
export async function createTestDatabase() {
  const raw = process.env.TEST_DATABASE_ADMIN_URL;
  if (!raw)
    throw new Error(
      'TEST_DATABASE_ADMIN_URL is required for a dedicated test server.',
    );
  const name = `orderflow_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Client({
    connectionString: raw,
    connectionTimeoutMillis: 3000,
    query_timeout: 5000,
  });
  const url = new URL(raw);
  url.pathname = `/${name}`;
  const databaseUrl = url.toString();
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  async function close() {
    try {
      await client.$disconnect();
    } finally {
      try {
        await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    }
  }
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } catch (error) {
    await close();
    throw error;
  }
  function migrate(initialOnly: boolean | string = false) {
    const directory = mkdtempSync(join(tmpdir(), 'orderflow-test-migrations-'));
    try {
      const migrations = initialOnly
        ? join(directory, 'migrations')
        : resolve('prisma/migrations');
      if (initialOnly) {
        const through =
          initialOnly === true ? '20261019000000_initial_product' : initialOnly;
        for (const entry of readdirSync(resolve('prisma/migrations'), {
          withFileTypes: true,
        })) {
          if (entry.isDirectory() && entry.name <= through)
            cpSync(
              resolve('prisma/migrations', entry.name),
              join(migrations, entry.name),
              { recursive: true },
            );
        }
        cpSync(
          resolve('prisma/migrations/migration_lock.toml'),
          join(migrations, 'migration_lock.toml'),
        );
      }
      const config = join(directory, 'prisma.config.mjs');
      writeFileSync(
        config,
        `export default ${JSON.stringify({ schema: resolve('prisma/schema.prisma'), migrations: { path: migrations }, datasource: { url: databaseUrl } })};`,
      );
      execFileSync(
        process.execPath,
        [
          'node_modules/prisma/build/index.js',
          'migrate',
          'deploy',
          '--config',
          config,
        ],
        {
          env: { ...process.env, DATABASE_URL: databaseUrl },
          stdio: 'pipe',
          timeout: 20000,
        },
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  return { client, databaseUrl, migrate, close };
}
