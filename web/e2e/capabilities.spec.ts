import { test, expect, gotoApp } from './support/fixtures';

// Each of these covers a server capability the web UI could not reach. They
// mutate the shared library, so every one puts it back.

async function enterSelect(page: import('@playwright/test').Page, howMany = 1) {
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  for (let i = 0; i < howMany; i++) await page.locator('button.tile').nth(i).click();
  await expect(page.getByRole('toolbar', { name: 'Batch actions' })).toBeVisible();
}

test.describe('archive and hidden are no longer one-way doors', () => {
  for (const [label, action, undo, route] of [
    ['archive', 'Archive', 'Unarchive', '/archive'],
    ['hidden', 'Hide', 'Unhide', '/hidden']
  ] as const) {
    test(`${label} round-trips back to the timeline`, async ({ page }) => {
      await gotoApp(page, route);
      await expect(page.locator('button.tile')).toHaveCount(0);

      await gotoApp(page, '/');
      await enterSelect(page, 2);
      await page.getByRole('button', { name: action }).click();

      await gotoApp(page, route);
      await expect(page.locator('button.tile')).toHaveCount(2);

      // The way back. `unarchive`/`unhide` existed on the server since batch ops
      // were added and had no caller on web, so this was where photos went to
      // stay: the view offered Archive again, never Unarchive.
      await enterSelect(page, 2);
      await page.getByRole('button', { name: undo }).click();

      await expect(page.locator('button.tile')).toHaveCount(0);
      await gotoApp(page, '/');
      await expect(page.locator('button.tile').first()).toBeVisible();
    });
  }
});

test('the trash can be emptied, and says how long it keeps things', async ({ page }) => {
  await gotoApp(page, '/');
  await enterSelect(page, 2);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();

  await gotoApp(page, '/trash');
  await expect(page.locator('button.tile')).toHaveCount(2);

  // The retention window is a live setting; the subtitle used to hardcode 30.
  await expect(page.getByText(/permanently removed after \d+ days?/)).toBeVisible();

  // Restore one, so both paths out of the trash are covered.
  await enterSelect(page, 1);
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('button.tile')).toHaveCount(1);

  // Then permanently delete the rest. `DELETE /api/trash/{id}` had always
  // existed and only the phone app called it: a web user could never reclaim
  // the disk space before the retention window elapsed.
  await page.getByRole('button', { name: 'Empty trash' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('cannot be undone');
  await dialog.getByRole('button', { name: 'Empty trash' }).click();

  await expect(page.locator('button.tile')).toHaveCount(0);
});

test('a rating can be set, cleared, and filtered on', async ({ page }) => {
  await gotoApp(page, '/');
  await page.locator('button.tile').first().click();

  const viewer = page.getByRole('dialog');
  const stars = viewer.getByRole('group', { name: 'Rating' });
  await expect(stars).toBeVisible();

  // Rating was filterable and shown on every asset long before anything could
  // set it — only the importer and the Immich migration ever wrote the column.
  await stars.getByRole('button', { name: '4 stars' }).click();
  await expect(stars.getByRole('button', { name: '4 stars' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');

  await gotoApp(page, '/?rating=4');
  await expect(page.locator('button.tile')).toHaveCount(1);

  // Clicking the current rating clears it, otherwise 1 star would be a one-way
  // door of its own.
  await page.locator('button.tile').first().click();
  await viewer.getByRole('group', { name: 'Rating' }).getByRole('button', { name: '4 stars' }).click();
  await page.keyboard.press('Escape');

  await gotoApp(page, '/?rating=4');
  await expect(page.locator('button.tile')).toHaveCount(0);
});

test('the filter panel reaches the whole filter language', async ({ page }) => {
  await gotoApp(page, '/');
  await page.getByRole('button', { name: 'Filters' }).click();

  // These five were accepted by parseAssetFilters from the beginning and had no
  // control anywhere in the UI.
  for (const label of ['Rating', 'Camera', 'City', 'Country']) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }

  await page.getByLabel('City', { exact: true }).fill('Nowhere-at-all');
  await page.getByLabel('City', { exact: true }).blur();
  await expect(page.getByText('No matches found')).toBeVisible();
  // The summary must name the filter, or a filtered empty page is indis-
  // tinguishable from an empty library.
  await expect(page.getByText(/Filtered by .*Nowhere-at-all/)).toBeVisible();
});

test('a place links through to its own photos', async ({ page }) => {
  // The seeded PNGs carry no GPS, so Places is empty here and the link cannot be
  // clicked. What is asserted is that the timeline ACCEPTS the filter a place
  // tile links to — the half that was missing (`focusPlace` only panned the map).
  await gotoApp(page, '/?place_city=Kyoto&place_country=Japan');
  await expect(page.getByText(/Filtered by .*Kyoto, Japan/)).toBeVisible();
});

test('batch time shift is wired to something', async ({ page }) => {
  await gotoApp(page, '/');
  await enterSelect(page, 1);

  // `api.shiftTime` sat in the API module with zero callers while AGENTS.md
  // listed batch timezone shift as implemented and verified.
  await page.getByRole('button', { name: 'Shift time' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Hours').fill('24');
  await dialog.getByRole('button', { name: 'Shift' }).click();
  await expect(dialog).toBeHidden();

  // Shift it back so the fixture dates stay as fixtures.mjs describes them.
  await enterSelect(page, 1);
  await page.getByRole('button', { name: 'Shift time' }).click();
  await page.getByRole('dialog').getByLabel('Hours').fill('-24');
  await page.getByRole('dialog').getByRole('button', { name: 'Shift' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
});
