import type { Page } from '@playwright/test';
import {
  expect,
  expectNoHorizontalScroll,
  panelUrl,
  sheetsClosed,
  test,
  chooseOption,
} from './fixtures';
import { STATUS_LABELS } from '../lib/status';
import type { Status } from '../lib/types';

async function addJob(page: Page, company: string, status?: Status) {
  await page.getByRole('button', { name: 'Add application', exact: true }).click();
  await page.getByLabel('Job posting URL').fill(`https://${company.toLowerCase()}.com/jobs/1`);
  await page.getByLabel('Company').fill(company);
  if (status) await chooseOption(page, 'Status', STATUS_LABELS[status]);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: new RegExp(`^${company}`) })).toBeVisible();
  await sheetsClosed(page);
}

const chip = (page: Page, company: string) =>
  page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: new RegExp(`^${company}`) }) })
    .getByRole('button', { name: /^Status: / });

const statusSheet = (page: Page) => page.getByRole('dialog', { name: 'Change status' });
const option = (page: Page, name: string) =>
  statusSheet(page).getByRole('button', { name, exact: true });

test('one tap changes a status in the sheet, and Undo reverts it', async ({ session }) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await addJob(page, 'Acme');

  await chip(page, 'Acme').click();
  await expect(statusSheet(page)).toBeVisible();
  await option(page, 'Interviewing').click();
  await expect(statusSheet(page)).toBeHidden();
  await expect(chip(page, 'Acme')).toHaveText('Interviewing');
  await expect(page.getByText('Moved Acme to Interviewing.')).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(chip(page, 'Acme')).toHaveText('Applied');
});

test('moving a Saved job to Interviewing asks for the date applied', async ({ session }) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await addJob(page, 'Acme', 'saved');

  await chip(page, 'Acme').click();
  await option(page, 'Interviewing').click();
  const prompt = page.getByRole('dialog', { name: 'When did you apply?' });
  await expect(prompt).toBeVisible();
  await prompt.getByLabel('Date applied').fill('2026-10-02');
  await prompt.getByRole('button', { name: 'Set date' }).click();
  await expect(chip(page, 'Acme')).toHaveText('Interviewing');

  await page.getByRole('button', { name: /^Acme/ }).click();
  await expect(page.getByRole('region', { name: 'Acme' })).toContainText('Oct 2, 2026');
});

test('the chip and its sheet work with the keyboard alone', async ({ session }) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await addJob(page, 'Acme');

  await chip(page, 'Acme').focus();
  await page.keyboard.press('Enter');
  await expect(option(page, 'Applied (current)')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  // Moving changes nothing; Enter picks.
  await expect(chip(page, 'Acme')).toHaveText('Applied');
  await page.keyboard.press('Enter');
  await expect(chip(page, 'Acme')).toHaveText('Interviewing');
  await expect(chip(page, 'Acme')).toBeFocused();

  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(statusSheet(page)).toBeHidden();
  await expect(chip(page, 'Acme')).toBeFocused();
});

test('the status sheet and the date step fit a 320px panel', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(panelUrl(session.extensionId));
  await addJob(page, `Long${'Q'.repeat(80)}`, 'saved');

  await page.getByRole('button', { name: /^Status: Saved/ }).click();
  await expect(statusSheet(page)).toBeVisible();
  // Every status is reachable: the sheet scrolls rather than running off the panel.
  await option(page, 'Ghosted').scrollIntoViewIfNeeded();
  await expect(option(page, 'Ghosted')).toBeInViewport();
  await expectNoHorizontalScroll(page);
  await option(page, 'Offer').click();
  await expect(page.getByRole('dialog', { name: 'When did you apply?' })).toBeVisible();
  await expectNoHorizontalScroll(page);
});
