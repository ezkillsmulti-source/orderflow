import { randomBytes } from 'node:crypto';
import type { AuthConfiguration } from '../../src/auth/auth.configuration.js';

export const testAuthConfiguration: AuthConfiguration = {
  production: false,
  secret: randomBytes(32).toString('hex'),
  origins: ['http://127.0.0.1:3000'],
  trustProxy: false,
};
