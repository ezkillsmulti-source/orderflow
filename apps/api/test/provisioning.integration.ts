import { spawnSync } from 'node:child_process';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { provisionDevelopmentAccounts } from '../src/users/provision-development.js';
import { PasswordService } from '../src/auth/password.service.js';
import { createTestDatabase } from './support/test-database.js';

let db: Awaited<ReturnType<typeof createTestDatabase>>;
const environment = {
  NODE_ENV: 'development',
  DEV_ADMIN_EMAIL: ' Admin@Example.test ',
  DEV_ADMIN_PASSWORD: 'test admin passphrase',
  DEV_OPERATOR_EMAIL: 'operator@example.test',
  DEV_OPERATOR_PASSWORD: 'test operator passphrase',
};
beforeAll(async () => {
  db = await createTestDatabase();
  db.migrate();
});
beforeEach(async () => {
  await db.client.user.deleteMany();
});
afterAll(async () => {
  await db?.close();
});

describe('explicit development provisioning', () => {
  it('creates only the missing companion and preserves the matching existing account', async () => {
    const before = await db.client.user.create({
      data: {
        email: 'admin@example.test',
        role: 'ADMIN',
        passwordHash: await new PasswordService().hash(
          environment.DEV_ADMIN_PASSWORD,
        ),
      },
    });
    expect(await provisionDevelopmentAccounts(db.client, environment)).toEqual({
      created: 1,
      existing: 1,
    });
    expect(
      await db.client.user.findUnique({ where: { id: before.id } }),
    ).toEqual(before);
    expect(await db.client.user.count()).toBe(2);
  });
  it('creates both roles with hashes and repeats without changing any stored fields', async () => {
    expect(await provisionDevelopmentAccounts(db.client, environment)).toEqual({
      created: 2,
      existing: 0,
    });
    const before = await db.client.user.findMany({ orderBy: { email: 'asc' } });
    expect(
      before.map(({ email, role, active }) => ({ email, role, active })),
    ).toEqual([
      { email: 'admin@example.test', role: 'ADMIN', active: true },
      { email: 'operator@example.test', role: 'OPERATOR', active: true },
    ]);
    const passwords = new PasswordService();
    expect(
      await passwords.verify(
        before[0]!.passwordHash,
        environment.DEV_ADMIN_PASSWORD,
      ),
    ).toBe(true);
    expect(
      await passwords.verify(
        before[1]!.passwordHash,
        environment.DEV_OPERATOR_PASSWORD,
      ),
    ).toBe(true);
    expect(
      await provisionDevelopmentAccounts(db.client, {
        ...environment,
        DEV_ADMIN_EMAIL: 'ADMIN@EXAMPLE.TEST',
      }),
    ).toEqual({ created: 0, existing: 2 });
    expect(
      await db.client.user.findMany({ orderBy: { email: 'asc' } }),
    ).toEqual(before);
  });

  it.each(['password', 'role', 'inactive', 'malformed hash'])(
    'rolls back the entire pair on an existing account conflict: %s',
    async (kind) => {
      const passwordHash =
        kind === 'malformed hash'
          ? '$argon2id$invalid'
          : await new PasswordService().hash(
              kind === 'password'
                ? 'a different test password'
                : environment.DEV_OPERATOR_PASSWORD,
            );
      const before = await db.client.user.create({
        data: {
          email: environment.DEV_OPERATOR_EMAIL,
          passwordHash,
          role: kind === 'role' ? 'ADMIN' : 'OPERATOR',
          active: kind !== 'inactive',
        },
      });
      await expect(
        provisionDevelopmentAccounts(db.client, environment),
      ).rejects.toThrow('conflicts');
      expect(await db.client.user.findMany()).toEqual([before]);
    },
  );

  it('never elevates a matching operator into an administrator', async () => {
    const before = await db.client.user.create({
      data: {
        email: 'admin@example.test',
        passwordHash: await new PasswordService().hash(
          environment.DEV_ADMIN_PASSWORD,
        ),
        role: 'OPERATOR',
      },
    });
    await expect(
      provisionDevelopmentAccounts(db.client, environment),
    ).rejects.toThrow('conflicts');
    expect(await db.client.user.findMany()).toEqual([before]);
  });

  it('serializes concurrent identical attempts without duplicates or password resets', async () => {
    const results = await Promise.all([
      provisionDevelopmentAccounts(db.client, environment),
      provisionDevelopmentAccounts(db.client, environment),
    ]);
    expect(results).toEqual(
      expect.arrayContaining([
        { created: 2, existing: 0 },
        { created: 0, existing: 2 },
      ]),
    );
    expect(await db.client.user.count()).toBe(2);
  });

  it.each([undefined, 'test', 'production', 'Development', ''])(
    'rejects NODE_ENV=%s before any writes',
    async (NODE_ENV) => {
      await expect(
        provisionDevelopmentAccounts(db.client, { ...environment, NODE_ENV }),
      ).rejects.toThrow('NODE_ENV=development');
      expect(await db.client.user.count()).toBe(0);
    },
  );

  it.each([
    { DEV_ADMIN_EMAIL: '' },
    { DEV_OPERATOR_PASSWORD: undefined },
    { DEV_ADMIN_PASSWORD: 'short' },
    { DEV_OPERATOR_EMAIL: 'ADMIN@EXAMPLE.TEST' },
  ])(
    'rejects invalid or incomplete configuration without partial accounts',
    async (overrides) => {
      await expect(
        provisionDevelopmentAccounts(db.client, {
          ...environment,
          ...overrides,
        }),
      ).rejects.toThrow();
      expect(await db.client.user.count()).toBe(0);
    },
  );

  it('executes the CLI explicitly, reports only counts, and fails safely on conflict', async () => {
    function cli(overrides: NodeJS.ProcessEnv = {}) {
      return spawnSync(
        process.execPath,
        ['.test-dist/src/users/provision-main.js'],
        {
          env: {
            ...process.env,
            ...environment,
            DATABASE_URL: db.databaseUrl,
            ...overrides,
          },
          encoding: 'utf8',
          timeout: 20000,
        },
      );
    }
    const created = cli();
    expect(created.status).toBe(0);
    expect(created.stdout.trim()).toBe(
      'Development accounts: 2 created, 0 unchanged.',
    );
    const repeated = cli();
    expect(repeated.status).toBe(0);
    expect(repeated.stdout.trim()).toBe(
      'Development accounts: 0 created, 2 unchanged.',
    );
    const conflict = cli({
      DEV_OPERATOR_PASSWORD: 'a different test passphrase',
    });
    expect(conflict.status).toBe(1);
    const rejected = cli({
      NODE_ENV: 'production',
      DATABASE_URL: 'invalid-private-url',
    });
    expect(rejected.status).toBe(1);
    const output = [created, repeated, conflict, rejected]
      .map(({ stdout, stderr }) => stdout + stderr)
      .join('');
    for (const value of [
      environment.DEV_ADMIN_EMAIL.trim(),
      environment.DEV_ADMIN_PASSWORD,
      environment.DEV_OPERATOR_EMAIL,
      environment.DEV_OPERATOR_PASSWORD,
      'invalid-private-url',
      '$argon2id$',
    ]) {
      expect(output).not.toContain(value);
    }
    expect(await db.client.user.count()).toBe(2);
  });
});
