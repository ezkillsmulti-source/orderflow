import { randomUUID } from 'node:crypto';
import { test, expect, signIn, visual } from './fixture';

test('operators browse active and archived products with exact prices and bounded pagination', async ({
  page,
  database,
}, info) => {
  const archivedId = randomUUID();
  for (let index = 0; index < 12; index++)
    await database.query(
      'INSERT INTO "Product" (id,sku,name,"priceMinor",active,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$6)',
      [
        index === 11 ? archivedId : randomUUID(),
        `ITEM-${index}`,
        index === 11
          ? 'Archived tea'
          : `Coffee ${String(index).padStart(2, '0')}`,
        index === 0 ? '9007199254740991' : '0',
        index !== 11,
        new Date(1700000000000 + index),
      ],
    );
  await signIn(page, 'OPERATOR');
  await expect(
    page.getByRole('heading', { name: 'Products', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('ARS 90.071.992.547.409,91', { exact: true }),
  ).toBeVisible();
  await visual(page, 'catalog', info.project.name);
  await page.getByLabel('Products per page').selectOption('10');
  await expect(page.getByText('Showing 1–10', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Showing 11–11', { exact: true })).toBeVisible();
  await page.getByLabel('Product status').selectOption('archived');
  await page.getByRole('link', { name: 'Archived tea' }).click();
  await expect(
    page.getByRole('heading', { name: 'Archived tea', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('ARS 0,00', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to products' }).click();
  await expect(page.getByLabel('Product status')).toHaveValue('archived');
  await page.goto('/#products/00000000-0000-0000-0000-000000000000');
  await expect(page.getByRole('alert')).toContainText('could not be found');
});

test('distinguishes empty, unavailable and forbidden reads and handles session invalidation', async ({
  page,
  database,
}) => {
  await signIn(page);
  await expect(
    page.getByRole('heading', { name: 'No products to show' }),
  ).toBeVisible();
  await page.route('**/api/products?*', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
  await page.getByRole('button', { name: 'Refresh products' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'temporarily unavailable',
  );
  await page.unroute('**/api/products?*');
  await page.route('**/api/products?*', (route) =>
    route.fulfill({ status: 403, contentType: 'application/json', body: '{}' }),
  );
  await page.getByRole('button', { name: 'Refresh products' }).click();
  await expect(page.getByRole('alert')).toContainText('forbidden');
  await page.unroute('**/api/products?*');
  await database.query('UPDATE "User" SET active=false WHERE email=$1', [
    process.env.DEV_ADMIN_EMAIL,
  ]);
  await page.getByRole('button', { name: 'Refresh products' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sign in to OrderFlow' }),
  ).toBeVisible();
});
