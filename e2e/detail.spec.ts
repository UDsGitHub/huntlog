import type { Page } from '@playwright/test';
import { expect, expectNoHorizontalScroll, launchExtension, panelUrl, test } from './fixtures';

async function addJob(page: Page, fields: { url: string; company: string; notes?: string }) {
  await page.getByRole('button', { name: 'Add application' }).click();
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

  await page.getByRole('button', { name: /^More actions for/ }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByText('Deleted Acme.')).toBeVisible();
  await expect(page.getByText(/No applications yet/)).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('list', { name: 'Applications' })).toContainText('Lisbon · Remote');

  await page.getByRole('button', { name: /^Acme/ }).click();
  await page.getByRole('button', { name: /^More actions for/ }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
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

  // The header: Back, the heading, Edit, then the ⋯ menu.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Edit' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Job posting URL')).toBeFocused();
  await page.getByLabel('Company').focus();
  await page.keyboard.press('End');
  await page.keyboard.type(' GmbH');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 2, name: 'Acme GmbH' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit' })).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /^More actions for/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Add application', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Undo' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('list', { name: 'Applications' })).toContainText('Acme GmbH');

  await page.getByRole('button', { name: /^Acme GmbH/ }).click();
  await page.getByRole('button', { name: 'Back to applications' }).focus();
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

  await page.getByRole('button', { name: /^More actions for/ }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

// Regression (spec §4.3): a timeline date saved only when the field lost focus, so a date picked
// from the calendar (focus stays in the field) seemed to do nothing until a reload. Now Save is
// explicit, and Date applied follows at once.
test('a timeline date saves with Save, and Date applied follows at once', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(session.extensionId));
  await addJob(page, { url: 'https://acme.com/jobs/1', company: 'Acme' });
  await page.getByRole('button', { name: /^Acme/ }).click();
  const detail = page.getByRole('region', { name: 'Acme' });
  const timeline = page.getByRole('region', { name: 'Status history' });

  await timeline.getByRole('button', { name: 'Change the date for Applied' }).click();
  const field = timeline.getByLabel('Applied date');
  await expect(field).toBeFocused();
  await field.fill('2026-01-05');
  // Picked but not saved: nothing changes, and focus is still in the field.
  await expect(detail).not.toContainText('Jan 5, 2026');
  await timeline.getByRole('button', { name: 'Save the date for Applied' }).click();
  await expect(detail.getByRole('definition').filter({ hasText: 'Jan 5, 2026' })).toBeVisible();
  await expect(timeline).toContainText('Jan 5, 2026');
  await expect(timeline.getByRole('button', { name: 'Change the date for Applied' })).toBeFocused();
  await expectNoHorizontalScroll(page);
});

test('the posting opens from a button naming its site', async ({ session }) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await addJob(page, { url: 'https://www.boards.greenhouse.io/acme/jobs/1', company: 'Acme' });
  await page.getByRole('button', { name: /^Acme/ }).click();
  const posting = page.getByRole('link', { name: 'Open job posting on boards.greenhouse.io' });
  await expect(posting).toHaveText('boards.greenhouse.io');
  await expect(posting).toHaveAttribute('href', 'https://www.boards.greenhouse.io/acme/jobs/1');
});
