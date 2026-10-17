import type { Page } from '@playwright/test';
import {
  expect,
  expectNoHorizontalScroll,
  launchExtension,
  panelUrl,
  test,
  uploadResume as uploadFromSheet,
} from './fixtures';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100)]);

async function addJob(page: Page, company: string) {
  await page.getByRole('button', { name: 'Add application', exact: true }).click();
  await page.getByLabel('Job posting URL').fill(`https://${company.toLowerCase()}.com/jobs/1`);
  await page.getByLabel('Company').fill(company);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('listitem').filter({ hasText: company })).toBeVisible();
}

async function uploadResume(page: Page) {
  await page.getByRole('tab', { name: 'Resumes' }).click();
  const panel = page.getByRole('tabpanel', { name: 'Resumes' });
  await uploadFromSheet(page, { name: 'Backend v3.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(panel.getByRole('list', { name: 'Resumes' })).toContainText('Backend v3');
}

/** Clicks a theme's segment, as a user does (the radio itself is visually hidden). */
async function chooseTheme(page: Page, name: 'System' | 'Light' | 'Dark') {
  await settings(page).locator('label', { hasText: name }).click();
  await expect(settings(page).getByRole('radio', { name })).toBeChecked();
}

/** The header's gear, which opens Settings as a sheet. */
const settingsTab = (page: Page) => page.getByRole('button', { name: 'Settings', exact: true });
const settings = (page: Page) => page.getByRole('dialog', { name: 'Settings' });

test('the theme chosen in Settings applies at once and survives a restart', async ({
  userDataDir,
}) => {
  const first = await launchExtension(userDataDir);
  const page = await first.context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(first.extensionId));
  await settingsTab(page).click();
  await expectNoHorizontalScroll(page);

  // By keyboard: Tab into the theme group, then arrow keys move the choice.
  await settings(page).getByRole('radio', { name: 'System' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(settings(page).getByRole('radio', { name: 'Light' })).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(settings(page).getByRole('radio', { name: 'Dark' })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectNoHorizontalScroll(page);
  await first.context.close();

  const second = await launchExtension(userDataDir);
  try {
    const reopened = await second.context.newPage();
    await reopened.goto(panelUrl(second.extensionId));
    await expect(reopened.locator('html')).toHaveAttribute('data-theme', 'dark');
    await settingsTab(reopened).click();
    await expect(settings(reopened).getByRole('radio', { name: 'Dark' })).toBeChecked();
  } finally {
    await second.context.close();
  }
});

test('Delete all data removes applications and resumes for good, keeping settings', async ({
  userDataDir,
}) => {
  const first = await launchExtension(userDataDir);
  const page = await first.context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(first.extensionId));
  await addJob(page, 'Acme');
  await uploadResume(page);
  await settingsTab(page).click();
  // Near full height over the tab behind it, fitting 320px.
  const sheetBox = (await settings(page).locator('.sheet-panel').boundingBox())!;
  expect(sheetBox.height).toBeGreaterThan(620);
  await expectNoHorizontalScroll(page);
  await chooseTheme(page, 'Dark');

  const open = settings(page).getByRole('button', { name: 'Delete all data' });
  await open.click();
  const sheet = page.getByRole('dialog', { name: 'Delete all data?' });
  await expect(sheet).toBeVisible();
  // Escape closes it without deleting, and focus goes back to its button.
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(open).toBeFocused();

  await open.click();
  const confirm = sheet.getByRole('button', { name: 'Delete all data' });
  await expect(confirm).toBeDisabled();
  await sheet.getByLabel('Type DELETE to confirm').fill('DELETE');
  await expectNoHorizontalScroll(page);
  await confirm.click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText('All your data was deleted.')).toBeVisible();
  // Settings stays open over the emptied tab behind it.
  await expect(settings(page)).toBeVisible();
  await first.context.close();

  const second = await launchExtension(userDataDir);
  try {
    const reopened = await second.context.newPage();
    await reopened.goto(panelUrl(second.extensionId));
    await expect(reopened.getByText('No applications yet.')).toBeVisible();
    await reopened.getByRole('tab', { name: 'Resumes' }).click();
    await expect(reopened.getByRole('tabpanel', { name: 'Resumes' })).toContainText(
      'No resumes yet.',
    );
    // Settings stayed.
    await expect(reopened.locator('html')).toHaveAttribute('data-theme', 'dark');
  } finally {
    await second.context.close();
  }
});

test('Reset settings keeps the data, unless the box is ticked', async ({ session }) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await addJob(page, 'Acme');
  await settingsTab(page).click();
  await chooseTheme(page, 'Dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await settings(page).getByRole('button', { name: 'Reset settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Reset settings?' });
  await sheet.getByRole('button', { name: 'Reset settings' }).click();
  await expect(sheet).toBeHidden();
  await expect(settings(page).getByRole('radio', { name: 'System' })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listitem').filter({ hasText: 'Acme' })).toBeVisible();

  await settingsTab(page).click();
  await settings(page).getByRole('button', { name: 'Reset settings' }).click();
  await sheet.getByLabel(/Also delete all my data/).check();
  await sheet.getByLabel('Type DELETE to confirm').fill('DELETE');
  await sheet.getByRole('button', { name: 'Reset and delete everything' }).click();
  await expect(sheet).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByText('No applications yet.')).toBeVisible();
});

test('About links open the bundled privacy policy and notices', async ({ session }) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await settingsTab(page).click();
  const [privacy] = await Promise.all([
    session.context.waitForEvent('page'),
    settings(page).getByRole('link', { name: 'Privacy policy' }).click(),
  ]);
  await expect(privacy.getByRole('heading', { name: 'Privacy policy' })).toBeVisible();
  await expect(settings(page)).toContainText(/Huntlog \d+\.\d+\.\d+/);
});

test('Undo in a toast over Settings closes it and focuses the restored row', async ({
  session,
}) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await addJob(page, 'Acme');
  await page.getByRole('button', { name: /^Acme/ }).click();
  await page.getByRole('button', { name: /^More actions for/ }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await settingsTab(page).click();
  // The toast moved into Settings, where it stays usable.
  await settings(page).getByRole('button', { name: 'Undo' }).click();
  await expect(settings(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Acme/ })).toBeFocused();
});

test('closing a toast inside Settings keeps focus in Settings', async ({ session }) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('tab', { name: 'Stats' }).click();
  await settingsTab(page).click();
  await settings(page).getByRole('button', { name: 'Reset settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Reset settings?' });
  await sheet.getByRole('button', { name: 'Reset settings' }).click();
  await expect(sheet).toBeHidden();
  await settings(page).getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByText('Settings reset.')).toBeHidden();
  expect(await settings(page).evaluate((dialog) => dialog.contains(document.activeElement))).toBe(
    true,
  );
});
