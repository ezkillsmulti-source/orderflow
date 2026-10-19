import { test, expect, signIn, visual } from './fixture';
import {
  boundaryContrast,
  noPageOverflow,
  textContrast,
} from './design-checks';

test('login, invalid credentials, reload restoration, cookie privacy and logout', async ({
  page,
  database,
}, info) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Sign in to OrderFlow' }),
  ).toBeVisible();
  await noPageOverflow(page);
  await textContrast(
    page.getByRole('heading', { name: 'Sign in to OrderFlow' }),
  );
  const email = page.getByLabel('Email address');
  await email.focus();
  await boundaryContrast(email, 'borderTopColor');
  await boundaryContrast(email, 'outlineColor');
  const submit = page.getByRole('button', { name: 'Sign in', exact: true });
  await textContrast(submit);
  await submit.hover();
  await textContrast(submit);
  await visual(page, 'login', info.project.name);
  await page.getByLabel('Email address').fill(process.env.DEV_ADMIN_EMAIL!);
  await page
    .getByLabel('Password', { exact: true })
    .fill('incorrect synthetic passphrase');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Invalid email or password.',
  );
  await textContrast(page.getByRole('alert'));
  await visual(page, 'login-error', info.project.name);
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: 800 });
  await noPageOverflow(page);
  await visual(page, 'login-320', info.project.name);
  await page.setViewportSize(viewport);
  await signIn(page);
  const navigation = page.getByRole('navigation', {
    name: 'Application',
    exact: true,
  });
  await expect(navigation.getByRole('link')).toHaveCount(1);
  await expect(
    navigation.getByRole('link', { name: 'Products', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: 'Skip to content' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(
    page.getByRole('heading', { name: 'Products', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Sign out', exact: true }),
  ).toBeVisible();
  const cookies = await page.context().cookies();
  expect(
    cookies.filter((cookie) => cookie.name === 'orderflow.sid').length,
  ).toBe(1);
  expect(
    cookies
      .filter((cookie) => cookie.name === 'orderflow.sid')
      .every((cookie) => cookie.httpOnly && cookie.sameSite === 'Lax'),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.cookie.includes('orderflow.sid')),
  ).toBe(false);
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Sign in to OrderFlow' }),
  ).toBeVisible();
  expect(
    (
      await database.query(
        "SELECT count(*)::int AS count FROM http_session WHERE sess::jsonb ? 'userId'",
      )
    ).rows[0].count,
  ).toBe(0);
});

test('does not claim logout success on failure and distinguishes identity outages', async ({
  page,
  database,
}) => {
  void database;
  await signIn(page);
  await page.route('**/api/auth/logout', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'temporarily unavailable',
  );
  await expect(
    page.getByRole('button', { name: 'Sign out', exact: true }),
  ).toBeVisible();
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Service unavailable' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Sign in', exact: true }),
  ).toHaveCount(0);
});
