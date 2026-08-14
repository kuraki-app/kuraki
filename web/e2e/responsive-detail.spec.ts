import { test, expect, gotoApp } from './support/fixtures';

const ROUTES = [
  '/',
  '/albums',
  '/tags',
  '/places',
  '/duplicates',
  '/trash',
  '/settings',
  '/settings/library',
  '/settings/devices',
  '/settings/activity',
  '/settings/server',
  '/settings/users'
];

// 320 is the floor (`body { min-width: 320px }`) and the width where every
// too-wide row shows up first. "Run integrity check" and "Scan for duplicates"
// side by side need ~330px, so at 320 the document could be dragged sideways.
test('nothing overflows at the narrowest supported width', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });

  for (const path of ROUTES) {
    await gotoApp(page, path);
    const o = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      view: window.innerWidth
    }));
    expect(o.doc, `${path} overflows at 320px`).toBeLessThanOrEqual(o.view);
  }
});

test('pairing steps show their numbers', async ({ page }) => {
  await gotoApp(page, '/settings/devices');

  // Tailwind's preflight sets `list-style: none` on every list, which is right
  // for the navigation and card grids that make up most lists here and wrong
  // for this one: pairing a phone is an ORDERED process and the numbers are
  // information, not decoration. They were rendering indented and invisible.
  const style = await page
    .locator('ol')
    .first()
    .evaluate((el) => getComputedStyle(el).listStyleType);
  expect(style).toBe('decimal');
});

test('the settings rail shows that it scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, '/settings');

  const rail = page.getByRole('navigation', { name: 'Settings sections' });
  const state = await rail.evaluate((el) => ({
    scrollable: el.scrollWidth > el.clientWidth,
    mask: getComputedStyle(el).maskImage
  }));

  // Below the seam the rail is a horizontal scroller and the last item is cut
  // mid-word. Without a cue, Server and Users look like they do not exist.
  expect(state.scrollable).toBe(true);
  expect(state.mask, 'the trailing edge has no fade to signal more').not.toBe('none');
});

test('the integrity readout keeps its separators', async ({ page }) => {
  await gotoApp(page, '/settings');

  const text = await page.locator('.int-text span').first().textContent();
  // Svelte collapses whitespace around an {#if} boundary, which produced
  // "36 checked· 24s ago". Asserting the space is either side of the separator.
  expect(text ?? '').not.toMatch(/\S·/);
  expect(text ?? '').not.toMatch(/·\S/);
});
