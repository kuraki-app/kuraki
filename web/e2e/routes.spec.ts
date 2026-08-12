import { test, expect, gotoApp } from './support/fixtures';

// The broadest net in the suite: visit every route and assert it renders its own
// heading without throwing. The console guard (support/fixtures.ts) is doing
// half the work here — until this suite existed there was no mechanism at all
// that could observe a component throwing on mount.

/** href → the heading that route is expected to render, and the register its
 *  page frame should be in (nav.ts is the source of truth for the register). */
const ROUTES = [
  { path: '/', heading: 'Timeline', register: 'kura' },
  { path: '/favorites', heading: 'Favorites', register: 'kura' },
  { path: '/albums', heading: 'Albums', register: 'kura' },
  { path: '/memories', heading: 'On this day', register: 'kura' },
  { path: '/places', heading: 'Places', register: 'kura' },
  { path: '/tags', heading: 'Tags', register: 'kura' },
  { path: '/archive', heading: 'Archive', register: 'kura' },
  { path: '/hidden', heading: 'Hidden', register: 'kura' },
  { path: '/duplicates', heading: 'Duplicates', register: 'vault' },
  { path: '/trash', heading: 'Trash', register: 'vault' },
  // Titled "Overview", matching its label in the settings rail — /settings is
  // the section's index, not a page called Settings.
  { path: '/settings', heading: 'Overview', register: 'vault' },
  { path: '/settings/account', heading: 'Account', register: 'vault' },
  { path: '/settings/appearance', heading: 'Appearance', register: 'vault' },
  { path: '/settings/library', heading: 'Library', register: 'vault' },
  { path: '/settings/devices', heading: 'Devices', register: 'vault' },
  { path: '/settings/activity', heading: 'Activity', register: 'vault' },
  { path: '/settings/server', heading: 'Server', register: 'vault' },
  { path: '/settings/users', heading: 'Users', register: 'vault' }
];

for (const route of ROUTES) {
  test(`${route.path} renders`, async ({ page }) => {
    await gotoApp(page, route.path);
    await expect(page.getByRole('heading', { name: route.heading, exact: false }).first()).toBeVisible();
    await expect(page.locator('main#main')).toHaveAttribute('data-register', route.register);
  });
}

test('legacy routes redirect into settings', async ({ page }) => {
  for (const [from, to] of [
    ['/stats', '/settings'],
    ['/activity', '/settings/activity'],
    ['/devices', '/settings/devices']
  ]) {
    await gotoApp(page, from);
    await expect(page).toHaveURL(new RegExp(`${to}$`));
  }
});

test('the sidebar marks the current route', async ({ page }) => {
  await gotoApp(page, '/favorites');
  const nav = page.getByRole('navigation', { name: 'Library sections' });
  await expect(nav.getByRole('link', { name: 'Favorites' })).toHaveAttribute('aria-current', 'page');
  // Timeline is `/`, which every path starts with — isActive() special-cases it,
  // and this is the assertion that keeps that special case honest.
  await expect(nav.getByRole('link', { name: 'Timeline' })).not.toHaveAttribute('aria-current', 'page');
});
