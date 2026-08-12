import { test, expect, gotoApp } from './support/fixtures';
import { EXPECTED_ASSETS } from './fixtures.mjs';

// Selection and batch actions mutate the ONE library this suite shares, so each
// test here undoes what it did. Where the UI has no undo — archive and hidden
// are one-way doors on web today, which is a Phase 1 gap — the restore goes
// through the API with the test's own session, which is state cleanup rather
// than a route around a missing feature.

test.describe('selection', () => {
  test('select mode, select all, and clear', async ({ page }) => {
    await gotoApp(page, '/');

    // Before entering select mode a tile click opens the viewer; `selectionMode`
    // is deliberately separate from "the set is non-empty".
    await page.getByRole('button', { name: 'Select', exact: true }).click();

    await page.locator('button.tile').first().click();
    const bar = page.getByRole('toolbar', { name: 'Batch actions' });
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('1 selected');

    await page.getByRole('button', { name: 'Select all' }).click();
    await expect(bar).toContainText(`${EXPECTED_ASSETS} selected`);

    // Select all flips to Clear once everything is chosen.
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(bar).toBeHidden();
  });

  test('batch favorite round-trips through the Favorites view', async ({ page }) => {
    await gotoApp(page, '/favorites');
    await expect(page.getByText('No favorites yet', { exact: false })).toBeVisible();

    await gotoApp(page, '/');
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await page.locator('button.tile').first().click();
    await page.locator('button.tile').nth(1).click();

    await page.getByRole('button', { name: 'Favorite' }).click();

    await gotoApp(page, '/favorites');
    await expect(page.locator('button.tile')).toHaveCount(2);

    // Undo, so the rest of the suite sees the library it expects.
    const ids = await page.locator('button.tile').evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-asset-id'))
    );
    const response = await page.request.post('/api/assets/batch', {
      data: { op: 'unfavorite', ids }
    });
    expect(response.ok()).toBe(true);

    await gotoApp(page, '/favorites');
    await expect(page.locator('button.tile')).toHaveCount(0);
  });

  test('a tile click opens the viewer when not in select mode', async ({ page }) => {
    await gotoApp(page, '/');
    await page.locator('button.tile').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
  });
});
