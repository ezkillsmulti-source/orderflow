import { describe, expect, it } from '@jest/globals';
import { readAuthConfiguration } from '../src/auth/auth.configuration.js';
import { testAuthConfiguration } from './support/auth-configuration.js';
import { spawnSync } from 'node:child_process';

const valid = {
  NODE_ENV: 'production',
  SESSION_SECRET: testAuthConfiguration.secret,
  AUTH_TRUSTED_ORIGINS: 'https://orderflow.example',
  AUTH_TRUST_PROXY: '127.0.0.1/32,::1/128',
};
describe('authentication configuration', () => {
  it('fails actual startup before connecting or echoing unsafe production settings', () => {
    const result = spawnSync(process.execPath, ['.test-dist/src/main.js'], {
      env: {
        ...process.env,
        ...valid,
        DATABASE_URL: 'postgresql://test:placeholder@127.0.0.1:1/test',
        SESSION_SECRET: 'private-invalid-secret',
      },
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('API startup failed');
    expect(result.stderr).not.toMatch(
      /private-invalid-secret|placeholder|Prisma|at bootstrap/,
    );
  });
  it('accepts explicit HTTPS production origins and limited proxy CIDRs', () => {
    expect(readAuthConfiguration(valid)).toMatchObject({
      production: true,
      origins: ['https://orderflow.example'],
      trustProxy: ['127.0.0.1/32', '::1/128'],
    });
  });
  it.each([
    { SESSION_SECRET: '' },
    { SESSION_SECRET: 'replace_with_secret' },
    { SESSION_SECRET: '0'.repeat(64) },
    { AUTH_TRUSTED_ORIGINS: '' },
    { AUTH_TRUSTED_ORIGINS: '*' },
    { AUTH_TRUSTED_ORIGINS: 'http://orderflow.example' },
    { AUTH_TRUSTED_ORIGINS: 'https://orderflow.example/path' },
    { AUTH_TRUSTED_ORIGINS: 'https://name:secret@orderflow.example' },
    { AUTH_TRUST_PROXY: '' },
    { AUTH_TRUST_PROXY: 'true' },
    { AUTH_TRUST_PROXY: '1' },
    { AUTH_TRUST_PROXY: '0.0.0.0/0' },
    { AUTH_TRUST_PROXY: '::/0' },
    { NODE_ENV: 'prod' },
  ])(
    'rejects unsafe/missing configuration without exposing inputs',
    (overrides) => {
      expect(() => readAuthConfiguration({ ...valid, ...overrides })).toThrow();
    },
  );
});
