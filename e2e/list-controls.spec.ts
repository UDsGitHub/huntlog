import type { Page } from '@playwright/test';
import { expect, expectNoHorizontalScroll, panelUrl, test } from './fixtures';

async function addJob(
  page: Page,
  company: string,
  fields: { title?: string; status?: string } = {},
) {
  await page.getByRole('button', { name: '+ Add application' }).click();
  await page
    .getByLabel('Job posting URL')
    .fill(`https://${company.replace(/\W/g, '').toLowerCase()}.com/1`);
  await page.getByLabel('Company').fill(company);
  if (fields.title) await page.getByLabel(/Job title/).fill(fields.title);
  if (fields.status) await page.getByLabel('Status').selectOption(fields.status);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: new RegExp(`^${company}`) })).toBeVisible();
}

const companies = (page: Page) =>
  page
    .getByRole('list', { name: 'Applications' })
    .getByRole('listitem')
    .locator('button span:first-child');

test('filter, search and sort a set of jobs', async ({ session }) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await addJob(page, 'Acme', { title: 'C++ Engineer' });
  await addJob(page, 'Société Générale', { title: 'Analyst' });
  await addJob(page, 'Beta', { status: 'saved' });
  await addJob(page, 'Gamma', { status: 'rejected' });

  await page.getByLabel('Show').selectOption('closed');
  await expect(companies(page)).toHaveText(['Gamma']);
  await page.getByLabel('Show').selectOption('all');

  await page.getByLabel('Search').fill('societe');
  await expect(companies(page)).toHaveText(['Société Générale']);
  await page.getByLabel('Search').fill('c++');
  await expect(companies(page)).toHaveText(['Acme']);
  await page.getByLabel('Search').fill('');

  await page.getByLabel('Sort by').selectOption('company');
  await expect(companies(page)).toHaveText(['Acme', 'Beta', 'Gamma', 'Société Générale']);

  await page.getByLabel('Show').selectOption('offer');
  await expect(page.getByText('No applications match.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search and filter' }).click();
  await expect(companies(page)).toHaveCount(4);
});

test('the list controls fit a 320px panel and work by keyboard', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(session.extensionId));
  await addJob(page, `Long${'Q'.repeat(80)}`, { title: `Title ${'W'.repeat(80)}` });
  await addJob(page, 'Acme');
  await expectNoHorizontalScroll(page);

  await page.getByLabel('Search').focus();
  await page.keyboard.type('acme');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Show')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Sort by')).toBeFocused();
  await expect(companies(page)).toHaveText(['Acme']);
  await expectNoHorizontalScroll(page);
});
