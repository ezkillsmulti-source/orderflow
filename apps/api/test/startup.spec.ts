import { spawnSync } from 'node:child_process';
import { describe, expect, it } from '@jest/globals';

describe('startup configuration', () => {
  it.each([
    { DATABASE_URL: '', PORT: '3000' },
    { DATABASE_URL: 'private-invalid-value', PORT: '3000' },
    {
      DATABASE_URL: 'postgresql://test:placeholder@localhost/test',
      PORT: 'bad',
    },
  ])('fails clearly without leaking configuration', (configuration) => {
    const result = spawnSync(process.execPath, ['.test-dist/src/main.js'], {
      env: { ...process.env, ...configuration },
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('API startup failed');
    expect(result.stderr).not.toMatch(
      /private-invalid-value|placeholder|at bootstrap/,
    );
  });
});
