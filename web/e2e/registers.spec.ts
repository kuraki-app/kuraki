import { test, expect, gotoApp } from './support/fixtures';

// The Kura/Vault registers, and the seam between them.
//
// Registers were applied to shared chrome only — PageHeader, cards, EmptyState
// — and stopped at the page contents, which is what AGENTS.md recorded as a
// "deliberate scope cut". These tests pin the treatment now that it reaches the
// operational pages, and more importantly they pin the RULE that makes two
// registers safe to have at all: the register belongs to the page frame, never
// to the photo components.

const styleOf = (
  locator: import('@playwright/test').Locator,
  prop: string
) => locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p).trim(), prop);

// One family across the whole app, so the registers can no longer be told
// apart by typeface — they are told apart by rhythm, density and treatment.
// This is the pin: if a display or data face is ever reintroduced, it has to be
// a decision someone makes here, not a drift.
test('the registers share one typeface', async ({ page }) => {
  await gotoApp(page, '/settings');
  const root = page.locator('main#main');

  const [heading, sans, mono] = await Promise.all([
    styleOf(root, '--font-heading'),
    styleOf(root, '--font-sans'),
    styleOf(root, '--font-mono'),
  ]);
  expect(heading).toBe(sans);
  expect(mono).toBe(sans);
});

test('Vault pages label in micro-caps', async ({ page }) => {
  await gotoApp(page, '/settings/server');

  // The label treatment, not the label's font file: uppercased, tracked out and
  // small is what makes a Vault label read as a field name rather than prose.
  const heading = page.getByText('Backup', { exact: true }).first();
  expect(await styleOf(heading, 'text-transform')).toBe('uppercase');
  expect(await styleOf(heading, 'font-size')).toBe('11px');
  // 0.06em at 11px.
  expect(parseFloat(await styleOf(heading, 'letter-spacing'))).toBeCloseTo(0.66, 1);
});

test('Vault pages keep the tighter rhythm', async ({ page }) => {
  await gotoApp(page, '/settings');
  const root = page.locator('main#main');
  await expect(root).toHaveAttribute('data-register', 'vault');

  // 4px against Kura's 8px. Every Vault gap and pad is a multiple of this, so
  // it is the single value that decides the density of the whole page.
  expect(await styleOf(root, '--space-step')).toBe('4px');
  expect(await styleOf(root, '--frame-radius')).toBe('4px');

  // StatCard was already register-aware; this asserts the page it sits on is
  // actually declaring the register, not that the component compiles.
  const figure = page.locator('.stat-value').first();
  await expect(figure).toBeVisible();
  // Figures in a column must not jitter as digits change.
  expect(await styleOf(figure, 'font-variant-numeric')).toBe('tabular-nums');
});

test('Kura pages are not touched by any of it', async ({ page }) => {
  await gotoApp(page, '/');
  const root = page.locator('main#main');
  await expect(root).toHaveAttribute('data-register', 'kura');
  expect(await styleOf(root, '--space-step')).toBe('8px');

  // The timeline's day headings are prose. If the Vault treatment had been
  // applied with a register-keyed element selector rather than an opt-in
  // component, this is what would have broken — AssetGrid renders its day
  // headers as <h2>, and Trash and Duplicates are Vault FRAMES.
  const day = page.locator('section.day h2').first();
  await expect(day).toBeVisible();
  expect(await styleOf(day, 'text-transform')).toBe('none');
  expect(await styleOf(day, 'font-size')).not.toBe('11px');
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
  // The tile is square with soft corners whatever register the frame is in — the
  // photo components read none of the --frame-* tokens.
  const shape = await tile.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { ratio: r.width / r.height, radius: getComputedStyle(el).borderRadius };
  });
  expect(shape.ratio).toBeGreaterThan(0.95);
  expect(shape.ratio).toBeLessThan(1.05);
  expect(shape.radius).toBe('8px');

  // Put the library back.
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.locator('button.tile').first().click();
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('button.tile')).toHaveCount(0);
});
