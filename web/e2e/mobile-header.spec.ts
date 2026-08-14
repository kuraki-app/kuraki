import { test, expect, gotoApp } from './support/fixtures';

// The timeline header used to stack FOUR control rows on a phone — title,
// search, filters, density — and eat roughly a quarter of a 390x844 screen
// before a single photograph. The timeline is the product; the controls were
// outranking it.

test.describe('phone header', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('photos start within the first third of the screen', async ({ page }) => {
    await gotoApp(page, '/');

    const firstTile = page.locator('button.tile').first();
    await expect(firstTile).toBeVisible();

    // Measured once the layout has SETTLED. LibraryView crossfades the skeleton
    // out over 240ms, so for that window both grids are in the DOM and the real
    // one sits below the placeholder — measuring then reports the first tile
    // ~1780px down a page whose header is actually ~170px tall. The skeleton
    // detaching is the honest signal that the grid is where it will stay.
    await expect(page.locator('.animate-pulse')).toHaveCount(0);

    const top = await firstTile.evaluate((el) => el.getBoundingClientRect().top);
    // Not a pixel-perfect lock: the assertion is that the chrome above the
    // photographs stays a header rather than becoming a control panel.
    expect(top, `photos start ${Math.round(top)}px down a 844px screen`).toBeLessThan(260);
  });

  test('grid density is not on the phone header', async ({ page }) => {
    await gotoApp(page, '/');
    // It is a set-once preference and it lives in Settings → Appearance, where
    // this asserts it still is.
    await expect(page.getByRole('group', { name: 'Grid density' })).toHaveCount(0);

    await gotoApp(page, '/settings/appearance');
    await expect(page.getByRole('group', { name: 'Grid density' })).toBeVisible();
  });

  test('every control a thumb can reach is big enough for one', async ({ page }) => {
    for (const path of ['/', '/settings/appearance', '/albums']) {
      await gotoApp(page, path);

      const small = await page.evaluate(() =>
        [...document.querySelectorAll('button, a[href], select')]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return false;
            // Links inside a sentence are prose, not controls, and padding them
            // into buttons would be worse than leaving them.
            if (el.tagName === 'A' && el.closest('p, li')) return false;
            return r.height < 40;
          })
          .map((el) => {
            const r = el.getBoundingClientRect();
            const name =
              el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 20) || el.tagName;
            return `${name} ${Math.round(r.width)}x${Math.round(r.height)}`;
          })
      );
      expect(small, `${path} has controls under 40px tall`).toEqual([]);
    }
  });
});

test('the desktop header keeps the density control', async ({ page }) => {
  // Removing it from the phone must not remove it from the surface where it is
  // genuinely useful and costs nothing.
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, '/');
  await expect(page.getByRole('group', { name: 'Grid density' })).toBeVisible();
});
