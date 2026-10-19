import { describe, expect, it } from '@jest/globals';
import { readDatabaseUrl, readEnvironment } from '../src/config/environment.js';

const databaseUrl = 'postgresql://test:placeholder@localhost:5432/test';

describe('environment', () => {
  it('validates the database URL independently of API settings', () => {
    expect(readDatabaseUrl(databaseUrl)).toBe(databaseUrl);
  });

  it('accepts PostgreSQL and defaults the API port', () => {
    expect(readEnvironment({ DATABASE_URL: databaseUrl })).toEqual({
      databaseUrl,
      port: 3000,
    });
  });

  it.each([
    undefined,
    '',
    'https://example.com',
    'postgresql://localhost/db',
    `${databaseUrl}?options=-c%20statement_timeout=0`,
  ])(
    'rejects missing or invalid database configuration without echoing it',
    (DATABASE_URL) => {
      expect(() => readEnvironment({ DATABASE_URL })).toThrow(/DATABASE_URL/);
      try {
        readEnvironment({ DATABASE_URL });
      } catch (error) {
        expect(String(error)).not.toContain('placeholder');
      }
    },
  );

  it.each(['0', '65536', '-1', '1.5', 'abc', ''])(
    'rejects invalid port %s',
    (PORT) => {
      expect(() =>
        readEnvironment({ DATABASE_URL: databaseUrl, PORT }),
      ).toThrow(/PORT/);
    },
  );
});
