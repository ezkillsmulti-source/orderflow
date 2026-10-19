import { spawnSync } from 'node:child_process';
import { expect, it } from '@jest/globals';

it('runs Prisma generation despite an unrelated invalid API port', () => {
  const result = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'generate'],
    {
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://test:placeholder@127.0.0.1:1/test',
        PORT: 'invalid',
      },
      encoding: 'utf8',
      timeout: 15000,
    },
  );
  expect(result.status).toBe(0);
});
