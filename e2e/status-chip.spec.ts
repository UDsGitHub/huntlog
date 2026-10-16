import type { Page } from '@playwright/test';
import { expect, expectNoHorizontalScroll, panelUrl, test } from './fixtures';

async function addJob(page: Page, company: string, status?: string) {
  await page.getByRole('button', { name: '+ Add application' }).click();
  await page.getByLabel('Job posting URL').fill(`https://${company.toLowerCase()}.com/jobs/1`);
  await page.getByLabel('Company').fill(company);
  if (status) await page.getByLabel('Status').selectOption(status);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: new RegExp(`^${company}`) })).toBeVisible();
}

const chip = (page: Page, company: string) =>
  page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: new RegExp(`^${company}`) }) })
    .getByRole('button', { name: /^Status: / });

test('one tap changes a status, and Undo reverts it', async ({ session }) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await addJob(page, 'Acme');

  await chip(page, 'Acme').click();
  await page.getByRole('menuitemradio', { name: 'Interviewing' }).click();
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
  await page.getByRole('menuitemradio', { name: 'Interviewing' }).click();
  const prompt = page.getByRole('dialog', { name: 'When did you apply?' });
  await expect(prompt).toBeVisible();
  await prompt.getByLabel('Date applied').fill('2026-10-02');
  await prompt.getByRole('button', { name: 'Set date' }).click();
  await expect(chip(page, 'Acme')).toHaveText('Interviewing');

  await page.getByRole('button', { name: /^Acme/ }).click();
  await expect(page.getByRole('region', { name: 'Acme' })).toContainText('2026-10-02');
});

test('the chip works with the keyboard alone', async ({ session }) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await addJob(page, 'Acme');

  await chip(page, 'Acme').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitemradio', { name: /Applied/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(chip(page, 'Acme')).toHaveText('Interviewing');
  await expect(chip(page, 'Acme')).toBeFocused();

  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(chip(page, 'Acme')).toBeFocused();
});

test('the open menu and the date prompt fit a 320px panel', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(session.extensionId));
  await addJob(page, `Long${'Q'.repeat(80)}`, 'saved');

  await page.getByRole('button', { name: /^Status: Saved/ }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole('menuitemradio', { name: 'Offer' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectNoHorizontalScroll(page);
});
