import { test, expect, gotoApp } from './support/fixtures';
import { EXPECTED_ASSETS, EXPECTED_DAYS, EXPECTED_MONTHS, EXPECTED_YEARS } from './fixtures.mjs';

test.describe('timeline', () => {
  test('renders the seeded library', async ({ page }) => {
    await gotoApp(page, '/');

    // AssetGrid windows by day-group section, so the DOM deliberately holds
    // fewer tiles than the library has assets. What must be true is that the
    // grid rendered something and the page is not an empty state.
    const tiles = page.locator('button.tile');
    await expect(tiles.first()).toBeVisible();
    expect(await tiles.count()).toBeGreaterThan(0);
    expect(await tiles.count()).toBeLessThanOrEqual(EXPECTED_ASSETS);
  });

  test('every section stays in the DOM so scroll height is preserved', async ({ page }) => {
    await gotoApp(page, '/');

    // The windowing contract: a section is ALWAYS present (so the observer can
    // watch it and its spacer holds the scroll height), and only its contents
    // materialize when live. If sections were removed instead, the scrollbar
    // would jump as the user scrolled.
    await expect(page.locator('section.day')).toHaveCount(EXPECTED_DAYS);
  });

  for (const [grouping, expected] of [
    ['day', EXPECTED_DAYS],
    ['month', EXPECTED_MONTHS],
    ['year', EXPECTED_YEARS]
  ] as const) {
    test(`groups by ${grouping}`, async ({ page }) => {
      // The preference is localStorage-backed (`kuraki:grouping`), read once at
      // module load, so it must be set before the app boots.
      await page.goto('/');
      await page.evaluate((value) => localStorage.setItem('kuraki:grouping', value), grouping);
      await gotoApp(page, '/');

      await expect(page.locator('section.day')).toHaveCount(expected);
      await expect(page.locator('section.day h2').first()).toBeVisible();
    });
  }

  test('grouping off keeps one unheaded block and still virtualizes', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('kuraki:grouping', 'off'));
    await gotoApp(page, '/');

    // 36 assets < UNGROUPED_BLOCK (120), so exactly one block, with no heading.
    await expect(page.locator('section.day')).toHaveCount(1);
    await expect(page.locator('section.day h2')).toHaveCount(0);

    await page.evaluate(() => localStorage.setItem('kuraki:grouping', 'day'));
  });

  test('changing density re-tiles the grid without blanking it', async ({ page }) => {
    await gotoApp(page, '/');

    // Scoped to `.day-inner` on purpose: `.grid` on its own also matches
    // Tailwind's grid utility, which LibraryView uses on its error and skeleton
    // wrappers, so a bare `.grid` can silently assert against the wrong element.
    const grid = page.locator('.day-inner .grid').first();
    const tiles = page.locator('button.tile');

    await expect(grid).toHaveClass(/comfortable/);

    // REGRESSION GUARD. Changing density used to clear the virtualizer's
    // `visible` set, and because the section keys and DOM nodes are unchanged,
    // IntersectionObserver — which only reports CHANGES in intersection — never
    // re-reported them. Every section unmaterialized and the timeline stayed
    // blank until a full page reload. The tile count assertion is the one that
    // catches it; the class assertion alone passed throughout.
    for (const [button, expected] of [
      ['Compact grid', /compact/],
      ['Large grid', /large/],
      ['Comfortable grid', /comfortable/]
    ] as const) {
      await page.getByRole('button', { name: button }).click();
      await expect(grid).toHaveClass(expected);
      expect(await tiles.count(), `no tiles rendered after choosing ${button}`).toBeGreaterThan(0);
    }
  });

  test('the scroll scrubber appears only when there is enough to scroll', async ({ page }) => {
    // It hides itself below 2000px of scrollable content (MIN_SCROLLABLE_PX): a
    // scrubber for a page that barely scrolls is furniture, not a control.
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoApp(page, '/');
    await expect(page.getByRole('slider')).toHaveCount(0);

    // A narrow, short viewport puts the seeded library well past the threshold.
    await page.setViewportSize({ width: 500, height: 500 });
    await gotoApp(page, '/');

    // "a drag handle that only answers to a pointer is not a control at all" —
    // ScrollScrubber.svelte. This asserts the slider semantics it claims.
    const scrubber = page.getByRole('slider');
    await expect(scrubber).toHaveAttribute('aria-valuenow', /\d+/);
    await expect(scrubber).toHaveAttribute('aria-orientation', 'vertical');
    await expect(scrubber).toHaveAttribute('aria-valuetext', /.+/);

    await scrubber.focus();
    await expect(scrubber).toBeFocused();
    await page.keyboard.press('End');
    await expect(scrubber).toBeFocused();
    // End scrolls to the bottom of the timeline, so the reported value must move.
    await expect(scrubber).toHaveAttribute('aria-valuenow', /(9[0-9]|100)/);
  });
});
