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

async function addJob(
  page: Page,
  company: string,
  fields: { title?: string; status?: Status } = {},
) {
  await page.getByRole('button', { name: 'Add application', exact: true }).click();
  await page
    .getByLabel('Job posting URL')
    .fill(`https://${company.replace(/\W/g, '').toLowerCase()}.com/1`);
  await page.getByLabel('Company').fill(company);
  if (fields.title) await page.getByLabel(/Job title/).fill(fields.title);
  if (fields.status) await chooseOption(page, 'Status', STATUS_LABELS[fields.status]);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: new RegExp(`^${company}`) })).toBeVisible();
  // The next Add opens only once this sheet has gone.
  await sheetsClosed(page);
}

const companies = (page: Page) =>
  page.getByRole('list', { name: 'Applications' }).getByRole('listitem').locator('.row-open');

const filters = (page: Page) => page.getByRole('dialog', { name: 'Filter and sort' });

test('filter, search and sort a set of jobs', async ({ session }) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await addJob(page, 'Acme', { title: 'C++ Engineer' });
  await addJob(page, 'Société Générale', { title: 'Analyst' });
  await addJob(page, 'Beta', { status: 'saved' });
  await addJob(page, 'Gamma', { status: 'rejected' });

  await page.getByRole('button', { name: 'Filters' }).click();
  await filters(page).getByRole('button', { name: 'Closed' }).click();
  // A draft until Apply: a click on the dimmed area outside closes it and discards it.
  await expect(companies(page)).toHaveCount(4);
  await page.mouse.click(10, 10);
  await expect(filters(page)).toBeHidden();
  await expect(companies(page)).toHaveCount(4);

  await page.getByRole('button', { name: 'Filters' }).click();
  await filters(page).getByRole('button', { name: 'Closed' }).click();
  await filters(page).getByRole('button', { name: 'Saved' }).click();
  await filters(page).getByRole('button', { name: 'Apply' }).click();
  await expect(filters(page)).toBeHidden();
  await expect(companies(page)).toHaveText(['Gamma', 'Beta']);
  await expect(page.getByRole('button', { name: 'Filters, 1 on' })).toBeVisible();
  await expect(page.getByText('Showing 2 of 4')).toBeVisible();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();

  await page.getByLabel('Search').fill('societe');
  await expect(companies(page)).toHaveText(['Société Générale']);
  await page.getByLabel('Search').fill('c++');
  await expect(companies(page)).toHaveText(['Acme']);
  await page.getByLabel('Search').fill('');

  await page.getByRole('button', { name: 'Filters' }).click();
  await filters(page).locator('label', { hasText: 'Company' }).click();
  // The sort marker slides under the chosen option.
  const marker = filters(page).locator('[data-marker]');
  const option = filters(page).locator('label', { hasText: 'Company' });
  await expect
    .poll(async () => {
      const [m, o] = [await marker.boundingBox(), await option.boundingBox()];
      return Math.abs(Math.round(m!.x - o!.x));
    })
    .toBe(0);
  await filters(page).getByRole('button', { name: 'Apply' }).click();
  await expect(companies(page)).toHaveText(['Acme', 'Beta', 'Gamma', 'Société Générale']);
  await page.getByRole('button', { name: 'Filters' }).click();
  await filters(page).getByRole('button', { name: 'Offer' }).click();
  await filters(page).getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('No applications match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(companies(page)).toHaveCount(4);
});

test('the list controls and filter sheet fit 320px and work by keyboard', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(session.extensionId));
  await addJob(page, `Long${'Q'.repeat(80)}`, { title: `Title ${'W'.repeat(80)}` });
  await addJob(page, 'Acme');
  await expectNoHorizontalScroll(page);
  // A long company name is cut off on its row, not wrapped or overflowing.
  const long = companies(page).filter({ hasText: 'LongQ' });
  expect(await long.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);

  await page.getByLabel('Search').focus();
  await page.keyboard.type('acme');
  await expect(companies(page)).toHaveText(['Acme']);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Filters' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(filters(page)).toBeVisible();
  // The first control: the sort, chosen with the arrow keys.
  await expect(filters(page).getByRole('radio', { name: 'Last activity' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(filters(page).getByRole('radio', { name: 'Date applied' })).toBeChecked();
  await expectNoHorizontalScroll(page);
  await page.keyboard.press('Escape');
  await expect(filters(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Filters' })).toBeFocused();
});

test('the whole row opens the job; its chip and link do their own thing', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(session.extensionId));
  await addJob(page, 'Acme', { title: 'Engineer' });
  const row = page.getByRole('listitem').filter({ hasText: 'Acme' });
  const box = (await row.boundingBox())!;

  // The chip opens its menu, not the job.
  await row.getByRole('button', { name: /^Status: / }).click();
  await expect(page.getByRole('dialog', { name: 'Change status' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Change status' })).toBeHidden();

  // A click on the title line, away from the company name, opens the job.
  await page.mouse.click(box.x + 40, box.y + box.height - 12);
  await expect(page.getByRole('heading', { level: 2, name: 'Acme' })).toBeVisible();
});

test('filter by source at 320px', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(panelUrl(session.extensionId));
  /** Adds a job with a source: a chip, a typed Other source, or none. */
  async function addWithSource(company: string, source: string | null, other = false) {
    await page.getByRole('button', { name: 'Add application', exact: true }).click();
    await page.getByLabel('Job posting URL').fill(`https://${company.toLowerCase()}.com/1`);
    await page.getByLabel('Company').fill(company);
    await page.getByRole('button', { name: /More details/ }).click();
    const group = page.getByRole('group', { name: /^Source/ });
    if (other) {
      await group.getByRole('button', { name: 'Other', exact: true }).click();
      await page.getByLabel('Other source').fill(source!);
    } else if (source) {
      await group.getByRole('button', { name: source, exact: true }).click();
    }
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: new RegExp(`^${company}`) })).toBeVisible();
    await sheetsClosed(page);
  }
  await addWithSource('Nosource', null);
  await addWithSource('Acme', 'LinkedIn');
  await addWithSource('Globex', 'Glassdoor', true);

  await page.getByRole('button', { name: 'Filters' }).click();
  const source = filters(page).getByRole('group', { name: 'Source' });
  await expect(source.getByRole('button')).toHaveText(['LinkedIn', 'Glassdoor', 'Not set']);
  await source.getByRole('button', { name: 'LinkedIn' }).click();
  await source.getByRole('button', { name: 'Not set' }).click();
  await expectNoHorizontalScroll(page);
  await filters(page).getByRole('button', { name: 'Apply' }).click();
  await expect(filters(page)).toBeHidden();
  await expect(companies(page)).toHaveText(['Acme', 'Nosource']);
  await expect(page.getByRole('button', { name: 'Filters, 1 on' })).toBeVisible();
  await expect(page.getByText('Showing 2 of 3')).toBeVisible();
});
