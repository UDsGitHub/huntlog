import { expect, launchExtension, panelUrl, sheetsClosed, test } from './fixtures';

test('⌘/Ctrl+Enter saves a form from Notes, and Escape leaves the detail view', async ({
  userDataDir,
}) => {
  const { context, extensionId } = await launchExtension(userDataDir);
  try {
    const page = await context.newPage();
    await page.goto(panelUrl(extensionId));

    // Add: the shortcut saves from Notes, where Enter is a new line.
    await page.getByRole('button', { name: 'Add application' }).click();
    await page.getByLabel('Company').fill('Acme');
    await page.getByLabel('Job posting URL').fill('https://acme.com/jobs/1');
    await page.getByRole('button', { name: 'More details' }).click();
    await page.getByLabel(/Notes/).fill('Call back');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.getByRole('list', { name: 'Applications' })).toContainText('Acme');
    await sheetsClosed(page);

    // Edit: from a closed Select.
    await page.getByRole('button', { name: /^Acme/ }).click();
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Company').fill('Acme Corp');
    await page.getByRole('combobox', { name: 'Status' }).focus();
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.getByRole('heading', { level: 2, name: 'Acme Corp' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeFocused();
    await sheetsClosed(page);

    // Escape is Back.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /^Acme Corp/ })).toBeFocused();
  } finally {
    await context.close();
  }
});
