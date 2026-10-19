import { describe, expect, it } from '@jest/globals';
import { PasswordService } from '../src/auth/password.service.js';

const passwords = new PasswordService();

describe('password hashing', () => {
  it('uses independently salted Argon2id hashes and verifies correct/incorrect passwords', async () => {
    const password = ' a long test passphrase ';
    const first = await passwords.hash(password);
    const second = await passwords.hash(password);
    expect(first).not.toBe(second);
    expect(first).not.toContain(password);
    expect(first).toMatch(/^\$argon2id\$/);
    expect(await passwords.verify(first, password)).toBe(true);
    expect(await passwords.verify(second, password)).toBe(true);
    expect(await passwords.verify(first, 'different long password')).toBe(
      false,
    );
    expect(await passwords.verify(first, password.trim())).toBe(false);
  });
  it('preserves Unicode sequences rather than normalizing them', async () => {
    const password = `${'é'.repeat(15)} 🦉`;
    const encoded = await passwords.hash(password);
    expect(await passwords.verify(encoded, password)).toBe(true);
    expect(await passwords.verify(encoded, password.normalize('NFD'))).toBe(
      false,
    );
  });
  it.each(['a'.repeat(15), '🦉'.repeat(128), ' '.repeat(15)])(
    'accepts valid boundaries and whitespace unchanged',
    async (password) => {
      const encoded = await passwords.hash(password);
      expect(await passwords.verify(encoded, password)).toBe(true);
    },
  );
  it.each([
    undefined,
    null,
    42,
    Buffer.from('a'.repeat(15)),
    '',
    'a'.repeat(14),
    '🦉'.repeat(129),
    '\ud800'.repeat(15),
  ])('rejects invalid inputs for hashing and verification', async (input) => {
    await expect(passwords.hash(input)).rejects.toThrow(
      'Password must contain',
    );
    await expect(passwords.verify('invalid', input)).rejects.toThrow(
      'Password must contain',
    );
  });
  it('rejects malformed or non-Argon2id stored hashes', async () => {
    for (const hash of [
      'not-a-hash',
      '$argon2id$invalid',
      '$argon2i$invalid',
    ]) {
      expect(await passwords.verify(hash, 'long valid password')).toBe(false);
    }
  });
});
