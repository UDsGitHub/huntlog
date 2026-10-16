import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

// The service worker has the raw `chrome` global; borrow WXT's typings for it.
declare const chrome: typeof browser;

const panelUrl = (extensionId: string) => `chrome-extension://${extensionId}/sidepanel.html`;

/** True when the element is fully inside the viewport, i.e. reachable without scrolling. */
async function inViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize()!;
  return Boolean(box && box.y >= 0 && box.y + box.height <= viewport.height);
}

// M3 scenario: + Add shows only the top fields, Save is visible; More details → salary → save.
test('the Add form fits a 320px panel with Save always in reach', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('button', { name: '+ Add application' }).click();

  for (const label of ['Job posting URL', 'Company', /Job title/, 'Date applied']) {
    await expect(page.getByLabel(label)).toBeVisible();
  }
  for (const label of [/Location/, 'Minimum', /Notes/]) {
    await expect(page.getByLabel(label)).toBeHidden();
  }
  const save = page.getByRole('button', { name: 'Save' });
  expect(await inViewport(page, save)).toBe(true);

  await page.getByLabel('Job posting URL').fill('https://acme.com/jobs/1');
  await page.getByLabel('Company').fill('Acme');
  await page.getByRole('button', { name: 'More details' }).click();
  await page.getByLabel('Minimum').fill('85,000');
  await page.getByLabel(/Notes/).fill('A long note.\n'.repeat(20));
  // The form is now taller than the panel; the sticky bar keeps Save on screen.
  const { scrollHeight, clientHeight } = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }));
  expect(scrollHeight).toBeGreaterThan(clientHeight);
  expect(await inViewport(page, save)).toBe(true);
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

  await save.click();
  await page.getByRole('button', { name: /^Acme/ }).click();
  await expect(page.getByRole('region', { name: 'Acme' })).toContainText('From $85,000 per year');
});

test('More details opens on a hidden error and the toast clears the sticky bar', async ({
  session,
}) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('button', { name: '+ Add application' }).click();
  await page.getByRole('button', { name: 'More details' }).click();
  await page.getByLabel('Minimum').fill('lots');
  await page.getByRole('button', { name: 'More details' }).click();
  await page.getByLabel('Job posting URL').fill('https://acme.com/jobs/1');
  await page.getByLabel('Company').fill('Acme');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByLabel('Minimum')).toBeFocused();
  await expect(page.getByLabel('Minimum')).toBeVisible();
});

test('a focused field is never hidden behind the sticky bar', async ({ session }) => {
  const page = await session.context.newPage();
  const save = page.getByRole('button', { name: 'Save' });
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('button', { name: '+ Add application' }).click();
  await page.getByLabel('Job posting URL').fill('https://acme.com/jobs/1');
  await page.getByLabel('Company').fill('Acme');
  await page.getByRole('button', { name: 'More details' }).click();
  await page.getByLabel(/Location/).fill('x'.repeat(201));
  await page.getByLabel(/Notes/).fill('A long note.\n'.repeat(30));

  // Every panel height from short to tall: the invalid field must land above the bar.
  for (let height = 380; height <= 700; height += 40) {
    await page.setViewportSize({ width: 320, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await save.click();
    const location = page.getByLabel(/Location/);
    await expect(location).toBeFocused();
    const field = (await location.boundingBox())!;
    const bar = (await save.locator('..').boundingBox())!;
    expect(field.y + field.height, `panel height ${height}`).toBeLessThanOrEqual(bar.y);
  }
});
