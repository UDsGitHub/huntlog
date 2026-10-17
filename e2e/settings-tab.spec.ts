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

const settingsTab = (page: Page) => page.getByRole('tab', { name: 'Settings' });
const settings = (page: Page) => page.getByRole('tabpanel', { name: 'Settings' });

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
  await page.getByRole('tab', { name: 'Applications' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Acme' })).toBeVisible();

  await settingsTab(page).click();
  await settings(page).getByRole('button', { name: 'Reset settings' }).click();
  await sheet.getByLabel(/Also delete all my data/).check();
  await sheet.getByLabel('Type DELETE to confirm').fill('DELETE');
  await sheet.getByRole('button', { name: 'Reset and delete everything' }).click();
  await expect(sheet).toBeHidden();
  await page.getByRole('tab', { name: 'Applications' }).click();
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
  await expect(settings(page)).toContainText(/Job Log \d+\.\d+\.\d+/);
});
