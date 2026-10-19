import { isIP } from 'node:net';

export interface AuthConfiguration {
  production: boolean;
  secret: string;
  origins: string[];
  trustProxy: string[] | false;
}

export const AUTH_CONFIGURATION = Symbol('AUTH_CONFIGURATION');
export const IDLE_LIFETIME_MS = 30 * 60 * 1000;
export const ABSOLUTE_LIFETIME_MS = 8 * 60 * 60 * 1000;

export function readAuthConfiguration(
  env: NodeJS.ProcessEnv,
): AuthConfiguration {
  const production = env.NODE_ENV === 'production';
  if (
    env.NODE_ENV &&
    !['development', 'test', 'production'].includes(env.NODE_ENV)
  ) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }
  const secret = env.SESSION_SECRET ?? '';
  if (!/^[a-f0-9]{64}$/i.test(secret) || /^([a-f0-9])\1+$/i.test(secret)) {
    throw new Error(
      'SESSION_SECRET must be a freshly generated 32-byte hexadecimal secret.',
    );
  }
  const origins = (env.AUTH_TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim());
  if (
    !origins.length ||
    origins.some((origin) => {
      try {
        const url = new URL(origin);
        return (
          url.origin !== origin ||
          !['http:', 'https:'].includes(url.protocol) ||
          (production && url.protocol !== 'https:')
        );
      } catch {
        return true;
      }
    })
  )
    throw new Error(
      'AUTH_TRUSTED_ORIGINS must list exact trusted origins; production requires HTTPS.',
    );
  const proxies = (env.AUTH_TRUST_PROXY ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    (production && !proxies.length) ||
    proxies.some((proxy) => {
      const [address, prefix, extra] = proxy.split('/');
      const family = isIP(address ?? '');
      return (
        !family ||
        extra !== undefined ||
        (prefix !== undefined &&
          (!/^\d+$/.test(prefix) ||
            Number(prefix) < 1 ||
            Number(prefix) > (family === 4 ? 32 : 128)))
      );
    })
  )
    throw new Error(
      'AUTH_TRUST_PROXY must list explicit proxy IPs/CIDRs; production requires trusted proxies.',
    );
  return {
    production,
    secret,
    origins,
    trustProxy: proxies.length ? proxies : false,
  };
}
