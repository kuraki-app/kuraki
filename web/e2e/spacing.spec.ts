import { test, expect, gotoApp } from './support/fixtures';

// The design spec states the rhythm as 8/16/24/32/48 in Kura and 4/8/12/16/24
// in the Vault, and `--space-step` exists so one expression yields both. What
// broke it was fractional multipliers: `calc(var(--space-step) * 1.5)` renders
// 12px on a page whose scale has no 12, and 6px on a page whose scale has no 6.
//
// PageHeader and EmptyState appear on nearly every route, so those two values
// were the most-repeated off-scale numbers in the app.

const SHARED_CHROME = [
  { path: '/', register: 'kura', step: 8 },
  { path: '/albums', register: 'kura', step: 8 },
  { path: '/trash', register: 'vault', step: 4 },
  { path: '/settings', register: 'vault', step: 4 }
];

for (const { path, register, step } of SHARED_CHROME) {
  test(`${path} spaces its shared chrome on the ${step}px rhythm`, async ({ page }) => {
    await gotoApp(page, path);
    await expect(page.locator('main#main')).toHaveAttribute('data-register', register);

    const gaps = await page.evaluate(() => {
      const read = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const s = getComputedStyle(el);
        return { gap: parseFloat(s.gap), marginBottom: parseFloat(s.marginBottom) };
      };
      return { header: read('.page-header'), empty: read('.empty-inner') };
    });

    for (const [name, box] of Object.entries(gaps)) {
      if (!box) continue;
      for (const [prop, value] of Object.entries(box)) {
        if (!Number.isFinite(value) || value === 0) continue;
        expect(
          value % step,
          `${name} ${prop} is ${value}px, off the ${step}px rhythm on a ${register} page`
        ).toBe(0);
      }
    }
  });
}

test('settings are held to a reading measure, and photos are not', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });

  // Settings are read rather than browsed. Unbounded, a row's label sat a long
  // way from its control on a wide screen and the page read as a sparse field.
  await gotoApp(page, '/settings/library');
  const panel = await page.locator('.panel').boundingBox();
  expect(panel?.width ?? 0).toBeLessThan(900);

  // The timeline is the opposite case and must use every pixel it is given.
  await gotoApp(page, '/');
  const grid = await page.locator('.day-inner .grid').first().boundingBox();
  expect(grid?.width ?? 0).toBeGreaterThan(1000);
});
