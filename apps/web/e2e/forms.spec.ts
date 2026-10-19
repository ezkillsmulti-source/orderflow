import { randomUUID } from 'node:crypto';
import { test, expect, signIn, visual } from './fixture';
import {
  boundaryContrast,
  noPageOverflow,
  textContrast,
} from './design-checks';

test('grouped form announces errors and supports long records at narrow widths', async ({
  page,
  database,
}, info) => {
  const id = randomUUID();
  const name = 'Long product ' + 'W'.repeat(187);
  const sku = 'S'.repeat(64);
  await database.query(
    'INSERT INTO "Product" (id,sku,name,description,"priceMinor","updatedAt") VALUES ($1,$2,$3,$4,$5,now())',
    [id, sku, name, 'D'.repeat(2000), '9007199254740991'],
  );
  await signIn(page);
  await page.getByRole('link', { name: 'Create product', exact: true }).click();
  await expect(
    page.getByRole('group', { name: 'Product identity', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'Pricing', exact: true }),
  ).toBeVisible();
  const input = page.getByRole('textbox', {
    name: 'Product name',
    exact: true,
  });
  await expect(input).toHaveAttribute('required', '');
  await textContrast(page.locator('label[for="name"]'));
  await textContrast(page.locator('#name-help'));
  await boundaryContrast(input, 'borderTopColor');
  await page
    .getByRole('button', { name: 'Create product', exact: true })
    .click();
  await expect(input).toBeFocused();
  await expect(input).toHaveAccessibleDescription(
    /Enter a valid name of 1–200/,
  );
  await expect(page.getByRole('alert')).toContainText(
    'Review the highlighted fields',
  );
  await textContrast(page.getByRole('alert'));
  await textContrast(page.locator('#name-error'));
  await boundaryContrast(input, 'borderTopColor');
  await boundaryContrast(input, 'outlineColor');
  await visual(page, 'create-errors', info.project.name);
  await page.goto(`/#products/${id}`);
  await expect(page.getByRole('heading', { name, exact: true })).toBeFocused();
  await expect(
    page.getByText('ARS 90.071.992.547.409,91', { exact: true }),
  ).toBeVisible();
  await noPageOverflow(page);
  await visual(page, 'detail-long', info.project.name);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 800 });
  await noPageOverflow(page);
  await visual(page, 'detail-320', info.project.name);
  await page.getByRole('link', { name: 'Edit product', exact: true }).click();
  await expect(input).toHaveValue(name);
  await expect(page.getByLabel('SKU', { exact: true })).toHaveValue(sku);
  await expect(page.getByLabel('Price (ARS)', { exact: true })).toHaveValue(
    '90071992547409.91',
  );
  await noPageOverflow(page);
  await visual(page, 'edit-320', info.project.name);
  await page.getByRole('link', { name: 'Cancel', exact: true }).click();
  const archive = page.getByRole('button', {
    name: 'Archive product',
    exact: true,
  });
  await archive.click();
  const dialog = page.getByRole('dialog', {
    name: 'Archive product?',
    exact: true,
  });
  await expect(dialog).toHaveAccessibleDescription(new RegExp(name));
  await expect(
    dialog.getByRole('button', { name: 'Keep product active' }),
  ).toBeFocused();
  await textContrast(dialog.locator('#archive-description'));
  await textContrast(
    dialog.getByRole('button', { name: 'Archive product', exact: true }),
  );
  await noPageOverflow(page);
  await visual(page, 'archive-320', info.project.name);
  await page.keyboard.press('Shift+Tab');
  await expect(
    dialog.getByRole('button', { name: 'Archive product', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    dialog.getByRole('button', { name: 'Keep product active' }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(archive).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('uncertain archival offers an explicit status check without replaying the mutation', async ({
  page,
  database,
}) => {
  const id = randomUUID();
  await database.query(
    'INSERT INTO "Product" (id,sku,name,"priceMinor","updatedAt") VALUES ($1,$2,$3,0,now())',
    [id, 'UNCERTAIN-ARCHIVE', 'Reference coffee'],
  );
  await signIn(page);
  await page.goto(`/#products/${id}`);
  let writes = 0;
  await page.route('**/api/products/*/archive', async (route) => {
    writes++;
    await route.fetch();
    await route.abort('failed');
  });
  await page
    .getByRole('button', { name: 'Archive product', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('button', { name: 'Archive product', exact: true })
    .click();
  await expect(dialog.getByRole('alert')).toContainText(
    'may have reached the server',
  );
  expect(writes).toBe(1);
  await expect(
    dialog.getByRole('button', { name: 'Keep product active' }),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Check product status' }).click();
  await expect(
    page.getByRole('heading', { name: 'Reference coffee', exact: true }),
  ).toBeFocused();
  await expect(page.getByText('Archived', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Edit product', exact: true }),
  ).toHaveCount(0);
  expect(writes).toBe(1);
  expect(
    (await database.query('SELECT active FROM "Product" WHERE id=$1', [id]))
      .rows[0].active,
  ).toBe(false);
});
