import { randomBytes } from 'node:crypto';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { createTestDatabase } from './support/test-database.js';
import { provisionDevelopmentAccounts } from '../src/users/provision-development.js';

const root = process.cwd();
const children: ChildProcess[] = [];
let db: Awaited<ReturnType<typeof createTestDatabase>> | undefined;
const secrets: string[] = [];
let stopping = false;
function safe(text: string) {
  return secrets.reduce(
    (value, secret) => value.replaceAll(secret, '[redacted]'),
    text,
  );
}
function start(file: string, args: string[], env: NodeJS.ProcessEnv) {
  if (stopping) throw new Error('Browser verification interrupted.');
  const child = spawn(process.execPath, [file, ...args], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  // Server logs are not test artifacts and may contain request details. Do not print them.
  child.stdout?.resume();
  child.stderr?.resume();
  return child;
}
async function ready(url: string, child: ChildProcess) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (stopping || child.exitCode !== null || child.signalCode)
      throw new Error('Browser test server exited before readiness.');
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* Await readiness, not a fixed delay. */
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Browser test server readiness timed out.');
}
async function freePort(port: number) {
  const probe = createServer();
  probe.listen(port, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('No test port.');
  probe.close();
  await once(probe, 'close');
  return address.port;
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}
async function main() {
  await freePort(5173); // Fail rather than reuse another developer's frontend.
  const port = await freePort(0);
  db = await createTestDatabase();
  const password = randomBytes(24).toString('hex');
  const secret = randomBytes(32).toString('hex');
  secrets.push(password, secret, db.databaseUrl);
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    DATABASE_URL: db.databaseUrl,
    PORT: String(port),
    SESSION_SECRET: secret,
    AUTH_TRUSTED_ORIGINS: 'http://127.0.0.1:5173',
    AUTH_TRUST_PROXY: '',
    API_PROXY_TARGET: `http://127.0.0.1:${port}`,
    E2E_DATABASE_URL: db.databaseUrl,
    DEV_ADMIN_EMAIL: 'browser-admin@example.test',
    DEV_ADMIN_PASSWORD: password,
    DEV_OPERATOR_EMAIL: 'browser-operator@example.test',
    DEV_OPERATOR_PASSWORD: password,
  };
  execFileSync('pnpm', ['db:migrate'], {
    cwd: root,
    env,
    stdio: 'pipe',
    timeout: 30000,
  });
  await provisionDevelopmentAccounts(db.client, env);
  const api = start(resolve('apps/api/.test-dist/src/main.js'), [], env);
  await ready(`http://127.0.0.1:${port}/health/ready`, api);
  const web = start(
    resolve('apps/web/node_modules/vite/bin/vite.js'),
    ['--config', resolve('apps/web/vite.config.ts'), resolve('apps/web')],
    env,
  );
  await ready('http://127.0.0.1:5173', web);
  const browser = spawn(
    process.execPath,
    [
      resolve('apps/web/node_modules/@playwright/test/cli.js'),
      'test',
      '--config',
      resolve('apps/web/playwright.config.ts'),
      ...process.argv.slice(2),
    ],
    { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  children.push(browser);
  let output = '';
  browser.stdout?.on('data', (data: Buffer) => {
    output += data.toString();
  });
  browser.stderr?.on('data', (data: Buffer) => {
    output += data.toString();
  });
  const [code] = await once(browser, 'exit');
  process.stdout.write(safe(output));
  if (code !== 0) throw new Error('Browser checks failed.');
}
let closing: Promise<void> | undefined;
function cleanup() {
  closing ??= (async () => {
    try {
      for (const child of [...children].reverse()) await stop(child);
    } finally {
      await db?.close();
    }
  })();
  return closing;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopping = true;
    process.exitCode = 1;
    for (const child of children) child.kill('SIGTERM');
    // main's finally performs cleanup after any in-flight database setup finishes.
  });
}
try {
  await main();
} catch {
  console.error(
    'Browser verification failed. Check the dedicated test server, ports, and browser installation.',
  );
  process.exitCode = 1;
} finally {
  await cleanup();
}
