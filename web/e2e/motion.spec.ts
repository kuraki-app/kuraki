import { test, expect, gotoApp } from './support/fixtures';

// Reduced motion is TWO mechanisms in this codebase and only one of them is CSS.
//
// The CSS belt in app.css handles transitions and `::view-transition-*` (which a
// bare `*` selector cannot reach). But Svelte's `fly`/`fade` are WAAPI/JS-driven
// and never see that rule, so `prefersReducedMotion()` in motion.ts gates them in
// JavaScript — BatchBar, Viewer and LibraryView each call it.
//
// That JS path had never been executed by a browser. These tests do not measure
// durations (timing assertions are how flaky suites are born); they prove the
// reduced-motion code path runs and the app remains fully functional on it.
test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the media viewer still opens, navigates and closes', async ({ page }) => {
    await gotoApp(page, '/');

    await page.locator('button.tile').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    // `view-transition-name` must be held by exactly one element or the next
    // transition aborts (AGENTS.md §11). The name is legitimately held while the
    // viewer is open — that IS the morph target — and released after close, so
    // this polls for it to settle rather than reading it the instant the dialog
    // hides. A name still set after the release window is the stranded-tag bug.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            [...document.querySelectorAll<HTMLElement>('*')].filter(
              (el) => el.style.viewTransitionName
            ).length
        )
      )
      .toBe(0);
  });

  test('re-opening claims the name exactly once', async ({ page }) => {
    await gotoApp(page, '/');

    const named = () =>
      page.evaluate(
        () =>
          [...document.querySelectorAll<HTMLElement>('*')].filter((el) => el.style.viewTransitionName)
            .length
      );

    for (const index of [0, 1, 2]) {
      await page.locator('button.tile').nth(index).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await named(), 'exactly one element may claim the morph name').toBe(1);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect.poll(named).toBe(0);
    }
  });

  test('the batch bar still appears and clears', async ({ page }) => {
    await gotoApp(page, '/');

    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await page.locator('button.tile').first().click();

    const bar = page.getByRole('toolbar', { name: 'Batch actions' });
    await expect(bar).toBeVisible();

    await page.getByRole('button', { name: 'Clear selection' }).click();
    await expect(bar).toBeHidden();
  });

  test('the honest check: the app is usable end to end', async ({ page }) => {
    for (const path of ['/', '/albums', '/settings', '/settings/appearance']) {
      await gotoApp(page, path);
      await expect(page.locator('main#main')).toBeVisible();
    }
  });
});
