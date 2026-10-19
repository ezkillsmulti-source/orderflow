/** Browser failures may include HTTP call logs; never publish credential headers. */
export function browserOutput(text: string, secrets: readonly string[]) {
  return secrets
    .reduce((value, secret) => value.replaceAll(secret, '[redacted]'), text)
    .replace(
      /((?:cookie|set-cookie|x-csrf-token|authorization)["']?\s*[:=]\s*)[^\r\n]*/gi,
      '$1[redacted]',
    );
}
