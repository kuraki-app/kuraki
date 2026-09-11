import { test, expect, gotoApp } from './support/fixtures';

// A single busy month defeated the former section-level windowing. This is a
// renderer capacity test; the API and media transport use the real test server.
test('10,000 photos in one month keep mounted tiles bounded while scrolling and resizing', async ({ page, request }) => {
  const response = await request.get('/api/assets');
  const { assets } = await response.json();
  const sample = assets[0];
  await page.addInitScript(() => localStorage.setItem('kuraki:grouping', 'month'));
  await page.route(/\/api\/assets\?/, (route) => route.fulfill({ json: {
    assets: Array.from({ length: 10000 }, (_, i) => ({ ...sample, id: `capacity-${i}`, taken_day: '2025-08-01', taken_at: '2025-08-01T12:00:00Z' })),
    next_cursor: '',
  } }));
  await gotoApp(page, '/');
  const tiles = page.locator('button.tile');
  await expect(tiles.first()).toBeVisible();
  await expect(page.locator('.animate-pulse')).toHaveCount(0);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const counts: number[] = [];
  for (const fraction of [0.1, 0.5, 0.9]) {
    await page.evaluate((f) => window.scrollTo(0, document.documentElement.scrollHeight * f), fraction);
    await expect.poll(async () => {
      const nodes = await tiles.evaluateAll((els) => els.filter((el) => {
        const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight;
      }).length);
      return nodes;
    }).toBeGreaterThan(0);
    counts.push(await tiles.count());
    expect(await tiles.count()).toBeLessThan(400);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeCloseTo(height, -1);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(tiles.first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(await tiles.count()).toBeLessThan(200);
  console.log(`10k renderer: desktop mounted=${counts.join(',')}; phone mounted=${await tiles.count()}; height=${height}px`);
});

test('album covers use authenticated thumbnails supplied by Go', async ({ page, request }) => {
  const assets = (await (await request.get('/api/assets')).json()).assets.slice(0, 4);
  const album = await (await request.post('/api/albums', { data: { name: 'Parity cover fixture' } })).json();
  try {
    await request.post(`/api/albums/${album.id}/assets`, { data: { ids: assets.map((a: { id: string }) => a.id) } });
    await gotoApp(page, '/albums');
    const card = page.getByRole('link', { name: /Parity cover fixture/ });
    await expect(card.locator('img')).toHaveCount(4);
    await expect.poll(() => card.locator('img').evaluateAll((imgs) => imgs.every((img) => (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await page.screenshot({ animations: 'disabled', path: '/tmp/kuraki-parity-albums.png' });
    await card.click();
    await expect(page.locator('button.tile')).toHaveCount(4);
  } finally {
    await request.delete(`/api/albums/${album.id}`);
  }
});

test('phone viewer opens with full media and reveals details on demand', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, '/');
  await page.locator('button.tile').first().click();
  const viewer = page.getByRole('dialog', { name: 'Photo viewer' });
  await expect(viewer).toBeVisible();
  await expect(viewer.locator('.info')).toBeHidden();
  await page.getByRole('button', { name: 'Photo details' }).click();
  await expect(viewer.locator('.info')).toBeVisible();
  await page.getByRole('button', { name: 'Photo details' }).click();
  await expect(viewer.locator('.info')).toBeHidden();
  await page.screenshot({ animations: 'disabled', path: '/tmp/kuraki-parity-viewer-phone.png' });
  await viewer.locator('.frame').dblclick({ position: { x: 150, y: 200 } });
  await expect.poll(() => viewer.locator('.frame').evaluate((el) => el.style.getPropertyValue('--viewer-scale'))).toBe('2');
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
});

// The seeded capture dates predate today; inject only the memories feed so the
// rail can be verified on any date, backed by real authenticated thumbnails.
test('memories rail shares year grouping and excludes current-year photos', async ({ page, request }) => {
  const { assets } = await (await request.get('/api/assets')).json();
  const year = new Date().getFullYear();
  await page.route(/\/api\/memories\?/, (route) => route.fulfill({ json: {
    assets: assets.slice(0, 4).map((asset: object, index: number) => ({ ...asset, taken_at: `${year - Math.floor(index / 2)}-01-01T12:00:00Z`, taken_day: `${year - Math.floor(index / 2)}-01-01` })), next_cursor: '',
  } }));
  await gotoApp(page, '/');
  const rail = page.getByRole('region', { name: 'Memories' });
  await expect(rail.locator('.memory')).toHaveCount(1);
  await expect(rail).toContainText('Last year');
  await expect(page.locator('.animate-pulse')).toHaveCount(0);
  await page.screenshot({ animations: 'disabled', path: '/tmp/kuraki-parity-timeline-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ animations: 'disabled', path: '/tmp/kuraki-parity-timeline-phone.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({ animations: 'disabled', path: '/tmp/kuraki-parity-timeline-phone-dark.png' });
});
