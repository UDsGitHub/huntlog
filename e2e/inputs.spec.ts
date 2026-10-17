import { chooseOption, expect, expectNoHorizontalScroll, panelUrl, test } from './fixtures';

test('selects open toward the room they have, and work by keyboard (spec §3)', async ({
  session,
}) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('button', { name: 'Add application', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add application' });

  // Status, near the top: opens down, on the current choice; the keyboard picks.
  const status = sheet.getByRole('combobox', { name: 'Status', exact: true });
  await status.focus();
  await page.keyboard.press('ArrowDown');
  const statuses = sheet.getByRole('listbox', { name: 'Statuses' });
  await expect(statuses).toHaveAttribute('data-direction', 'down');
  await expect(statuses.getByRole('option', { selected: true })).toHaveText('Applied');
  await expectNoHorizontalScroll(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(status).toHaveText('Screening');
  await expect(status).toBeFocused();
  // Escape with the list open closes only the list.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(statuses).toHaveCount(0);
  await expect(sheet).toBeVisible();

  // Currency, low in the form: opens up, so its options are in view, and searches by name.
  await sheet.getByRole('button', { name: /More details/ }).click();
  const currency = sheet.getByLabel('Currency');
  await currency.scrollIntoViewIfNeeded();
  await currency.fill('yen');
  const currencies = sheet.getByRole('listbox', { name: 'Currencies' });
  await expect(currencies).toHaveAttribute('data-direction', 'up');
  await expect(currencies.getByRole('option', { name: 'JPY · Japanese Yen' })).toBeInViewport();
  await currencies.getByRole('option', { name: 'JPY · Japanese Yen' }).click();
  await expect(currency).toHaveValue('JPY · Japanese Yen');

  await chooseOption(sheet, 'Per', 'Hour');
  await expect(sheet.getByRole('combobox', { name: 'Per' })).toHaveText('Hour');
});

test('number fields keep only numbers, and group an amount once left', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('button', { name: 'Add application', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add application' });
  await sheet.getByRole('button', { name: /More details/ }).click();
  const minimum = sheet.getByLabel('Minimum');
  await minimum.pressSequentially('$85000/yr');
  await expect(minimum).toHaveValue('85000');
  await minimum.press('Tab');
  await expect(minimum).toHaveValue('85,000');
  await expect(minimum).toHaveAttribute('inputmode', 'decimal');
  // A dropped character leaves the caret where it was, so the next digit lands there.
  await minimum.focus();
  await minimum.evaluate((el: HTMLInputElement) => el.setSelectionRange(2, 2));
  await page.keyboard.press('x');
  expect(await minimum.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(2);
  await page.keyboard.press('1');
  await expect(minimum).toHaveValue('851,000');

  // The weekly goal: digits only, with − and + kept within 1 to 200.
  await sheet.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Discard' }).click();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('switch', { name: 'Set a weekly goal' }).click();
  const goal = page.getByLabel('Applications per week');
  await expect(goal).toHaveValue('5');
  await page.getByRole('button', { name: 'Increase weekly goal' }).click();
  await expect(goal).toHaveValue('6');
  await goal.fill('');
  await goal.pressSequentially('1e1');
  await expect(goal).toHaveValue('11');
  await expectNoHorizontalScroll(page);
});

test('the resume + opens the inline upload and turns into a − that closes it', async ({
  session,
}) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('button', { name: 'Add application', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add application' });
  const toggle = sheet.getByRole('button', { name: 'Upload new resume' });
  await toggle.click();
  const group = sheet.getByRole('group', { name: 'Upload a new resume' });
  await expect(group.getByRole('button', { name: 'Upload', exact: true })).toBeVisible();
  await expect(group.getByRole('button', { name: /Cancel/ })).toHaveCount(0);
  const close = sheet.getByRole('button', { name: 'Close resume upload' });
  await expect(close).toHaveAttribute('aria-expanded', 'true');
  await close.click();
  await expect(group).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});
