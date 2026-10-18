import { expect, expectNoHorizontalScroll, panelUrl, test } from './fixtures';

// M6 slice: set a weekly goal of 10 → the Stats tab shows the goal card at 3 of 10.
// Switch to dark mode.
test('a weekly goal of 10 shows 3 of 10 on Stats, then dark mode', async ({ session }) => {
  const page = await session.context.newPage();
  // Friday Oct 16 2026, so "this week" is stable.
  await page.clock.setFixedTime(new Date(2026, 9, 16, 15));
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(session.extensionId));
  const lightBackground = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );

  for (const company of ['Acme', 'Globex', 'Initech']) {
    await page.getByRole('button', { name: 'Add application', exact: true }).click();
    await page.getByLabel('Job posting URL').fill(`https://${company.toLowerCase()}.com/jobs/1`);
    await page.getByLabel('Company').fill(company);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('listitem').filter({ hasText: company })).toBeVisible();
  }

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('switch', { name: 'Set a weekly goal' }).click();
  await settings.getByLabel('Applications per week').fill('10');
  await settings.getByLabel('Applications per week').press('Enter');
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();

  await page.getByRole('tab', { name: 'Stats' }).click();
  const stats = page.getByRole('tabpanel', { name: 'Stats' });
  const goal = stats.getByRole('region', { name: 'Weekly application goal' });
  await expect(goal).toContainText('3 applications submitted');
  await expect(goal).toHaveAccessibleDescription(
    'Goal: 10 applications · 7 more applications to reach your goal',
  );
  await expect(goal.getByRole('progressbar')).toHaveAttribute(
    'aria-valuetext',
    '3 of 10 applications this week',
  );
  // The goal card leads; the range's Applied joins Interviews and Offers below it.
  const applied = stats.getByRole('definition').first();
  await expect(applied).toHaveText('3');
  const [card, number] = [await goal.boundingBox(), await applied.boundingBox()];
  expect(number!.y).toBeGreaterThan(card!.y + card!.height);
  await expectNoHorizontalScroll(page);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await settings.locator('label', { hasText: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectNoHorizontalScroll(page);
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(settings).toBeHidden();
  await expect(goal.getByRole('progressbar')).toBeVisible();
  // The dark tokens are in use: the page no longer has the light background.
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(
    lightBackground,
  );
  await expectNoHorizontalScroll(page);
});
