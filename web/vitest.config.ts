import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests cover the pure logic in src/lib only. e2e/ is Playwright's and
    // imports @playwright/test, which Vitest must not try to run.
    include: ['src/**/*.test.ts'],
    // Run in a zone WEST of Greenwich on purpose. `taken_day` is a calendar day,
    // and the bug these tests pin — parsing it as UTC midnight and formatting it
    // locally — is invisible at UTC or at any positive offset, which includes
    // the machine this was written on (+05:30). Pinning the zone is what makes
    // the assertions mean something rather than pass by geography.
    env: { TZ: 'America/Los_Angeles' }
  }
});
