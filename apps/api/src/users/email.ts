/** Application identifiers, not a claim that an address exists or is verified. */
export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string' || value.length > 320) {
    throw new Error('Email must be a supported ASCII email address.');
  }
  const trimmed = value.trim();
  if (!/^[!-~]+$/.test(trimmed)) {
    throw new Error('Email must be a supported ASCII email address.');
  }
  const email = trimmed.toLowerCase();
  const [local, domain, extra] = email.split('@');
  if (
    email.length > 254 ||
    !local ||
    local.length > 64 ||
    !/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(
      local,
    ) ||
    !domain ||
    !domain.includes('.') ||
    !domain
      .split('.')
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    extra !== undefined
  ) {
    throw new Error('Email must be a supported ASCII email address.');
  }
  return email;
}
