import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { normalizeEmail } from '../src/users/email.js';
import { createTestDatabase } from './support/test-database.js';

let db: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  db = await createTestDatabase();
  db.migrate();
  db.migrate();
});
afterAll(async () => {
  await db?.close();
});

describe('user persistence', () => {
  it('enforces normalized uniqueness, role values, and defaults in PostgreSQL', async () => {
    const user = await db.client.user.create({
      data: {
        email: normalizeEmail(' Alice+tag@Example.com '),
        passwordHash: 'test-only-hash',
        role: 'ADMIN',
      },
    });
    expect(user).toMatchObject({
      email: 'alice+tag@example.com',
      role: 'ADMIN',
      active: true,
    });
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);
    await expect(
      db.client.user.create({
        data: {
          email: normalizeEmail('ALICE+TAG@EXAMPLE.COM'),
          passwordHash: 'test-only-hash',
          role: 'OPERATOR',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    for (const email of [
      'Alice@example.com',
      ' alice@example.com',
      'alice@example.com ',
      'álîce@example.com',
      'a\tb@example.com',
      '',
    ]) {
      await expect(
        db.client.user.create({
          data: { email, passwordHash: 'test-only-hash', role: 'OPERATOR' },
        }),
      ).rejects.toThrow();
    }
    await expect(
      db.client
        .$executeRaw`INSERT INTO "User" ("id", "email", "passwordHash", "role", "updatedAt") VALUES (gen_random_uuid(), 'invalid-role@example.com', 'test-only-hash', 'OWNER', now())`,
    ).rejects.toThrow();
    const updated = await db.client.user.update({
      where: { id: user.id },
      data: { active: false },
    });
    expect(updated.active).toBe(false);
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
      user.updatedAt.getTime(),
    );
  });

  it('upgrades the original schema without changing Product data or its constraints', async () => {
    const upgrade = await createTestDatabase();
    try {
      upgrade.migrate(true);
      const product = await upgrade.client.product.create({
        data: {
          sku: 'UPGRADE',
          name: 'Preserved',
          priceMinor: 9007199254740991n,
        },
      });
      upgrade.migrate();
      upgrade.migrate();
      expect(
        await upgrade.client.product.findUnique({ where: { id: product.id } }),
      ).toEqual(product);
      await expect(
        upgrade.client.product.create({
          data: { sku: 'BAD', name: 'Invalid', priceMinor: -1n },
        }),
      ).rejects.toThrow();
      expect(await upgrade.client.user.count()).toBe(0);
      expect(
        await upgrade.client
          .$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name`,
      ).toEqual([
        { migration_name: '20261019000000_initial_product' },
        { migration_name: '20261019010000_user_accounts' },
      ]);
    } finally {
      await upgrade.close();
    }
  });
});
