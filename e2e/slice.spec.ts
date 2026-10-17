import type { Page } from '@playwright/test';
import {
  expect,
  expectNoHorizontalScroll,
  launchExtension,
  panelUrl,
  sheetsClosed,
  test,
} from './fixtures';

async function addJob(page: Page, url: string, company: string) {
  await page.getByRole('button', { name: 'Add application' }).click();
  await page.getByLabel('Job posting URL').fill(url);
  await page.getByLabel('Company').fill(company);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
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
  await expect(list.getByRole('link', { name: 'Open job posting for Acme' })).toHaveAttribute(
    'href',
    'https://boards.greenhouse.io/acme/jobs/123',
  );
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
  // Wait for the list, so Tab order is final.
  await expect(page.getByText('No applications yet.')).toBeVisible();

  // The header's Settings gear, then the selected tab.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tab', { name: 'Applications' })).toBeFocused();
  // The empty list's own button comes first, then the floating + Add.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Add your first application' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Add application', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  // The form opens in a sheet on Company, the first field; then the title, then the URL.
  await expect(page.getByLabel('Company')).toBeFocused();
  await page.keyboard.type('Keyboard Co');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Job posting URL')).toBeFocused();
  await page.keyboard.type('example.com/jobs/7');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('list', { name: 'Applications' })).toContainText('Keyboard Co');
  await sheetsClosed(page);
  await expect(page.getByRole('button', { name: 'Add application', exact: true })).toBeFocused();
});

test('fits a 320px panel with no horizontal scroll', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(session.extensionId));

  // The full form with every validation error showing.
  await page.getByRole('button', { name: 'Add application' }).click();
  await page.getByRole('button', { name: 'More details' }).click();
  await page.getByLabel('Minimum').fill('1,2,3');
  await page.getByLabel('Maximum').fill('4,5,6');
  await page.getByLabel('Date applied').fill('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Enter the date you applied.')).toBeVisible();
  await expectNoHorizontalScroll(page);
  // Back, then confirm discarding what was typed.
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard' }).click();
  await sheetsClosed(page);

  // A row with very long values.
  await page.getByRole('button', { name: 'Add application' }).click();
  await page.getByLabel('Job posting URL').fill(`https://example.com/${'a'.repeat(300)}`);
  await page.getByLabel('Company').fill(`Company${'X'.repeat(120)}`);
  await page.getByRole('button', { name: 'More details' }).click();
  await page.getByLabel(/Location/).fill(`Somewhere${'Y'.repeat(150)}`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Applications' })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('discarding asks in a dialog centered over the sheet, toasts staying usable', async ({
  session,
}) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(session.extensionId));
  await addJob(page, 'https://acme.com/1', 'Acme');
  await sheetsClosed(page);
  // An Undo toast, then a form with something typed in it.
  await page.getByRole('button', { name: /^Acme/ }).click();
  await page.getByRole('button', { name: /^More actions for/ }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Add application', exact: true }).click();
  await page.getByLabel('Company').fill('Beta');

  const question = page.getByRole('alertdialog', { name: 'Discard your changes?' });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(question).toBeVisible();
    const box = (await question.boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - 160)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height / 2 - 320)).toBeLessThanOrEqual(1);
    await expectNoHorizontalScroll(page);
    // Focus starts on Keep editing, and Tab moves within the question, never into the sheet.
    await expect(question.getByRole('button', { name: 'Keep editing' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(question.getByRole('button', { name: 'Discard' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(question.getByRole('button', { name: 'Keep editing' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(question).toBeHidden();
    await expect(page.getByRole('button', { name: 'Back' })).toBeFocused();
  }
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));

  await page.getByRole('button', { name: 'Back' }).click();
  // A click on the dimmed area around it does nothing: the question needs an answer.
  await page.mouse.click(10, 10);
  await expect(question).toBeVisible();
  // The toast is drawn above the dimmed layer, and its Undo takes a click.
  const undo = page.getByRole('button', { name: 'Undo' });
  const center = await undo.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  expect(
    await undo.evaluate(
      (element, { x, y }) => element.contains(document.elementFromPoint(x, y)),
      center,
    ),
  ).toBe(true);
  await question.getByRole('button', { name: 'Discard' }).click();
  await sheetsClosed(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Applications' })).toBeVisible();
});
