import { describe, expect, it } from '@jest/globals';
import { normalizeEmail } from '../src/users/email.js';

describe('email identifiers', () => {
  it('trims surrounding whitespace and folds case without provider transformations', () => {
    expect(normalizeEmail(' \tAlice.Name+Tag@EXAMPLE.COM\n')).toBe(
      'alice.name+tag@example.com',
    );
    expect(normalizeEmail('alicename@example.com')).not.toBe(
      normalizeEmail('alice.name@example.com'),
    );
    expect(normalizeEmail('alice+tag@example.com')).not.toBe(
      normalizeEmail('alice@example.com'),
    );
  });
  it.each([
    undefined,
    3,
    '',
    'a',
    'a b@example.com',
    'a@@example.com',
    '.a@example.com',
    'a..b@example.com',
    'a@-example.com',
    'a@example..com',
    'á@example.com',
    'a@ejémplo.com',
    'K@example.com',
    `${'a'.repeat(65)}@example.com`,
    `a@${'b'.repeat(64)}.com`,
    'a'.repeat(321),
  ])('rejects unsupported addresses without returning input', (input) => {
    expect(() => normalizeEmail(input)).toThrow(
      'Email must be a supported ASCII email address.',
    );
  });
});
