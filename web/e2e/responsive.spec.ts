import { test, expect, gotoApp } from './support/fixtures';

// Breakpoints are hand-written media queries scattered across component <style>
// blocks and they cluster at three different widths: 820px (sidebar → MobileNav,
// PageHeader, LibraryView, BatchBar, ScrollScrubber), 780px (AssetGrid tile
// min-width, Viewer panel, settings rail) and 640px (SettingRow, users table).
//
// 800px is therefore a band where the layout is half-mobile, and it is included
// here deliberately. `body { min-width: 320px }` sets the floor.
const WIDTHS = [320, 390, 640, 780, 800, 820, 1024, 1440];

const PATHS = ['/', '/albums', '/tags', '/duplicates', '/trash', '/settings', '/settings/users'];

test.describe('responsive', () => {
  for (const width of WIDTHS) {
    test(`no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });

      for (const path of PATHS) {
        await gotoApp(page, path);
        const overflow = await page.evaluate(() => ({
          doc: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          view: window.innerWidth
        }));
        // A page wider than its viewport is the defect that the 390×844 pass on
        // 2026-07-27 was checking for on two routes; this checks every route at
        // every seam, every run.
        expect(overflow.doc, `${path} document overflows at ${width}px`).toBeLessThanOrEqual(overflow.view);
        expect(overflow.body, `${path} body overflows at ${width}px`).toBeLessThanOrEqual(overflow.view);
      }
    });
  }

  test('the mobile tab bar and the sidebar swap at 820px', async ({ page }) => {
    const sidebar = page.locator('aside.side');
    const tabBar = page.getByRole('navigation', { name: /sections|primary/i }).last();

    await page.setViewportSize({ width: 1024, height: 900 });
    await gotoApp(page, '/');
    await expect(sidebar).toBeVisible();

    // MobileNav hides itself with `min-width: 821px`, so 820 is the last mobile
    // width and 821 the first desktop one. Asserting both sides of the seam is
    // what stops the two rules drifting apart.
    await page.setViewportSize({ width: 820, height: 900 });
    await expect(sidebar).toBeHidden();
    await expect(tabBar).toBeVisible();
  });
});
