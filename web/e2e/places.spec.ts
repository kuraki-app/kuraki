import { test, expect, gotoApp } from './support/fixtures';

// Places was the one screen that looked like it came from a different product:
// stock Leaflet chrome — square white buttons with a black border, a blue-link
// attribution — over a bright blue basemap, against warm paper and soft rounded
// controls everywhere else. And with nothing located it still drew a full empty
// world map, which does not read as "no photos carry GPS"; it reads as broken.

test('an empty Places shows an explanation, not an empty world map', async ({ page }) => {
  // The seeded fixtures are PNGs with no EXIF, so nothing has GPS.
  await gotoApp(page, '/places');

  await expect(page.locator('.empty-title')).toBeVisible();
  await expect(page.locator('.empty-body')).toContainText('GPS');

  // The map is not merely hidden — it is never built. A Leaflet instance over
  // nothing costs a tile fetch and a third-party request for a picture of
  // nowhere.
  await expect(page.locator('.leaflet-container')).toHaveCount(0);
  await expect(page.locator('.map')).toHaveCount(0);
});

test('the map appears once something has a location, wearing the app chrome', async ({ page }) => {
  await gotoApp(page, '/');

  // Give one photo a location through the same PATCH the viewer's edit form
  // uses. This is the only way to get a located asset out of EXIF-less
  // fixtures, and it exercises the GPS write path while it is here.
  const id = await page.evaluate(async () => {
    const list = await (await fetch('/api/assets?limit=1', { credentials: 'same-origin' })).json();
    const assetId = list.assets[0].id;
    await fetch(`/api/assets/${assetId}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gps_lat: 35.0116, gps_lon: 135.7681 })
    });
    return assetId;
  });

  await gotoApp(page, '/places');
  await expect(page.locator('.leaflet-container')).toBeVisible();

  // Leaflet sizes its zoom buttons with `.leaflet-touch .leaflet-bar a`, which
  // outranks a plain `.leaflet-control-zoom a` — the first attempt at this
  // restyle changed nothing at all because of that tie. 30x30 was also below
  // any sane target floor, and these are the map's only controls.
  const zoom = page.locator('.leaflet-control-zoom a').first();
  const box = await zoom.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);

  // The basemap is toned toward the palette with a filter on the tile pane, so
  // no tile is re-hosted and the whole treatment is one declaration to remove.
  const filter = await page
    .locator('.leaflet-tile-pane')
    .evaluate((el) => getComputedStyle(el).filter);
  expect(filter).not.toBe('none');

  // Put the fixture back the way the rest of the suite expects it.
  await page.evaluate(async (assetId) => {
    await fetch(`/api/assets/${assetId}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clear_gps: true })
    });
  }, id);
});
