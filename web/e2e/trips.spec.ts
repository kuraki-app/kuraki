import { test, expect, gotoApp } from './support/fixtures';

// Trips are a detected grouping: the server clusters photos taken away from
// home and the user renames or corrects them. Nothing here can assert a
// POPULATED trip, because the seeded fixture library cannot produce one — its
// PNGs carry no coordinates, and every photo in a day shares one timestamp, so
// each day is its own cluster and the largest holds 6 against MinAssets of 8.
// Extending the fixtures to change that would move EXPECTED_ASSETS/DAYS/
// MONTHS/YEARS, which the timeline and pagination specs assert on.
//
// So these pin what this library can honestly show: that the pages mount
// without throwing (the console guard is most of the value), that the route is
// reachable from both places that advertise it, and that the register seam
// holds.

// Scoped to the header, and that scoping is load-bearing rather than tidiness.
// Playwright matches accessible names by SUBSTRING, and while a rescan is in
// flight both this button and the empty state's action read "Rescanning" — so a
// bare { name: 'Rescan' } resolves to two elements and fails strict mode. It
// passes at rest, when the empty state's action still reads "Look again", which
// is the worst version of the bug: green until the moment it matters.
// `transparency.spec.ts` hit the same trap on /albums and was fixed the same way.
const rescanButton = (page: import('@playwright/test').Page) =>
  page.locator('header').getByRole('button', { name: 'Rescan' });

test('the trips page mounts and offers a rescan', async ({ page }) => {
  await gotoApp(page, '/trips');

  await expect(page.getByRole('heading', { name: 'Trips', level: 1 })).toBeVisible();
  // Detection normally runs after every import, so this is a convenience rather
  // than the usual path — but it is the only control the page has, and a page
  // whose single control is broken is worse than one with none.
  await expect(rescanButton(page)).toBeVisible();
});

test('rescanning leaves the page working', async ({ page }) => {
  await gotoApp(page, '/trips');

  // POST /api/trips/run is synchronous. The button must come back out of its
  // busy state rather than stranding the page on "Rescanning".
  await rescanButton(page).click();
  await expect(rescanButton(page)).toBeEnabled();
  await expect(page.locator('.empty')).toBeVisible();
});

test('trips is reachable from the sidebar and from Collections', async ({ page }) => {
  await gotoApp(page, '/collections');

  // The Collections card. Both surfaces advertise the feature, and a card that
  // links nowhere is how a feature gets shipped that nobody can reach.
  const card = page.locator('nav[aria-label="Collections"]').getByRole('link', { name: 'Trips' });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page).toHaveURL(/\/trips$/);
  await expect(page.getByRole('heading', { name: 'Trips', level: 1 })).toBeVisible();
});

test('trips renders in the Kura register', async ({ page }) => {
  await gotoApp(page, '/trips');

  // The register belongs to the page frame. Trips shows photographs, so it is
  // Kura — the same call /albums and /tags make, and the reason nav.ts carries
  // the register rather than each page deciding for itself.
  await expect(page.locator('main#main')).toHaveAttribute('data-register', 'kura');
});
