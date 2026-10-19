import { randomUUID } from 'node:crypto';
import { test, expect, signIn, visual } from './fixture';
import {
  boundaryContrast,
  noPageOverflow,
  textContrast,
} from './design-checks';

test('empty workspace offers real next steps for each role', async ({
  page,
  database,
}, info) => {
  void database;
  await signIn(page);
  await expect(
    page.getByRole('heading', { name: 'No products to show' }),
  ).toBeVisible();
  await visual(page, 'empty-admin', info.project.name);
  await page
    .getByRole('link', { name: 'Create a product', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Create product', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sign in to OrderFlow' }),
  ).toBeVisible();
  await signIn(page, 'OPERATOR');
  await expect(
    page.getByText('Read-only access', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /create a? ?product/i }),
  ).toHaveCount(0);
  await page
    .getByRole('link', { name: 'View all products', exact: true })
    .click();
  await expect(
    page.getByRole('radio', { name: 'All products', exact: true }),
  ).toBeChecked();
  await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible();
  await noPageOverflow(page);
});

test('keyboard status filters retain focus and expose archived read-only actions', async ({
  page,
  database,
}) => {
  for (const active of [true, false])
    await database.query(
      'INSERT INTO "Product" (id,sku,name,"priceMinor",active,"updatedAt") VALUES ($1,$2,$3,0,$4,now())',
      [
        randomUUID(),
        active ? 'ACTIVE' : 'ARCHIVE',
        active ? 'Active coffee' : 'Archived coffee',
        active,
      ],
    );
  await signIn(page, 'OPERATOR');
  const active = page.getByRole('radio', { name: 'Active', exact: true });
  await active.focus();
  await page.keyboard.press('ArrowRight');
  const archived = page.getByRole('radio', { name: 'Archived', exact: true });
  await expect(archived).toBeChecked();
  await expect(archived).toBeFocused();
  await expect(
    page.getByRole('link', { name: 'View Archived coffee', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /^Edit / })).toHaveCount(0);
  await boundaryContrast(archived.locator('+ span'), 'outlineColor');
  await textContrast(archived.locator('+ span'));
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('radio', { name: 'All products', exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole('link', { name: 'View Active coffee', exact: true }),
  ).toBeVisible();
});

test('long catalog content and maximum money reflow inside a named keyboard scroll region', async ({
  page,
  database,
}, info) => {
  const name = 'Long product ' + 'W'.repeat(187);
  await database.query(
    'INSERT INTO "Product" (id,sku,name,description,"priceMinor","updatedAt") VALUES ($1,$2,$3,$4,$5,now())',
    [randomUUID(), 'S'.repeat(64), name, 'D'.repeat(2000), '9007199254740991'],
  );
  await signIn(page, 'OPERATOR');
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  const money = page.getByRole('cell', {
    name: 'ARS 90.071.992.547.409,91',
    exact: true,
  });
  await expect(money).toBeVisible();
  await noPageOverflow(page);
  await textContrast(money);
  await textContrast(page.getByRole('link', { name, exact: true }));
  await textContrast(
    page
      .getByRole('cell', { name: 'S'.repeat(64), exact: true })
      .locator('code'),
  );
  await textContrast(page.getByText('Read-only access', { exact: true }));
  await visual(page, 'catalog-long', info.project.name);
  await page.setViewportSize({ width: 320, height: 800 });
  const region = page.getByRole('region', {
    name: 'Product catalog',
    exact: true,
  });
  await region.focus();
  await expect(region).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => region.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  await boundaryContrast(region, 'outlineColor');
  await noPageOverflow(page);
  await visual(page, 'catalog-320', info.project.name);
});

test('loading is announced while an explicit refresh is pending', async ({
  page,
  database,
}) => {
  void database;
  await signIn(page);
  await expect(
    page.getByRole('heading', { name: 'No products to show' }),
  ).toBeVisible();
  let release!: () => void;
  let arrived!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  await page.route('**/api/products?*', async (route) => {
    arrived();
    await gate;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Refresh products' }).click();
  await started;
  try {
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading products' }),
    ).toBeVisible();
  } finally {
    release();
  }
  await expect(
    page.getByRole('heading', { name: 'No products to show' }),
  ).toBeVisible();
});

test('keyboard pagination retains focus through loading, boundaries and read failures', async ({
  page,
  database,
}) => {
  for (let index = 0; index < 21; index++)
    await database.query(
      'INSERT INTO "Product" (id,sku,name,"priceMinor","createdAt","updatedAt") VALUES ($1,$2,$3,0,$4,$4)',
      [
        randomUUID(),
        `PAGE-${index}`,
        `Page coffee ${index}`,
        new Date(1700000000000 + index),
      ],
    );
  await signIn(page, 'OPERATOR');
  await page.getByLabel('Products per page').selectOption('10');
  await expect(page.getByText('Showing 1–10', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'View Page coffee 0', exact: true }),
  ).toBeVisible();
  let release!: () => void;
  let arrived!: () => void;
  let reads = 0;
  let fail = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  await page.route('**/api/products?*', async (route) => {
    reads++;
    if (reads === 1) {
      arrived();
      await gate;
    }
    if (fail)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{}',
      });
    else await route.continue();
  });
  const next = page.getByRole('button', { name: 'Next', exact: true });
  const previous = page.getByRole('button', { name: 'Previous', exact: true });
  await next.focus();
  await page.keyboard.press('Enter');
  await started;
  try {
    await expect(next).toBeFocused();
    await expect(next).toBeDisabled();
    await textContrast(next);
    await boundaryContrast(next, 'outlineColor');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(
      (url) =>
        new URLSearchParams(url.hash.split('?')[1]).get('offset') === '10',
    );
    expect(reads).toBe(1);
  } finally {
    release();
  }
  await expect(page.getByText('Showing 11–20', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'View Page coffee 10', exact: true }),
  ).toBeVisible();
  await expect(next).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Showing 21–21', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'View Page coffee 20', exact: true }),
  ).toBeVisible();
  await expect(next).toBeFocused();
  await expect(next).toBeDisabled();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(
    (url) => new URLSearchParams(url.hash.split('?')[1]).get('offset') === '20',
  );
  expect(reads).toBe(2);
  await previous.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Showing 11–20', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'View Page coffee 10', exact: true }),
  ).toBeVisible();
  await expect(previous).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Showing 1–10', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'View Page coffee 0', exact: true }),
  ).toBeVisible();
  await expect(previous).toBeFocused();
  await expect(previous).toBeDisabled();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(
    (url) => new URLSearchParams(url.hash.split('?')[1]).get('offset') === '0',
  );
  expect(reads).toBe(4);
  await expect(next).toBeEnabled();
  fail = true;
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText(
    'temporarily unavailable',
  );
  await expect(next).toBeFocused();
  await expect(next).toBeDisabled();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(
    (url) => new URLSearchParams(url.hash.split('?')[1]).get('offset') === '10',
  );
  expect(reads).toBe(5);
});
