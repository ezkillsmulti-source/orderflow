import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect, signIn, visual } from './fixture';
import {
  noPageOverflow,
  textContrast,
  boundaryContrast,
} from './design-checks';
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
  await detail(page);
  await loaded(page);
  await page.getByRole('button', { name: 'Remove image', exact: true }).click();
  await database.query('UPDATE "Product" SET active=false WHERE id=$1', [id]);
  const modal = page.getByRole('dialog', { name: 'Remove product image?' });
  await modal
    .getByRole('button', { name: 'Remove image', exact: true })
    .click();
  await expect(modal.getByRole('alert')).toContainText(
    'may have been archived',
  );
  await expect(
    modal.getByRole('button', { name: 'Remove image', exact: true }),
  ).toBeDisabled();
  await expect(
    modal.getByRole('button', { name: 'Check image status' }),
  ).toBeFocused();
  await modal.getByRole('button', { name: 'Check image status' }).click();
  await expect(page.getByLabel('Choose product image')).toHaveCount(0);
  await loaded(page);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Email address')).toBeVisible();
  await signIn(page, 'OPERATOR');
  await page.getByRole('radio', { name: 'Archived', exact: true }).check();
  await loaded(page, 'thumbnail');
  await page.getByRole('link', { name: 'Sample coffee', exact: true }).click();
  await loaded(page);
  await expect(page.getByLabel('Choose product image')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Remove image', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText('Archived · Available to read.', { exact: false }),
  ).toBeVisible();
});

async function choose(page: Page, name = 'synthetic.png') {
  await page.getByLabel('Choose product image', { exact: true }).setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: await readFile(process.env.E2E_IMAGE_FIXTURE!),
  });
  const preview = page.getByRole('img', {
    name: 'Selected product image preview',
  });
  await expect
    .poll(() =>
      preview.evaluate(
        (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
      ),
    )
    .toBe(true);
}
async function tracePreviews(page: Page) {
  await page.addInitScript(() => {
    const state = { created: [] as string[], revoked: [] as string[] };
    Object.assign(window, { imageURLTrace: state });
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (value) => {
      const url = create(value);
      state.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (value) => {
      state.revoked.push(value);
      revoke(value);
    };
  });
}
async function allPreviewsReleased(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = (
          window as unknown as {
            imageURLTrace: { created: string[]; revoked: string[] };
          }
        ).imageURLTrace;
        return (
          state.created.length > 0 &&
          state.created.every((url) => state.revoked.includes(url))
        );
      }),
    )
    .toBe(true);
}
async function detail(page: Page) {
  await page.getByRole('link', { name: 'Sample coffee', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Product image', exact: true }),
  ).toBeVisible();
}

test('administrators explicitly add, replace and remove images with keyboard confirmation', async ({
  page,
  database,
}, info) => {
  await tracePreviews(page);
  const id = await seed(database);
  await signIn(page);
  await detail(page);
  await expect(
    page.getByText('JPEG, PNG or WebP', { exact: false }),
  ).toBeVisible();
  await choose(page);
  expect(
    (await database.query('SELECT "imageId" FROM "Product" WHERE id=$1', [id]))
      .rows[0].imageId,
  ).toBeNull();
  await noPageOverflow(page);
  if (info.project.name === 'mobile') {
    await page.setViewportSize({ width: 320, height: 844 });
    await noPageOverflow(page);
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await visual(page, 'image-selection', info.project.name);
  const upload = page.getByRole('button', { name: 'Upload selected image' });
  await page.getByLabel('Choose product image', { exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(upload).toBeFocused();
  await textContrast(page.locator('#image-file-help'));
  await textContrast(upload);
  await boundaryContrast(upload, 'outlineColor');
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('Product image updated.', { exact: true }),
  ).toBeVisible();
  const first = await (await loaded(page)).getAttribute('src');
  await allPreviewsReleased(page);
  await choose(page, 'replacement.png');
  await upload.click();
  await expect(
    page.getByText('Product image updated.', { exact: true }),
  ).toBeVisible();
  await expect(await loaded(page)).not.toHaveAttribute('src', first!);
  await allPreviewsReleased(page);
  const remove = page.getByRole('button', {
    name: 'Remove image',
    exact: true,
  });
  await remove.focus();
  await page.keyboard.press('Enter');
  let modal = page.getByRole('dialog', { name: 'Remove product image?' });
  await expect(modal.getByRole('button', { name: 'Keep image' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    modal.getByRole('button', { name: 'Remove image', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(modal.getByRole('button', { name: 'Keep image' })).toBeFocused();
  await visual(page, 'image-remove-dialog', info.project.name);
  await page.keyboard.press('Escape');
  await expect(modal).not.toBeVisible();
  await expect(remove).toBeFocused();
  await remove.click();
  modal = page.getByRole('dialog', { name: 'Remove product image?' });
  await modal
    .getByRole('button', { name: 'Remove image', exact: true })
    .click();
  await expect(
    page.getByText('Product image removed.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'No image for Sample coffee' }),
  ).toBeVisible();
  expect(
    (await database.query('SELECT "imageId" FROM "Product" WHERE id=$1', [id]))
      .rows[0].imageId,
  ).toBeNull();
});

test('rejects invalid files without losing selection and handles an archived product during upload', async ({
  page,
  database,
}, info) => {
  const id = await seed(database);
  await signIn(page);
  await detail(page);
  const input = page.getByLabel('Choose product image', { exact: true });
  await input.setInputFiles({
    name: 'too-large.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(page.getByRole('alert')).toContainText('5 MiB');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(
    page.getByRole('button', { name: 'Upload selected image' }),
  ).toBeDisabled();
  await input.setInputFiles({
    name: 'invalid.png',
    mimeType: 'image/png',
    buffer: Buffer.from('Not an image'),
  });
  await page.getByRole('button', { name: 'Upload selected image' }).click();
  await expect(page.getByRole('alert')).toContainText('Choose a JPEG');
  await expect(input).toBeFocused();
  await textContrast(page.getByRole('alert'));
  expect(
    await input.evaluate((node: HTMLInputElement) => node.files?.length),
  ).toBe(1);
  await expect(input).toHaveAttribute('aria-describedby', /image-file-error/);
  await noPageOverflow(page);
  await visual(page, 'image-validation', info.project.name);
  await choose(page);
  await database.query('UPDATE "Product" SET active=false WHERE id=$1', [id]);
  await page.getByRole('button', { name: 'Upload selected image' }).click();
  await expect(page.getByRole('alert')).toContainText('may have been archived');
  await page.getByRole('button', { name: 'Refresh product status' }).click();
  await expect(
    page.getByText('Archived image · Available for reference.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(input).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Remove image', exact: true }),
  ).toHaveCount(0);
  expect(
    (await database.query('SELECT "imageId" FROM "Product" WHERE id=$1', [id]))
      .rows[0].imageId,
  ).toBeNull();
});

for (const boundary of [
  'navigation',
  'logout',
  'role change',
  'session expiration',
] as const) {
  test(`releases selected previews on ${boundary} without unauthorized image changes`, async ({
    page,
    database,
  }) => {
    await tracePreviews(page);
    const id = await seed(database);
    await signIn(page);
    await detail(page);
    await choose(page, 'first.png');
    await choose(page, 'second.png');
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { imageURLTrace: { revoked: string[] } })
            .imageURLTrace.revoked.length,
      ),
    ).toBe(1);
    if (boundary === 'navigation') {
      await page.getByRole('link', { name: 'Back to products' }).click();
      await expect(
        page.getByRole('heading', { name: 'Products', exact: true }),
      ).toBeVisible();
    }
    if (boundary === 'logout') {
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect(page.getByLabel('Email address')).toBeVisible();
    }
    if (boundary === 'role change' || boundary === 'session expiration') {
      await database.query(
        boundary === 'role change'
          ? 'UPDATE "User" SET role=\'OPERATOR\' WHERE email=$1'
          : 'UPDATE "User" SET active=false WHERE email=$1',
        [process.env.DEV_ADMIN_EMAIL],
      );
      await page.getByRole('button', { name: 'Upload selected image' }).click();
      if (boundary === 'role change') {
        await expect(
          page.getByText('Read-only image access.', { exact: false }),
        ).toBeVisible();
        await expect(page.getByLabel('Choose product image')).toHaveCount(0);
      } else await expect(page.getByLabel('Email address')).toBeVisible();
    }
    await allPreviewsReleased(page);
    expect(
      (
        await database.query('SELECT "imageId" FROM "Product" WHERE id=$1', [
          id,
        ])
      ).rows[0].imageId,
    ).toBeNull();
  });
}

test('checks uncertain upload/removal outcomes deliberately without replaying either mutation', async ({
  page,
  database,
}) => {
  await tracePreviews(page);
  const id = await seed(database);
  await signIn(page);
  await detail(page);
  await choose(page);
  let writes = 0;
  await page.route(`**/api/products/${id}/image`, async (route) => {
    if (!['PUT', 'DELETE'].includes(route.request().method())) {
      await route.continue();
      return;
    }
    writes++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Upload selected image' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'may have reached the server',
  );
  await expect(
    page.getByRole('button', { name: 'Upload selected image' }),
  ).toBeDisabled();
  await expect(page.getByLabel('Choose product image')).toBeDisabled();
  expect(writes).toBe(1);
  await page.getByRole('button', { name: 'Check image status' }).click();
  await loaded(page);
  await allPreviewsReleased(page);
  expect(writes).toBe(1);
  await page.getByRole('button', { name: 'Remove image', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove product image?' });
  await dialog
    .getByRole('button', { name: 'Remove image', exact: true })
    .click();
  await expect(dialog.getByRole('alert')).toContainText(
    'may have reached the server',
  );
  await expect(
    dialog.getByRole('button', { name: 'Remove image', exact: true }),
  ).toBeDisabled();
  expect(writes).toBe(2);
  await dialog.getByRole('button', { name: 'Check image status' }).click();
  await expect(
    page.getByRole('img', { name: 'No image for Sample coffee' }),
  ).toBeVisible();
  expect(writes).toBe(2);
});

test('preserves CSRF and origin protection for multipart requests without replay', async ({
  page,
  database,
}) => {
  const id = await seed(database);
  await signIn(page);
  await detail(page);
  await choose(page);
  let writes = 0;
  for (const protection of ['csrf', 'origin']) {
    await page.route(`**/api/products/${id}/image`, async (route) => {
      writes++;
      const headers = route.request().headers();
      if (protection === 'csrf') delete headers['x-csrf-token'];
      else headers.origin = 'https://untrusted.example';
      const response = await route.fetch({ headers });
      expect(response.status()).toBe(403);
      await route.fulfill({ response });
    });
    const denied = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/products/${id}/image`) &&
        response.request().method() === 'PUT' &&
        response.status() === 403,
    );
    await page.getByRole('button', { name: 'Upload selected image' }).click();
    await denied;
    await expect(page.getByRole('alert')).toContainText('forbidden');
    await expect(
      page.getByRole('button', { name: 'Upload selected image' }),
    ).toBeEnabled();
    expect(writes).toBe(protection === 'csrf' ? 1 : 2);
    expect(
      (
        await database.query('SELECT "imageId" FROM "Product" WHERE id=$1', [
          id,
        ])
      ).rows[0].imageId,
    ).toBeNull();
    await expect(
      page.getByRole('img', { name: 'Selected product image preview' }),
    ).toBeVisible();
    await page.unroute(`**/api/products/${id}/image`);
  }
  await page.getByRole('button', { name: 'Upload selected image' }).click();
  await expect(
    page.getByText('Product image updated.', { exact: true }),
  ).toBeVisible();
  await loaded(page);
});
