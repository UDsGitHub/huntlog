import type { Locator, Page } from '@playwright/test';
import { expect, expectNoHorizontalScroll, panelUrl, test, chooseOption } from './fixtures';

// The service worker has the raw `chrome` global; borrow WXT's typings for it.
declare const chrome: typeof browser;

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
  await page.getByRole('button', { name: 'Add application' }).click();

  for (const label of ['Job posting URL', 'Company', /Job title/, 'Date applied']) {
    await expect(page.getByLabel(label)).toBeVisible();
  }
  for (const label of [/Location/, 'Minimum', /Notes/]) {
    await expect(page.getByLabel(label)).toBeHidden();
  }
  const save = page.getByRole('button', { name: 'Save', exact: true });
  expect(await inViewport(page, save)).toBe(true);

  await page.getByLabel('Job posting URL').fill('https://acme.com/jobs/1');
  await page.getByLabel('Company').fill('Acme');
  await page.getByRole('button', { name: 'More details' }).click();
  await page.getByLabel('Minimum').fill('85,000');
  await page.getByLabel(/Notes/).fill('A long note.\n'.repeat(20));
  // The form is now taller than its sheet and scrolls inside it; Save, the sheet's footer,
  // stays on screen, flush with the bottom of the panel.
  const body = page.getByRole('form', { name: 'Add application' }).locator('..');
  const { scrollHeight, clientHeight } = await body.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(scrollHeight).toBeGreaterThan(clientHeight);
  await body.evaluate((element) => element.scrollTo(0, 200));
  expect(await inViewport(page, save)).toBe(true);
  const footer = (await save.locator('..').boundingBox())!;
  expect(footer.y + footer.height).toBeCloseTo(568, 0);
  await expectNoHorizontalScroll(page);

  await save.click();
  await page.getByRole('button', { name: /^Acme/ }).click();
  await expect(page.getByRole('region', { name: 'Acme' })).toContainText('From $85,000 per year');
});

test('More details opens on a hidden error, and the field is in view', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('button', { name: 'Add application' }).click();
  await page.getByRole('button', { name: 'More details' }).click();
  await page.getByLabel('Minimum').fill('1,2,3');
  await page.getByRole('button', { name: 'More details' }).click();
  await page.getByLabel('Job posting URL').fill('https://acme.com/jobs/1');
  await page.getByLabel('Company').fill('Acme');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByLabel('Minimum')).toBeFocused();
  await expect(page.getByLabel('Minimum')).toBeVisible();
});

test('a focused field is never hidden behind the Save footer', async ({ session }) => {
  const page = await session.context.newPage();
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('button', { name: 'Add application' }).click();
  await page.getByLabel('Job posting URL').fill('https://acme.com/jobs/1');
  await page.getByLabel('Company').fill('Acme');
  await page.getByRole('button', { name: 'More details' }).click();
  await page.getByLabel(/Location/).fill('x'.repeat(201));
  await page.getByLabel(/Notes/).fill('A long note.\n'.repeat(30));

  // Every panel height from short to tall: the invalid field must land above the footer.
  const body = page.getByRole('form', { name: 'Add application' }).locator('..');
  for (let height = 380; height <= 700; height += 40) {
    await page.setViewportSize({ width: 320, height });
    await body.evaluate((element) => element.scrollTo(0, 0));
    await save.click();
    const location = page.getByLabel(/Location/);
    await expect(location).toBeFocused();
    const field = (await location.boundingBox())!;
    const bar = (await save.locator('..').boundingBox())!;
    expect(field.y + field.height, `panel height ${height}`).toBeLessThanOrEqual(bar.y);
  }
});

test('remembered source and work mode survive a panel reload', async ({ session }) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('button', { name: 'Add application' }).click();
  await page.getByLabel('Job posting URL').fill('https://acme.com/jobs/1');
  await page.getByLabel('Company').fill('Acme');
  await page.getByRole('button', { name: 'More details' }).click();
  await page
    .getByRole('group', { name: /^Source/ })
    .getByRole('button', { name: 'Referral' })
    .click();
  await chooseOption(page, 'Work mode', 'Remote');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Acme/ })).toBeVisible();
  // The defaults are written just after the save; wait for them before reloading.
  await expect
    .poll(() =>
      session.serviceWorker.evaluate(
        async () => (await chrome.storage.local.get('formDefaults')).formDefaults,
      ),
    )
    .toEqual({ source: 'Referral', workMode: 'remote' });

  await page.reload();
  await page.getByRole('button', { name: 'Add application' }).click();
  await expect(page.getByText('Remote · Referral')).toBeVisible();
  await page.getByRole('button', { name: 'More details' }).click();
  await expect(
    page.getByRole('group', { name: /^Source/ }).getByRole('button', { name: 'Referral' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('a job logged as Saved has no date applied', async ({ session }) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('button', { name: 'Add application' }).click();
  await page.getByLabel('Job posting URL').fill('https://acme.com/jobs/1');
  await page.getByLabel('Company').fill('Acme');
  await chooseOption(page, 'Status', 'Saved');
  await expect(page.getByLabel(/Date applied/)).toBeHidden();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: /^Acme/ }).click();
  const detail = page.getByRole('region', { name: 'Acme' });
  await expect(detail.getByRole('definition').first()).toHaveText('Saved');
  await expect(detail.getByText('Date applied')).toHaveCount(0);
});
