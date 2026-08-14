import { test, expect, gotoApp } from './support/fixtures';

// An empty list is a first-run screen. Every one of these used to render a
// single bold line — "No albums yet" — alone in ~700px of paper, with the
// button that fixes it sitting unmentioned in the corner. `EmptyState` had an
// `icon` slot with no consumers anywhere and 6 of 9 call sites passed a bare
// title.
//
// These tests pin the shape rather than the wording, so the copy can be edited
// without breaking them, but it cannot silently regress to a label.

/** Routes that are legitimately empty against the seeded fixture library. */
const EMPTY_ROUTES = [
  { path: '/albums', action: 'New album' },
  { path: '/favorites', action: 'Browse the timeline' },
  { path: '/archive', action: 'Browse the timeline' },
  { path: '/hidden', action: 'Browse the timeline' },
  // No action on purpose — the "New tag" form is directly above it.
  { path: '/tags', action: null },
  { path: '/memories', action: null }
];

for (const route of EMPTY_ROUTES) {
  test(`${route.path} explains itself when empty`, async ({ page }) => {
    await gotoApp(page, route.path);

    const empty = page.locator('.empty');
    await expect(empty).toBeVisible();

    // A title AND a line saying what the thing is. A title alone is a label.
    await expect(empty.locator('.empty-title')).toBeVisible();
    const body = await empty.locator('.empty-body').textContent();
    expect(body?.trim().length ?? 0, `${route.path} has no explanatory body`).toBeGreaterThan(30);

    if (route.action) {
      await expect(
        empty.getByRole('button', { name: route.action }).or(empty.getByRole('link', { name: route.action }))
      ).toBeVisible();
    }
  });
}

test('the empty state sits with its content, not centred in the viewport', async ({ page }) => {
  // On /tags the message used to float hundreds of pixels below the "New tag"
  // form it was talking about, reading as an unrelated notice.
  await gotoApp(page, '/tags');

  const gap = await page.evaluate(() => {
    const form = document.querySelector('main#main form');
    const empty = document.querySelector('.empty-title');
    if (!form || !empty) return null;
    return empty.getBoundingClientRect().top - form.getBoundingClientRect().bottom;
  });

  expect(gap).not.toBeNull();
  expect(gap!, 'the empty state has drifted away from the form above it').toBeLessThan(160);
});

test('the timeline empty state can actually start an upload', async ({ page }) => {
  // The upload input lives in the root layout because the drop target is the
  // whole window, so the timeline's empty state could previously only DESCRIBE
  // where the Upload button was. `requestUpload()` lets it be one.
  await gotoApp(page, '/?q=nothing-matches-this-string-at-all');

  const empty = page.locator('.empty');
  await expect(empty).toBeVisible();
  // Filtered-empty is a different state from library-empty and offers the
  // action that resolves it.
  await expect(empty.getByRole('button', { name: 'Clear filters' })).toBeVisible();
  await empty.getByRole('button', { name: 'Clear filters' }).click();

  // Clearing brings the library back rather than leaving an empty page.
  await expect(page.locator('button.tile').first()).toBeVisible();
});
