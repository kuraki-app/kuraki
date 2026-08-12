import { test, expect, gotoApp } from './support/fixtures';

// One SegmentedControl replaced four hand-rolled versions of the same idea.
// They differed in padding, radius and fill, but the difference that mattered
// was semantic: two set `aria-pressed`, two rendered a row of anonymous
// buttons inside an unlabelled div. These tests pin the semantics so a fifth
// implementation cannot quietly reappear.

test('every segmented control is a labelled group of pressable options', async ({ page }) => {
  await gotoApp(page, '/settings/appearance');

  for (const label of ['Theme', 'Grid density', 'Group timeline by', 'Default view']) {
    const group = page.getByRole('group', { name: label });
    await expect(group, `${label} is not a labelled group`).toBeVisible();

    // Exactly one option is current, and it says so.
    const pressed = group.getByRole('button', { pressed: true });
    await expect(pressed, `${label} has no pressed option`).toHaveCount(1);
  }
});

test('choosing an option updates the pressed state and persists', async ({ page }) => {
  await gotoApp(page, '/settings/appearance');

  const grouping = page.getByRole('group', { name: 'Group timeline by' });
  await grouping.getByRole('button', { name: 'Month' }).click();
  await expect(grouping.getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'true');

  // These are localStorage-backed preferences, so the real assertion is that
  // the choice survives a reload.
  await gotoApp(page, '/settings/appearance');
  await expect(
    page.getByRole('group', { name: 'Group timeline by' }).getByRole('button', { name: 'Month' })
  ).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('group', { name: 'Group timeline by' }).getByRole('button', { name: 'Day' }).click();
});

test('the timeline density control is icon-only but still named', async ({ page }) => {
  await gotoApp(page, '/');

  const density = page.getByRole('group', { name: 'Grid density' });
  await expect(density).toBeVisible();
  // Icon-only, because it sits above the photographs — but an icon with no
  // accessible name is a button nobody can identify.
  await expect(density.getByRole('button', { name: 'Compact grid' })).toBeVisible();
  await expect(density.getByRole('button', { name: 'Large grid' })).toBeVisible();
});

test('media type is a group, and Favorites stays an independent toggle', async ({ page }) => {
  await gotoApp(page, '/');
  await page.getByRole('button', { name: 'Filters' }).click();

  // Three mutually exclusive options…
  const types = page.getByRole('group', { name: 'Media type' });
  await expect(types.getByRole('button', { pressed: true })).toHaveCount(1);
  await types.getByRole('button', { name: 'Videos' }).click();
  await expect(types.getByRole('button', { name: 'Videos' })).toHaveAttribute('aria-pressed', 'true');

  // …and one toggle that is not part of them. They used to be one row of four
  // identical pills, which is not what they are.
  const favorites = page.getByRole('button', { name: 'Favorites' });
  await expect(favorites).toHaveAttribute('aria-pressed', 'false');

  await types.getByRole('button', { name: 'All' }).click();
});
