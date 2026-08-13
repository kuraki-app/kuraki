import { test, expect, gotoApp } from './support/fixtures';

// The Kura/Vault registers, and the seam between them.
//
// Registers were applied to shared chrome only — PageHeader, cards, EmptyState
// — and stopped at the page contents, which is what AGENTS.md recorded as a
// "deliberate scope cut". These tests pin the treatment now that it reaches the
// operational pages, and more importantly they pin the RULE that makes two
// registers safe to have at all: the register belongs to the page frame, never
// to the photo components.

const font = (locator: import('@playwright/test').Locator) =>
  locator.evaluate((el) => getComputedStyle(el).fontFamily);

test('Vault pages label in mono micro-caps', async ({ page }) => {
  await gotoApp(page, '/settings/server');

  const heading = page.getByText('Backup', { exact: true }).first();
  expect(await font(heading)).toMatch(/Geist Mono/);
  expect(
    await heading.evaluate((el) => getComputedStyle(el).textTransform)
  ).toBe('uppercase');
});

test('Vault states its figures in the data face', async ({ page }) => {
  await gotoApp(page, '/settings');

  // StatCard was already register-aware; this asserts the page it sits on is
  // actually declaring the Vault register, not that the component compiles.
  const figure = page.locator('.stat-value').first();
  await expect(figure).toBeVisible();
  expect(await font(figure)).toMatch(/Geist Mono/);
});

test('Kura pages are not touched by any of it', async ({ page }) => {
  await gotoApp(page, '/');
  await expect(page.locator('main#main')).toHaveAttribute('data-register', 'kura');

  // The timeline's day headings are the display face. If the Vault treatment
  // had been applied with a register-keyed element selector rather than an
  // opt-in component, this is what would have broken — AssetGrid renders its
  // day headers as <h2>, and Trash and Duplicates are Vault FRAMES.
  const day = page.locator('section.day h2').first();
  await expect(day).toBeVisible();
  expect(await font(day)).toMatch(/Fraunces/);
  expect(await day.evaluate((el) => getComputedStyle(el).textTransform)).toBe('none');
});

test('a Vault frame hosting photographs leaves the photographs alone', async ({ page }) => {
  // Trash and Duplicates are the mixed case: the decision is operational, the
  // objects are still memories.
  await gotoApp(page, '/');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.locator('button.tile').first().click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();

  await gotoApp(page, '/trash');
  await expect(page.locator('main#main')).toHaveAttribute('data-register', 'vault');

  const tile = page.locator('button.tile').first();
  await expect(tile).toBeVisible();
  // The tile is square and gapless whatever register the frame is in — the
  // photo components read none of the --frame-* tokens.
  const shape = await tile.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { ratio: r.width / r.height, radius: getComputedStyle(el).borderRadius };
  });
  expect(shape.ratio).toBeGreaterThan(0.95);
  expect(shape.ratio).toBeLessThan(1.05);
  expect(shape.radius).toBe('0px');

  // Put the library back.
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.locator('button.tile').first().click();
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('button.tile')).toHaveCount(0);
});
