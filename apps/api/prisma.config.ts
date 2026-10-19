import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';
import { readDatabaseUrl } from './src/config/environment.js';

config({
  path: fileURLToPath(new URL('../../.env', import.meta.url)),
  quiet: true,
});

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Generation and static checks need no database or local .env file.
  datasource: {
    url: process.env.DATABASE_URL
      ? readDatabaseUrl(process.env.DATABASE_URL)
      : undefined,
  },
});
