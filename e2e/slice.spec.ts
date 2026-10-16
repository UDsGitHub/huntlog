import type { Page } from '@playwright/test';
import { expect, expectNoHorizontalScroll, launchExtension, panelUrl, test } from './fixtures';

async function addJob(page: Page, url: string, company: string) {
  await page.getByRole('button', { name: '+ Add application' }).click();
  await page.getByLabel('Job posting URL').fill(url);
  await page.getByLabel('Company').fill(company);
  await page.getByRole('button', { name: 'Save' }).click();
}

// M0 slice: open the panel, add a job, see it listed, and it survives a browser restart.
test('a saved job is listed and survives a browser restart', async ({ userDataDir }) => {
  const first = await launchExtension(userDataDir);
  const page = await first.context.newPage();
  await page.goto(panelUrl(first.extensionId));
  await expect(page.getByRole('heading', { level: 1, name: 'Job Log' })).toBeVisible();
  await expect(page.getByText(/No applications yet/)).toBeVisible();

  await addJob(page, 'https://boards.greenhouse.io/acme/jobs/123', 'Acme');
  const list = page.getByRole('list', { name: 'Applications' });
  await expect(list).toContainText('Acme');
  await expect(list).toContainText('https://boards.greenhouse.io/acme/jobs/123');
  await first.context.close();

  const second = await launchExtension(userDataDir);
  try {
    const reopened = await second.context.newPage();
    await reopened.goto(panelUrl(second.extensionId));
    await expect(reopened.getByRole('list', { name: 'Applications' })).toContainText('Acme');
  } finally {
    await second.context.close();
  }
});

test('works with the keyboard alone', async ({ session }) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));

  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '+ Add application' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Job posting URL')).toBeFocused();
  await page.keyboard.type('example.com/jobs/7');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Keyboard Co');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('list', { name: 'Applications' })).toContainText('Keyboard Co');
  await expect(page.getByRole('button', { name: '+ Add application' })).toBeFocused();
});

test('fits a 320px panel with no horizontal scroll', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(session.extensionId));

  // The full form with every validation error showing.
  await page.getByRole('button', { name: '+ Add application' }).click();
  await page.getByRole('button', { name: 'More details' }).click();
  await page.getByLabel('Minimum').fill('lots');
  await page.getByLabel('Maximum').fill('also lots');
  await page.getByLabel('Date applied').fill('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Enter the date you applied.')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Cancel' }).click();

  // A row with very long values.
  await page.getByRole('button', { name: '+ Add application' }).click();
  await page.getByLabel('Job posting URL').fill(`https://example.com/${'a'.repeat(300)}`);
  await page.getByLabel('Company').fill(`Company${'X'.repeat(120)}`);
  await page.getByRole('button', { name: 'More details' }).click();
  await page.getByLabel(/Location/).fill(`Somewhere${'Y'.repeat(150)}`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('list', { name: 'Applications' })).toBeVisible();
  await expectNoHorizontalScroll(page);
});
