import { test as base, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export const test = base.extend<{ database: Client }>({
  database: async ({ browserName }, use) => {
    if (browserName !== 'chromium')
      throw new Error('Only the configured Chromium project is supported.');
    if (!process.env.E2E_DATABASE_URL)
      throw new Error('Use the root test:browser runner.');
    const database = new Client({
      connectionString: process.env.E2E_DATABASE_URL,
    });
    await database.connect();
    try {
      await database.query(
        'TRUNCATE "Product", "ProductImage", http_session, login_limit',
      );
      await database.query(
        'UPDATE "User" SET active=true, role=CASE WHEN email=$1 THEN \'ADMIN\'::"Role" ELSE \'OPERATOR\'::"Role" END',
        [process.env.DEV_ADMIN_EMAIL],
      );
      await use(database);
    } finally {
      await database.end();
    }
  },
});
export { expect };
export async function signIn(page: Page, role: 'ADMIN' | 'OPERATOR' = 'ADMIN') {
  await page.goto('/');
  await page
    .getByLabel('Email address')
    .fill(
      process.env[role === 'ADMIN' ? 'DEV_ADMIN_EMAIL' : 'DEV_OPERATOR_EMAIL']!,
    );
  await page
    .getByLabel('Password', { exact: true })
    .fill(process.env.DEV_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Sign out', exact: true }),
  ).toBeVisible();
}
export async function visual(page: Page, name: string, project: string) {
  const directory = process.env.E2E_VISUAL_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await page.screenshot({
    path: join(directory, `${name}-${project}.png`),
    fullPage: true,
  });
}
