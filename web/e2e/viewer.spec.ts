import { test, expect, gotoApp } from './support/fixtures';

// The viewer is the single largest component (741 LOC) and the one with the most
// unverified behaviour: the View-Transitions morph, keyboard navigation, and
// focus management were all written without a browser to check them in.

test.describe('viewer', () => {
  test('opens a photo, navigates with the keyboard, and closes on Escape', async ({ page }) => {
    await gotoApp(page, '/');

    const tiles = page.locator('button.tile');
    await expect(tiles.first()).toBeVisible();
    const firstName = await tiles.first().getAttribute('aria-label');

    await tiles.first().click();

    const viewer = page.getByRole('dialog');
    await expect(viewer).toBeVisible();

    // ArrowRight advances to the next asset. The filename is the cheapest
    // observable that proves the index actually moved.
    await page.keyboard.press('ArrowRight');
    await expect(viewer).not.toContainText(String(firstName));

    await page.keyboard.press('ArrowLeft');
    await expect(viewer).toContainText(String(firstName));

    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
  });

  // KNOWN DEFECT — the viewer does no focus management whatsoever.
  //
  // Measured, not inferred: with the dialog open and 7 tabbable controls inside
  // it, document.activeElement is still the grid tile BEHIND the overlay
  // (`{tag: BUTTON, class: "tile", insideDialog: false}`). Three consequences:
  //
  //   1. Opening the viewer does not move focus into it, so a keyboard user has
  //      to Tab forward through the rest of the page to reach Close/Next/Edit.
  //   2. Focus is not trapped, so Tab walks out of the dialog into the grid
  //      underneath — reachable by keyboard, hidden from the eye.
  //   3. "Restore focus on close" therefore passes VACUOUSLY: focus returns to
  //      the tile only because it never left it. Asserting restore alone would
  //      have reported this component as correct.
  //
  // `AlbumPicker` gets all three free from bits-ui `ui/dialog`, and MobileNav
  // implements them by hand correctly. Fixed in the Phase 2 dialog unification;
  // un-fixme these then.
  test.fixme('moves focus into the dialog, traps it, and restores it on close', async ({ page }) => {
    await gotoApp(page, '/');

    const tile = page.locator('button.tile').first();
    await expect(tile).toBeVisible();
    const assetId = await tile.getAttribute('data-asset-id');

    await tile.focus();
    await tile.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const inside = () =>
      page.evaluate(() => {
        const d = document.querySelector('[role="dialog"]');
        return !!d && !!document.activeElement && d.contains(document.activeElement);
      });

    // 1. focus enters the dialog
    expect(await inside()).toBe(true);

    // 2. and stays there, however far you tab
    for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
    expect(await inside()).toBe(true);

    // 3. and comes back to the tile that opened it
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(
      await page.evaluate(() => document.activeElement?.getAttribute('data-asset-id'))
    ).toBe(assetId);
  });
});
