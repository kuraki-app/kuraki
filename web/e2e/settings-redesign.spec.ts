import { test, expect, gotoApp } from './support/fixtures';

test('overview keeps library statistics when backup status is unavailable and can retry', async ({ page, consoleGuard }) => {
  consoleGuard.allow(/status of 503/);
  await page.route('**/api/backup', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Backup temporarily unavailable"}' }));
  await gotoApp(page, '/settings');
  await expect(page.getByText('Photos & videos', { exact: true })).toBeVisible();
  await expect(page.getByText('Backup status unavailable', { exact: true })).toBeVisible();
  await page.unroute('**/api/backup');
  await page.getByRole('button', { name: 'Retry backup status' }).click();
  await expect(page.getByText('Backup status unavailable', { exact: true })).toHaveCount(0);
});

test('saving a library setting preserves another unsaved draft', async ({ page }) => {
  await gotoApp(page, '/settings/library');
  const thumbnail = page.getByLabel('Thumbnail size', { exact: true });
  const retention = page.getByLabel('Trash retention', { exact: true });
  await expect(thumbnail).toBeVisible();
  const old = await retention.inputValue();
  await thumbnail.fill('640');
  await retention.fill('31');
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/settings') && r.request().method() === 'GET'), retention.locator('..').getByRole('button', { name: 'Save', exact: true }).click()]);
  await expect(retention.locator('..').getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(thumbnail).toHaveValue('640');
  await retention.fill(old);
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/settings') && r.request().method() === 'GET'), retention.locator('..').getByRole('button', { name: 'Save', exact: true }).click()]);
});

test('sidebar actions remain reachable on a short desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 600 });
  await gotoApp(page, '/');
  await expect(page.locator('.side-foot').getByRole('button', { name: 'Sign out' })).toBeInViewport();
});


test('failed sign out keeps the session and offers recovery without an unhandled error', async ({ page, consoleGuard }) => {
  consoleGuard.allow(/status of 503/);
  await gotoApp(page, '/');
  await page.route('**/api/logout', route => route.fulfill({ status: 503, body: '{}' }));
  await page.locator('.side-foot').getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText('Could not sign out. Check your connection and try again.', { exact: true })).toBeVisible();
  await expect(page.locator('main#main')).toBeVisible();
});

test('server saves preserve other drafts, including an unsaved secret', async ({ page }) => {
  await gotoApp(page, '/settings/server');
  const secret = page.getByLabel('Metrics token', { exact: true });
  const keep = page.getByLabel('Backups to keep', { exact: true });
  await expect(keep).toBeVisible();
  const original = await keep.inputValue();
  await secret.fill('unsaved-example-token');
  await keep.fill(String(Number(original) + 1));
  const save = () => Promise.all([page.waitForResponse(r => r.url().endsWith('/api/settings') && r.request().method() === 'GET'), keep.locator('..').getByRole('button', { name: 'Save', exact: true }).click()]);
  await save();
  await expect(secret).toHaveValue('unsaved-example-token');
  await expect(secret.locator('..').getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await keep.fill(original);
  await save();
});

test('every settings page fits desktop and phone in both themes', async ({ page }) => {
  for (const theme of ['light', 'dark']) {
    await page.addInitScript(mode => localStorage.setItem('mode-watcher-mode', mode), theme);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const section of ['', '/appearance', '/account', '/library', '/server', '/users', '/devices', '/activity']) {
        await gotoApp(page, '/settings' + section);
        await expect(page.locator('main h1')).toBeVisible();
        await expect(page.locator('main').getByText(/^Loading/)).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (section === '' && width < 700) {
          const columns = await page.locator('.cards').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
          expect(columns).toBe(2);
        }
        if (width !== 320 && ['', '/appearance', '/server'].includes(section)) {
          await page.screenshot({ path: `/tmp/kuraki-web-${theme}-${width}-${section.slice(1) || 'overview'}.png`, fullPage: true, animations: 'disabled' });
        }
      }
    }
  }
});

test('rejected OCR toggle restores the saved state', async ({ page }) => {
  await gotoApp(page, '/settings/library');
  const toggle = page.getByLabel('Text search in images (OCR)', { exact: true });
  await expect(toggle).toBeVisible();
  const before = await toggle.getAttribute('aria-pressed');
  await page.route('**/api/settings', async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    await route.fulfill({ json: { rejected: [{ key: 'ocr_enabled', error: 'OCR unavailable in test' }] } });
  });
  await toggle.click();
  await expect(page.getByText('OCR unavailable in test', { exact: true })).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', before!);
});

test('regular accounts do not request admin settings when opening a restricted page', async ({ page }) => {
  await page.route('**/api/setup', async route => {
    const response = await route.fetch();
    const status = await response.json();
    await route.fulfill({ response, json: { ...status, user: { ...status.user, role: 'user' } } });
  });
  const adminRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/settings') adminRequests.push(request.url());
  });
  await gotoApp(page, '/settings/library');
  await expect(page.getByText('Only an admin can manage library settings.', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Server', exact: true })).toHaveCount(0);
  expect(adminRequests).toEqual([]);
});

test('mobile navigation contains keyboard focus and restores its trigger', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, '/');
  const more = page.getByRole('button', { name: 'More', exact: true });
  await more.click();
  const sheet = page.getByRole('dialog', { name: 'More sections' });
  const close = sheet.getByRole('button', { name: 'Close navigation' });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(sheet.getByRole('button', { name: 'Sign out' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
});
