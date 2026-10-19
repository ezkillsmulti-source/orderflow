import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect, signIn, visual } from './fixture';
import { noPageOverflow } from './design-checks';
import type { Page } from '@playwright/test';

async function seed(database: import('pg').Client) {
  const id = randomUUID();
  await database.query(
    'INSERT INTO "Product" (id,sku,name,"priceMinor","updatedAt") VALUES ($1,$2,$3,0,now())',
    [id, `IMAGE-${id}`, 'Sample coffee'],
  );
  return id;
}
async function attach(page: Page, id: string) {
  const csrf = await (await page.request.get('/api/auth/csrf')).json();
  const response = await page.request.put(`/api/products/${id}/image`, {
    headers: {
      Origin: new URL(page.url()).origin,
      'x-csrf-token': csrf.csrfToken,
    },
    multipart: {
      image: {
        name: 'synthetic.png',
        mimeType: 'image/png',
        buffer: await readFile(process.env.E2E_IMAGE_FIXTURE!),
      },
    },
  });
  expect(response.status()).toBe(200);
  return response.json();
}
async function loaded(page: Page, variant: 'detail' | 'thumbnail' = 'detail') {
  const image = page.getByRole('img', {
    name: 'Product image: Sample coffee',
    exact: true,
  });
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', new RegExp(`/${variant}$`));
  await expect
    .poll(() =>
      image.evaluate(
        (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
      ),
    )
    .toBe(true);
  return image;
}

test('loads authenticated thumbnails/details and distinguishes absent and failed images', async ({
  page,
  database,
}, info) => {
  const id = await seed(database);
  await signIn(page);
  await attach(page, id);
  await page.getByRole('button', { name: 'Refresh products' }).click();
  const thumbnail = await loaded(page, 'thumbnail');
  await expect(thumbnail).toHaveAttribute(
    'src',
    /\/api\/products\/.*\/thumbnail$/,
  );
  await visual(page, 'image-catalog', info.project.name);
  await page.getByRole('link', { name: 'Sample coffee', exact: true }).click();
  await loaded(page);
  await noPageOverflow(page);
  await visual(page, 'image-details', info.project.name);
  await page.route('**/api/products/*/image/*/detail', (route) =>
    route.fulfill({ status: 503, body: '' }),
  );
  await page.reload();
  await expect(
    page.getByRole('img', { name: 'Image unavailable for Sample coffee' }),
  ).toBeVisible();
  await visual(page, 'image-failure', info.project.name);
  await page.unroute('**/api/products/*/image/*/detail');
  await database.query('UPDATE "Product" SET "imageId"=NULL WHERE id=$1', [id]);
  await page.reload();
  await expect(
    page.getByRole('img', { name: 'No image for Sample coffee' }),
  ).toBeVisible();
});

test('operators can read archived images', async ({ page, database }) => {
  const id = await seed(database);
  await signIn(page);
  await attach(page, id);
  await database.query('UPDATE "Product" SET active=false WHERE id=$1', [id]);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Email address')).toBeVisible();
  await signIn(page, 'OPERATOR');
  await page.getByRole('radio', { name: 'Archived', exact: true }).check();
  await loaded(page, 'thumbnail');
  await page.getByRole('link', { name: 'Sample coffee', exact: true }).click();
  await loaded(page);
  await expect(
    page.getByText('Archived · Available to read.', { exact: false }),
  ).toBeVisible();
});
