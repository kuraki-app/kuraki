import { test, expect, gotoApp } from './support/fixtures';

test.use({ launchOptions: { args: ['--host-resolver-rules=MAP kuraki-lan.test 127.0.0.1', '--no-proxy-server'] } });

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
  await expect(page.getByText('1 upload queued', { exact: true })).toBeHidden({ timeout: 15_000 });
});

test('uploads work on an ordinary HTTP LAN hostname', async ({ page, context, baseURL }) => {
  const session = (await context.cookies()).find(cookie => cookie.name === 'kuraki_session');
  if (!session || !baseURL) throw new Error('missing seeded owner session');
  const lan = new URL(baseURL);
  lan.hostname = 'kuraki-lan.test';
  await context.addCookies([{ name: session.name, value: session.value, url: lan.origin, httpOnly: true, sameSite: 'Lax' }]);
  await page.goto(lan.href);
  await expect(page.locator('main#main')).toBeVisible();
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
  const accepted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/assets' && response.request().method() === 'POST');
  await page.locator('input[type="file"]').setInputFiles('e2e/.tmp/fixtures/20240314-0.png');
  expect((await accepted).status()).toBe(202);
});

test('a cookie switch during a drain retains the next file in its original account', async ({ page, context, request, consoleGuard }) => {
  consoleGuard.allow(/status of 403/);
  await gotoApp(page, '/');
  const owner = (await (await request.get('/api/me')).json()).user.id;
  const name = `queue-owner-${Date.now()}`;
  const created = await request.post('/api/users', { data: { username: name, password: 'queue-owner-password' } });
  expect(created.status()).toBe(201);
  const other = (await created.json()).id;
  let uploads = 0;
  const responses: number[] = [];
  try {
    await page.route('**/api/assets', async route => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      expect(route.request().headers()['x-kuraki-owner-id']).toBe(owner);
      const response = await route.fetch();
      responses.push(response.status());
      if (++uploads === 1) {
        const login = await context.request.post('/api/login', { data: { username: name, password: 'queue-owner-password' } });
        expect(login.status()).toBe(200);
      }
      await route.fulfill({ response });
    });
    await page.locator('input[type="file"]').setInputFiles([
      'e2e/.tmp/fixtures/20240314-0.png',
      'e2e/.tmp/fixtures/20240314-1.png'
    ]);
    await expect.poll(() => responses.length).toBe(2);
    expect(responses).toEqual([202, 403]);
    const queued = await page.evaluate(async ownerId => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('kuraki-upload-queue');
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const rows = await new Promise<Array<{ ownerId: string; files: File[] }>>((resolve, reject) => {
        const read = database.transaction('batches').objectStore('batches').getAll();
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      });
      database.close();
      return rows.filter(row => row.ownerId === ownerId).reduce((count, row) => count + row.files.length, 0);
    }, owner);
    expect(queued).toBe(1);
    const newLibrary = await context.request.get('/api/assets');
    expect((await newLibrary.json()).assets).toEqual([]);
  } finally {
    await request.delete(`/api/users/${other}?purge=true`);
  }
});
