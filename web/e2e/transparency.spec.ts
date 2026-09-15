import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test('transparency persists, stays independent of motion, and covers navigation and dialogs', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/settings/appearance');
  const choices = page.getByRole('group', { name: 'Transparency', exact: true });
  await choices.getByRole('button', { name: 'Reduced', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Primary', exact: true });
  await expect(nav).toHaveCSS('backdrop-filter', 'none');
  await expect(nav).toHaveCSS('background-color', 'rgb(250, 250, 250)');
  await page.reload();
  await expect(choices.getByRole('button', { name: 'Reduced', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await choices.getByRole('button', { name: 'Enabled', exact: true }).click();
  await expect(nav).toHaveCSS('backdrop-filter', 'blur(12px)');
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await choices.getByRole('button', { name: 'Reduced', exact: true }).click();
  await page.goto('/albums');
  // With no albums the page also shows an empty-state "New album" button, so an
  // unscoped locator matches twice whenever this runs before a test creates one.
  await page.locator('header').getByRole('button', { name: 'New album' }).click();
  await expect(page.getByRole('dialog')).toHaveCSS('backdrop-filter', 'none');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('system preference responds to OS changes and keeps the viewer image opaque', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      if (query !== '(prefers-reduced-transparency: reduce)') return nativeMatchMedia(query);
      return Object.assign(new EventTarget(), {
        matches: true, media: query, onchange: null,
        addListener() {}, removeListener() {}
      }) as MediaQueryList;
    };
    localStorage.setItem('kuraki:transparency', 'system');
  });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toHaveCSS('backdrop-filter', 'none');
  await page.locator('[data-asset-id]').first().click();
  const viewer = page.getByRole('dialog', { name: 'Photo viewer' });
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveCSS('backdrop-filter', 'none');
  await expect(viewer.getByRole('button', { name: 'Close', exact: true })).toHaveCSS('background-color', 'rgb(17, 17, 17)');
});
