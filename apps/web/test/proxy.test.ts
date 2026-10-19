import { afterAll, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createServer as viteServer, type ViteDevServer } from 'vite';
let vite: ViteDevServer | undefined;
const backend = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Set-Cookie',
    'probe=synthetic; HttpOnly; Path=/; SameSite=Lax',
  );
  res.end(JSON.stringify({ path: req.url, origin: req.headers.origin }));
});
afterAll(async () => {
  await vite?.close();
  backend.close();
});
it('strips only the API prefix and preserves browser Origin and cookie attributes', async () => {
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  const address = backend.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  process.env.API_PROXY_TARGET = `http://127.0.0.1:${address.port}`;
  try {
    vite = await viteServer({ server: { port: 0 }, logLevel: 'silent' });
  } finally {
    delete process.env.API_PROXY_TARGET;
  }
  await vite.listen();
  const url = vite.resolvedUrls!.local[0]!;
  const response = await fetch(new URL('/api/auth/csrf', url), {
    headers: { Origin: 'http://127.0.0.1:5173' },
  });
  expect(await response.json()).toEqual({
    path: '/auth/csrf',
    origin: 'http://127.0.0.1:5173',
  });
  expect(response.headers.get('set-cookie')).toContain(
    'HttpOnly; Path=/; SameSite=Lax',
  );
});
