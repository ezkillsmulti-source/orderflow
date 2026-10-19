import { randomUUID } from 'node:crypto';
import { test, expect, signIn, visual } from './fixture';

test('administrator creates, edits changed fields and archives with keyboard confirmation', async ({
  page,
  database,
}, info) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Create product', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Create product', exact: true }),
  ).toBeFocused();
  await page
    .getByRole('button', { name: 'Create product', exact: true })
    .click();
  await expect(
    page.getByLabel('Product name', { exact: true }),
  ).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Product name', { exact: true }).fill('Blue coffee');
  await page.getByLabel('SKU', { exact: true }).fill(' BLUE-COFFEE ');
  await page
    .getByLabel('Price (ARS)', { exact: true })
    .fill('90071992547409.91');
  await page
    .getByLabel('Description (optional)', { exact: true })
    .fill('Small batch coffee.');
  await visual(page, 'create', info.project.name);
  await page
    .getByRole('button', { name: 'Create product', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Blue coffee', exact: true }),
  ).toBeFocused();
  await expect(
    page.getByText('ARS 90.071.992.547.409,91', { exact: true }),
  ).toBeVisible();
  const saved = (
    await database.query('SELECT id,"priceMinor" FROM "Product" WHERE sku=$1', [
      'BLUE-COFFEE',
    ])
  ).rows[0];
  expect(saved.priceMinor).toBe('9007199254740991');
  await page.getByRole('link', { name: 'Edit product', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Save changes' }),
  ).toBeDisabled();
  await page.getByLabel('Price (ARS)', { exact: true }).fill('0');
  const sent = page.waitForRequest((request) => request.method() === 'PATCH');
  await page.getByRole('button', { name: 'Save changes' }).click();
  expect((await sent).postDataJSON()).toEqual({ priceMinor: '0' });
  await expect(page.getByText('ARS 0,00', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Archive product', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('button', { name: 'Keep product active' }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Archive product', exact: true }),
  ).toBeFocused();
  await page
    .getByRole('button', { name: 'Archive product', exact: true })
    .click();
  await visual(page, 'archive', info.project.name);
  await dialog
    .getByRole('button', { name: 'Archive product', exact: true })
    .click();
  await expect(
    page.getByText('Product archived.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Edit product', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Archive product', exact: true }),
  ).toHaveCount(0);
  await page.goto(`/#products/${saved.id}/edit`);
  await expect(
    page.getByRole('heading', { name: 'Product archived', exact: true }),
  ).toBeVisible();
});

test('keeps input on SKU conflicts and rejected origin/CSRF without automatically replaying writes', async ({
  page,
  database,
}) => {
  await database.query(
    'INSERT INTO "Product" (id,sku,name,"priceMinor","updatedAt") VALUES ($1,$2,$3,0,now())',
    [randomUUID(), 'TAKEN', 'Existing'],
  );
  await signIn(page);
  await page.getByRole('link', { name: 'Create product', exact: true }).click();
  await page.getByLabel('Product name', { exact: true }).fill('Keep my draft');
  await page.getByLabel('SKU', { exact: true }).fill('TAKEN');
  await page.getByLabel('Price (ARS)', { exact: true }).fill('1.25');
  await page
    .getByRole('button', { name: 'Create product', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('SKU may be in use');
  await expect(page.getByLabel('Product name', { exact: true })).toHaveValue(
    'Keep my draft',
  );
  await page.getByLabel('SKU', { exact: true }).fill('FRESH');
  let writes = 0;
  await page.route('**/api/products', async (route) => {
    writes++;
    const headers = { ...route.request().headers() };
    if (writes === 1) headers.origin = 'https://untrusted.example.test';
    else delete headers['x-csrf-token'];
    await route.fulfill({ response: await route.fetch({ headers }) });
  });
  await page
    .getByRole('button', { name: 'Create product', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('forbidden');
  expect(writes).toBe(1);
  expect(
    (await database.query('SELECT count(*)::int AS count FROM "Product"'))
      .rows[0].count,
  ).toBe(1);
  await expect(page.getByLabel('SKU', { exact: true })).toHaveValue('FRESH');
  await page
    .getByRole('button', { name: 'Create product', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('forbidden');
  await expect(
    page.getByRole('button', { name: 'Create product', exact: true }),
  ).toBeEnabled();
  expect(writes).toBe(2);
  expect(
    (await database.query('SELECT count(*)::int AS count FROM "Product"'))
      .rows[0].count,
  ).toBe(1);
  await page.unroute('**/api/products');
  await page
    .getByRole('button', { name: 'Create product', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Keep my draft', exact: true }),
  ).toBeVisible();
});

test('reports uncertain creation after response loss without replay or input loss', async ({
  page,
  database,
}) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Create product', exact: true }).click();
  await page
    .getByLabel('Product name', { exact: true })
    .fill('Uncertain coffee');
  await page.getByLabel('SKU', { exact: true }).fill('UNCERTAIN');
  await page.getByLabel('Price (ARS)', { exact: true }).fill('0');
  let writes = 0;
  await page.route('**/api/products', async (route) => {
    writes++;
    await route.fetch();
    await route.abort('failed');
  });
  await page
    .getByRole('button', { name: 'Create product', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'may have reached the server',
  );
  expect(writes).toBe(1);
  await expect(page.getByLabel('Product name', { exact: true })).toHaveValue(
    'Uncertain coffee',
  );
  expect(
    (
      await database.query(
        'SELECT count(*)::int AS count FROM "Product" WHERE sku=$1',
        ['UNCERTAIN'],
      )
    ).rows[0].count,
  ).toBe(1);
});

test('handles role changes and expiry during editing while backend still denies direct operator writes', async ({
  page,
  database,
}) => {
  const id = randomUUID();
  await database.query(
    'INSERT INTO "Product" (id,sku,name,"priceMinor","updatedAt") VALUES ($1,$2,$3,0,now())',
    [id, 'ROLE', 'Original'],
  );
  await signIn(page);
  await page.goto(`/#products/${id}/edit`);
  await page.getByLabel('Product name', { exact: true }).fill('Denied edit');
  await database.query('UPDATE "User" SET role=\'OPERATOR\' WHERE email=$1', [
    process.env.DEV_ADMIN_EMAIL,
  ]);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Operator', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(
    0,
  );
  const status = await page.evaluate(async () => {
    const { csrfToken } = (await (await fetch('/api/auth/csrf')).json()) as {
      csrfToken: string;
    };
    return (
      await fetch('/api/products', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          sku: 'DENIED',
          name: 'Denied',
          priceMinor: '0',
        }),
      })
    ).status;
  });
  expect(status).toBe(403);
  expect(
    (await database.query('SELECT name FROM "Product" WHERE id=$1', [id]))
      .rows[0].name,
  ).toBe('Original');
  await page.goto('/#products');
  await expect(
    page.getByRole('link', { name: 'Create product', exact: true }),
  ).toHaveCount(0);
  await database.query('UPDATE "User" SET role=\'ADMIN\' WHERE email=$1', [
    process.env.DEV_ADMIN_EMAIL,
  ]);
  await page.reload();
  await page.goto(`/#products/${id}/edit`);
  await page.getByLabel('Product name', { exact: true }).fill('Expired edit');
  await database.query(
    "UPDATE http_session SET expire=now()-interval '1 second'",
  );
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sign in to OrderFlow' }),
  ).toBeVisible();
  expect(
    (await database.query('SELECT name FROM "Product" WHERE id=$1', [id]))
      .rows[0].name,
  ).toBe('Original');
});

test('preserves draft when another administrator archives during editing', async ({
  page,
  database,
}) => {
  const id = randomUUID();
  await database.query(
    'INSERT INTO "Product" (id,sku,name,"priceMinor","updatedAt") VALUES ($1,$2,$3,0,now())',
    [id, 'RACE', 'Original'],
  );
  await signIn(page);
  await page.goto(`/#products/${id}/edit`);
  await page
    .getByLabel('Product name', { exact: true })
    .fill('Keep this draft');
  await database.query(
    'UPDATE "Product" SET active=false,"updatedAt"=now() WHERE id=$1',
    [id],
  );
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('alert')).toContainText('may have been archived');
  await expect(page.getByLabel('Product name', { exact: true })).toHaveValue(
    'Keep this draft',
  );
  expect(
    (await database.query('SELECT name FROM "Product" WHERE id=$1', [id]))
      .rows[0].name,
  ).toBe('Original');
  await page.getByRole('link', { name: 'Check the current catalog' }).click();
  await expect(
    page.getByRole('heading', { name: 'Original', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Edit product', exact: true }),
  ).toHaveCount(0);
});
