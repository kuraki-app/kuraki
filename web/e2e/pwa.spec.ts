import { test, expect, gotoApp } from './support/fixtures';

test('ships an installable shell and background upload worker', async ({ request }) => {
  const manifestResponse = await request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({ name: 'Kuraki Photos', display: 'standalone', start_url: '/' });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192' }),
      expect.objectContaining({ sizes: '512x512' })
    ])
  );

  const workerResponse = await request.get('/service-worker.js');
  expect(workerResponse.ok()).toBe(true);
  const worker = await workerResponse.text();
  expect(worker).toContain('kuraki-upload-queue');
  expect(worker).toContain('/api/');
});

test('an offline photo upload resumes when the connection returns', async ({
  page,
  context,
  consoleGuard
}) => {
  await gotoApp(page, '/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  consoleGuard.allow(/ERR_INTERNET_DISCONNECTED/);

  await context.setOffline(true);
  await page.locator('input[type="file"]').setInputFiles('e2e/.tmp/fixtures/20240314-0.png');
  await expect(page.getByRole('status')).toContainText('1 upload queued');

  await context.setOffline(false);
  await expect(page.getByText('1 upload queued')).toBeHidden({ timeout: 15_000 });
});
