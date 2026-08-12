import { test as setup, expect } from '@playwright/test';
import { OWNER } from './support/owner';

// First-run setup can only happen once per library, so it is a dependency
// project rather than an ordinary spec. That still makes it a real test of the
// setup form — it just also leaves behind the signed-in state every other
// project starts from.
const STORAGE = 'e2e/.tmp/owner.json';

setup('first run creates the owner account', async ({ page }) => {
  await page.goto('/');

  // The auth screen is a branch of the root layout, not a route, so there is no
  // /login URL to assert. The heading is what distinguishes setup from sign-in.
  await expect(page.getByRole('heading', { name: 'Welcome to Kuraki' })).toBeVisible();

  await page.locator('#auth-username').fill(OWNER.username);
  await page.locator('#auth-password').fill(OWNER.password);
  await page.locator('#auth-confirm').fill(OWNER.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  // Signed in: the shell replaces the auth form entirely.
  await expect(page.locator('main#main')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Library sections' })).toBeVisible();

  // The library was seeded BEFORE setup claimed the placeholder owner, so the
  // assets must belong to this account. An empty grid here means the seed and
  // the session disagree about who owns the library.
  await expect(page.locator('main#main img').first()).toBeVisible();

  await page.context().storageState({ path: STORAGE });
});
