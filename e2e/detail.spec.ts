import type { Page } from '@playwright/test';
import { expect, expectNoHorizontalScroll, launchExtension, panelUrl, test } from './fixtures';

async function addJob(page: Page, fields: { url: string; company: string; notes?: string }) {
  await page.getByRole('button', { name: '+ Add application' }).click();
  await page.getByLabel('Job posting URL').fill(fields.url);
  await page.getByLabel('Company').fill(fields.company);
  if (fields.notes) {
    await page.getByRole('button', { name: 'More details' }).click();
    await page.getByLabel(/Notes/).fill(fields.notes);
  }
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('list', { name: 'Applications' })).toContainText(fields.company);
}

test('view, edit, delete with Undo, then delete for good across a restart', async ({
  userDataDir,
}) => {
  const first = await launchExtension(userDataDir);
  const page = await first.context.newPage();
  await page.goto(panelUrl(first.extensionId));
  await addJob(page, { url: 'https://acme.com/jobs/1', company: 'Acme' });

  await page.getByRole('button', { name: /^Acme/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Acme' })).toBeFocused();

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'More details' }).click();
  await page.getByLabel(/Location/).fill('Lisbon');
  await page.getByLabel(/Work mode/).selectOption('remote');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Edit' })).toBeFocused();
  await expect(page.getByRole('definition').filter({ hasText: 'Lisbon' })).toBeVisible();

  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Deleted Acme.')).toBeVisible();
  await expect(page.getByText(/No applications yet/)).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('list', { name: 'Applications' })).toContainText('Lisbon · Remote');

  await page.getByRole('button', { name: /^Acme/ }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Deleted Acme.')).toBeVisible();
  // Let the toast run out: the delete stands.
  await expect(page.getByText('Deleted Acme.')).toBeHidden({ timeout: 8000 });
  await first.context.close();

  const second = await launchExtension(userDataDir);
  try {
    const reopened = await second.context.newPage();
    await reopened.goto(panelUrl(second.extensionId));
    await expect(reopened.getByText(/No applications yet/)).toBeVisible();
  } finally {
    await second.context.close();
  }
});

test('the whole flow works with the keyboard alone', async ({ session }) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await addJob(page, { url: 'https://acme.com/jobs/1', company: 'Acme' });

  await page.getByRole('button', { name: /^Acme/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 2, name: 'Acme' })).toBeFocused();

  // Back, Edit, Delete follow the heading in tab order.
  await page.getByRole('button', { name: 'Edit' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Job posting URL')).toBeFocused();
  await page.getByLabel('Company').focus();
  await page.keyboard.press('End');
  await page.keyboard.type(' GmbH');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 2, name: 'Acme GmbH' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit' })).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Delete' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '+ Add application' })).toBeFocused();
  await page.getByRole('button', { name: 'Undo' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('list', { name: 'Applications' })).toContainText('Acme GmbH');

  await page.getByRole('button', { name: /^Acme GmbH/ }).click();
  await page.getByRole('button', { name: '← Back to applications' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /^Acme GmbH/ })).toBeFocused();
});

test('the detail view and toast fit a 320px panel', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(session.extensionId));
  await addJob(page, {
    url: `https://acme.com/${'a'.repeat(300)}`,
    company: `Company${'X'.repeat(120)}`,
    notes: `${'word '.repeat(200)}\n${'Z'.repeat(400)}`,
  });

  await page.getByRole('button', { name: /^CompanyX/ }).click();
  await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expectNoHorizontalScroll(page);
});
