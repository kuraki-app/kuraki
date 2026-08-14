import { test, expect, gotoApp } from './support/fixtures';
import { OWNER } from './support/owner';

// Sign-in runs in an ANONYMOUS context on purpose. `logout` deletes only the
// current session row (`DELETE FROM sessions WHERE id = ?`), so signing out here
// cannot invalidate the storage state the rest of the suite depends on.
test.describe('authentication', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('rejects a wrong password, then signs in and out', async ({ page, consoleGuard }) => {
    // This test provokes a 401 deliberately, and Chromium logs every failed
    // request as a console error. Declared here rather than globally: a stray
    // 401 on any OTHER page is a real defect and must keep failing the suite.
    consoleGuard.allow(/status of 401/);

    await page.goto('/');

    // Setup is already complete, so this is the sign-in branch of the layout.
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    await page.locator('#auth-username').fill(OWNER.username);
    await page.locator('#auth-password').fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // The server returns the error CODE `invalid_credentials`; the layout maps it
    // to human copy. Asserting the rendered text is what keeps that mapping from
    // silently regressing into a raw code shown to the user.
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText('invalid_credentials');

    await page.locator('#auth-password').fill(OWNER.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('main#main')).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('an expired session drops back to the sign-in form', async ({ page, consoleGuard }) => {
    // This test destroys the session on purpose, so every request still in
    // flight across the reload — thumbnails especially — answers 401. The count
    // varies run to run because it races the reload, which is exactly why it
    // must be declared rather than counted. Scoped to this test: a stray 401
    // anywhere else is still a real defect.
    consoleGuard.allow(/status of 401/);

    await page.goto('/');
    await page.locator('#auth-username').fill(OWNER.username);
    await page.locator('#auth-password').fill(OWNER.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('main#main')).toBeVisible();

    // Drop the cookie and force a request. The 401 handler in api.ts `req()` is
    // the ONLY place the app notices an expired session, so this exercises the
    // single path between "server says no" and "user sees the login form".
    await page.context().clearCookies();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});

test('the skip link is the first stop and reaches main', async ({ page }) => {
  await gotoApp(page, '/');

  await page.keyboard.press('Tab');
  const skip = page.locator('a.skip-link');
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible(); // it is sr-only until focused

  await skip.press('Enter');
  await expect(page).toHaveURL(/#main$/);
});
