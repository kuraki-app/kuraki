import { test as base, expect, type Page } from '@playwright/test';

// Every spec imports `test` from here rather than from @playwright/test, so the
// console guard is impossible to forget.
//
// This is the cheapest high-value check in the suite. The web client has never
// been opened in a browser during development — `npm run build` does not
// typecheck and `svelte-check` cannot see a runtime error — so an exception
// thrown on mount has, until now, had nowhere to surface. A test that navigates
// and asserts nothing still earns its keep if it fails on console.error.

/** Console noise that is environmental rather than a defect. Keep this list
 *  short, and justify every entry — an allowlist is how a guard stops biting. */
const ALLOWED = [
  // The Places basemap is fetched from tile.openstreetmap.org (the deliberate
  // third-party exception recorded in AGENTS.md §11). CI and this sandbox have
  // no route to it, so tile loads fail with a network error that says nothing
  // about the application. The map container and controls are still asserted.
  /tile\.openstreetmap\.org/,
  // Chromium logs this for any <img> that 404s; asset-level failures are
  // asserted explicitly where they matter rather than through console noise.
  /Failed to load resource: the server responded with a status of 404/
];

function ignorable(message: string): boolean {
  return ALLOWED.some((pattern) => pattern.test(message));
}

/** Handed to every test so a spec that PROVOKES an error on purpose can say so,
 *  instead of that error being added to the global allowlist where it would
 *  also hide the same failure on every other page. */
export interface ConsoleGuard {
  allow(pattern: RegExp): void;
}

export const test = base.extend<{ consoleGuard: ConsoleGuard }>({
  consoleGuard: [
    async ({ page }, use, testInfo) => {
      const problems: string[] = [];
      const expected: RegExp[] = [];
      const ok = (text: string) => ignorable(text) || expected.some((p) => p.test(text));

      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (!ok(text)) problems.push(`console.error: ${text}`);
      });

      // An uncaught exception is strictly worse than a logged error: it means a
      // component stopped mid-mount and the page the user sees is incomplete.
      page.on('pageerror', (error) => {
        problems.push(`uncaught: ${error.message}`);
      });

      // Native alert/confirm/prompt. The app replaced all of them with real
      // dialogs (ConfirmDialog/PromptDialog) — unstylable, unthemable and
      // main-thread-blocking is the least of it; a native confirm cannot say
      // which of "Delete" and "Delete forever" it means. Playwright
      // auto-dismisses these, so without this listener a reintroduced
      // `confirm()` would not fail a test, it would silently make the action
      // never happen and the assertion after it would report the mystery.
      page.on('dialog', (dialog) => {
        problems.push(`native ${dialog.type()}(): ${dialog.message()}`);
        void dialog.dismiss();
      });

      await use({ allow: (pattern) => expected.push(pattern) });

      // Filter again at the end: `allow()` is usually called after the listeners
      // are attached but before the error is provoked, and a test may register a
      // pattern only once it knows what it is about to do.
      const remaining = problems.filter((p) => !expected.some((pattern) => pattern.test(p)));
      problems.length = 0;
      problems.push(...remaining);

      // Only fail a test that was otherwise passing. When a test has already
      // failed, its own assertion is the useful message and a console dump on
      // top of it just buries the cause.
      if (problems.length > 0 && testInfo.status === testInfo.expectedStatus) {
        throw new Error(
          `Browser reported ${problems.length} error(s):\n  ${problems.join('\n  ')}`
        );
      }
    },
    { auto: true }
  ]
});

export { expect };

/** The app is an SPA whose shell renders before the session check resolves.
 *  Waiting for #main means "signed in and past the boot state", which is what
 *  nearly every spec actually wants from a navigation. */
export async function gotoApp(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator('main#main')).toBeVisible();
}
