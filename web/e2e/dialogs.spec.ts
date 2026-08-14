import { test, expect, gotoApp } from './support/fixtures';

// Every destructive or naming action goes through a real dialog. The console
// guard in support/fixtures.ts fails any test that triggers a native
// alert/confirm/prompt, so these tests also prove the natives are gone — a
// reintroduced `confirm()` makes them fail rather than silently no-op.

test('creating and renaming an album uses a real dialog', async ({ page }) => {
  await gotoApp(page, '/albums');

  // Two "New album" buttons exist by design once the list is empty: the header
  // action and the empty state's. Scope to the header.
  await page.locator('header, .page-header').getByRole('button', { name: 'New album' }).first().click();
  const create = page.getByRole('dialog');
  await expect(create).toBeVisible();

  // A prompt() could not do this: an empty name simply did nothing, with no way
  // to say why.
  await expect(create.getByRole('button', { name: 'Create' })).toBeDisabled();

  await create.getByLabel('Album name').fill('Kyoto, spring');
  await create.getByRole('button', { name: 'Create' }).click();

  await expect(page).toHaveURL(/\/albums\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Kyoto, spring' })).toBeVisible();

  await page.getByRole('button', { name: 'Rename' }).click();
  const rename = page.getByRole('dialog');
  await expect(rename.getByLabel('Album name')).toHaveValue('Kyoto, spring');
  await rename.getByLabel('Album name').fill('Kyoto');
  await rename.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByRole('heading', { name: 'Kyoto' })).toBeVisible();

  // Clean up after itself, which also covers the delete dialog.
  await page.getByRole('button', { name: 'Delete' }).click();
  const remove = page.getByRole('dialog');
  await expect(remove).toContainText('Your photos stay in the library');
  await remove.getByRole('button', { name: 'Delete album' }).click();
  await expect(page).toHaveURL(/\/albums$/);
});

test('deleting a tag explains what is lost', async ({ page }) => {
  await gotoApp(page, '/tags');

  await page.getByPlaceholder(/tag/i).first().fill('e2e-temp-tag');
  await page.getByRole('button', { name: /Add|Create/ }).first().click();
  await expect(page.getByText('e2e-temp-tag')).toBeVisible();

  await page.getByRole('button', { name: 'Delete e2e-temp-tag' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Photos keep their files');
  await dialog.getByRole('button', { name: 'Delete tag' }).click();

  await expect(page.getByText('e2e-temp-tag')).toHaveCount(0);
});

test('a dialog can be dismissed with Escape and returns focus', async ({ page }) => {
  await gotoApp(page, '/albums');

  const trigger = page.getByRole('button', { name: 'New album' }).first();
  await trigger.focus();
  await trigger.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  // bits-ui restores focus to the trigger. This is the behaviour the hand-rolled
  // modals had to have written by hand, and the viewer did not have at all.
  await expect(trigger).toBeFocused();
});
