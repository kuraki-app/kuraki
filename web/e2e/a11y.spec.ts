import { test, expect, gotoApp } from './support/fixtures';

// Structural accessibility checks that hold for every page. These are the kind
// of defect that svelte-check cannot see and a human eye slides straight past:
// the page LOOKS right, and only a screen reader or a click on the label reveals
// that the association was never made.

const ROUTES = [
  '/',
  '/albums',
  '/tags',
  '/places',
  '/duplicates',
  '/trash',
  '/settings',
  '/settings/account',
  '/settings/appearance',
  '/settings/library',
  '/settings/devices',
  '/settings/activity',
  '/settings/server',
  '/settings/users'
];

test('every label[for] points at a control that exists', async ({ page }) => {
  const dangling: string[] = [];

  for (const path of ROUTES) {
    await gotoApp(page, path);
    const broken = await page.evaluate(() =>
      [...document.querySelectorAll('label[for]')]
        .map((label) => label.getAttribute('for') ?? '')
        .filter((id) => id && !document.getElementById(id))
    );
    for (const id of broken) dangling.push(`${path}: <label for="${id}"> matches no element`);
  }

  expect(dangling, dangling.join('\n')).toEqual([]);
});

test('every interactive control has an accessible name', async ({ page }) => {
  const unnamed: string[] = [];

  for (const path of ROUTES) {
    await gotoApp(page, path);
    const anonymous = await page.evaluate(() =>
      [...document.querySelectorAll('button, a[href]')]
        .filter((el) => {
          if (!(el as HTMLElement).offsetParent && el.tagName === 'BUTTON') return false; // hidden
          const label =
            el.getAttribute('aria-label') ??
            el.getAttribute('title') ??
            (el.textContent ?? '').trim();
          return label.length === 0;
        })
        .map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().split(' ')[0]}`)
    );
    for (const el of anonymous) unnamed.push(`${path}: ${el} has no accessible name`);
  }

  expect(unnamed, unnamed.join('\n')).toEqual([]);
});
