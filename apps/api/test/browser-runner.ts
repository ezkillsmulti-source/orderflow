import { randomBytes } from 'node:crypto';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { createTestDatabase } from './support/test-database.js';
import { provisionDevelopmentAccounts } from '../src/users/provision-development.js';

const root = process.cwd();
const children: ChildProcess[] = [];
let db: Awaited<ReturnType<typeof createTestDatabase>> | undefined;
const secrets: string[] = [];
let stopping = false;
let imageRuntime: string | undefined;
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
  const webPort = await freePort(0);
  const webOrigin = `http://127.0.0.1:${webPort}`;
  imageRuntime = await mkdtemp(join(tmpdir(), 'orderflow-browser-images-'));
  const imageStorage = join(imageRuntime, 'storage');
  await mkdir(imageStorage, { mode: 0o700 });
  const fixture = join(imageRuntime, 'synthetic.png');
  await writeFile(
    fixture,
    await sharp({
      create: { width: 1200, height: 800, channels: 3, background: '#ede3d8' },
    })
      .composite([
        {
          input: Buffer.from(
            '<svg width="1200" height="800"><rect x="410" y="110" width="380" height="600" rx="20" fill="#7A3045"/><rect x="440" y="290" width="320" height="210" fill="#fffdfc"/><circle cx="600" cy="395" r="64" fill="#7A3045"/></svg>',
          ),
        },
      ])
      .png()
      .toBuffer(),
    { mode: 0o600 },
  );
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
    AUTH_TRUSTED_ORIGINS: webOrigin,
    E2E_WEB_ORIGIN: webOrigin,
    PRODUCT_IMAGE_STORAGE_DIR: imageStorage,
    E2E_IMAGE_FIXTURE: fixture,
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
    [
      '--config',
      resolve('apps/web/vite.config.ts'),
      '--port',
      String(webPort),
      resolve('apps/web'),
    ],
    env,
  );
  await ready(webOrigin, web);
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
      try {
        await db?.close();
      } finally {
        if (imageRuntime)
          await rm(imageRuntime, { recursive: true, force: true });
      }
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
