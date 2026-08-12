import { defineConfig, devices } from '@playwright/test';

// The port is shared with e2e/server.mjs through the environment, not an import
// — importing that module would start a server.
const PORT = Number(process.env.KURAKI_E2E_PORT ?? 3456);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.tmp/results',
  // The suite drives ONE server holding ONE library, and several specs mutate it
  // (archive, trash, batch edits). Parallel workers would race over shared rows.
  // The suite is small; serial is honest and keeps failures reproducible.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },

  projects: [
    // First-run setup is a once-per-library event, so it is a dependency project
    // rather than a test: it exercises the real setup form, then hands every
    // other project a signed-in storage state.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.tmp/owner.json' },
      dependencies: ['setup']
    }
  ],

  webServer: {
    command: 'node e2e/server.mjs',
    url: `${BASE_URL}/healthz`,
    // Never reuse: the server seeds a fresh library on boot, and a leftover one
    // from an earlier run has already had its owner claimed (setup returns 409).
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000
  }
});
