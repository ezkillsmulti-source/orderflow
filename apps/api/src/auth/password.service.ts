import { argon2id, hash, verify } from 'argon2';
import { toUSVString } from 'node:util';

export function validatePassword(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length > 256 ||
    toUSVString(value) !== value ||
    Buffer.byteLength(value, 'utf8') > 512 ||
    [...value].length < 15 ||
    [...value].length > 128
  ) {
    throw new Error(
      'Password must contain 15 through 128 Unicode code points and at most 512 UTF-8 bytes.',
    );
  }
}

/** Internal service: callers must never expose or log its encoded hashes. */
export class PasswordService {
  async hash(password: unknown): Promise<string> {
    validatePassword(password);
    return hash(password, {
      type: argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
      hashLength: 32,
    });
  }

  async verify(encodedHash: string, password: unknown): Promise<boolean> {
    validatePassword(password);
    if (!encodedHash.startsWith('$argon2id$')) return false;
    try {
      return await verify(encodedHash, password);
    } catch {
      return false;
    }
  }
}
