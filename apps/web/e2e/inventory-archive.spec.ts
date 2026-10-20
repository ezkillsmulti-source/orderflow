import { randomUUID } from 'node:crypto';
import { test, expect, signIn } from './fixture';

test('preserves an active product when stock blocks archival and allows archival after compensation', async ({
  page,
  database,
}) => {
  const id = randomUUID();
  await database.query(
    'INSERT INTO "Product" (id,sku,name,"priceMinor","updatedAt") VALUES ($1,$2,$3,0,now())',
    [id, `STOCK-${id}`, 'Stock archive sample'],
  );
  await signIn(page);
  const csrf = await (await page.request.get('/api/auth/csrf')).json();
  const adjust = async (delta: string) => {
    const response = await page.request.post(
      `/api/products/${id}/inventory/adjustments`,
      {
        headers: {
          Origin: new URL(page.url()).origin,
          'x-csrf-token': csrf.csrfToken,
          'Idempotency-Key': randomUUID(),
        },
        data: { delta, reason: 'Synthetic browser stock adjustment' },
      },
    );
    expect(response.status()).toBe(201);
  };
  await adjust('1');
  await page
    .getByRole('link', { name: 'Stock archive sample', exact: true })
    .click();
  const opener = page.getByRole('button', {
    name: 'Archive product',
    exact: true,
  });
  await opener.click();
  const modal = page.getByRole('dialog', { name: 'Archive product?' });
  const denied = page.waitForResponse(
    (r) => r.url().endsWith(`/products/${id}/archive`) && r.status() === 409,
  );
  await modal
    .getByRole('button', { name: 'Archive product', exact: true })
    .click();
  await denied;
  await expect(modal.getByRole('alert')).toBeVisible();
  const row = await database.query(
    'SELECT active,"onHand" FROM "Product" WHERE id=$1',
    [id],
  );
  expect(row.rows[0]).toEqual({ active: true, onHand: '1' });
  await modal.getByRole('button', { name: 'Keep product active' }).click();
  await expect(opener).toBeFocused();
  await adjust('-1');
  await opener.click();
  await modal
    .getByRole('button', { name: 'Archive product', exact: true })
    .click();
  await expect(
    page.getByText('Archived · Available to read.', { exact: false }),
  ).toBeVisible();
  const history = await database.query(
    'SELECT count(*)::int AS count FROM "InventoryAdjustment" WHERE "productId"=$1',
    [id],
  );
  expect(history.rows[0].count).toBe(2);
});
