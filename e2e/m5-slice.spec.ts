import { expect, expectNoHorizontalScroll, panelUrl, test } from './fixtures';

// M5 slice: open the Stats tab → see this week's Applied / Interviews / Offers / response rate →
// switch the range to This month.
test("Stats shows this week's numbers, then This month", async ({ session }) => {
  const page = await session.context.newPage();
  // Friday Oct 16 2026 (en-US weeks start Sunday Oct 11), so the dates below are stable.
  await page.clock.setFixedTime(new Date(2026, 9, 16, 15));
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(session.extensionId));

  async function add(company: string, appliedAt?: string) {
    await page.getByRole('button', { name: 'Add application' }).click();
    await page.getByLabel('Job posting URL').fill(`https://${company.toLowerCase()}.com/jobs/1`);
    await page.getByLabel('Company').fill(company);
    if (appliedAt) await page.getByLabel('Date applied').fill(appliedAt);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: company })).toBeVisible();
  }
  await add('Acme'); // today
  await add('Globex', '2026-10-12');
  await add('Initech', '2026-10-02'); // this month, not this week

  const acme = page.getByRole('listitem').filter({ hasText: 'Acme' });
  await acme.getByRole('button', { name: /^Status: Applied/ }).click();
  await page.getByRole('menuitemradio', { name: 'Interviewing' }).click();
  await expect(acme.getByRole('button', { name: /^Status: / })).toHaveText('Interviewing');

  await page.getByRole('tab', { name: 'Stats' }).click();
  const stats = page.getByRole('tabpanel', { name: 'Stats' });
  await expect(stats.getByLabel('Range')).toHaveValue('this-week');
  const numbers = stats.getByRole('definition');
  // A card: the innermost element holding both its term and its number.
  const card = (label: RegExp) =>
    stats.locator('div', { has: page.getByRole('term').filter({ hasText: label }) }).last();
  const value = (label: RegExp) => card(label).getByRole('definition');
  await expect(value(/^Applied$/)).toHaveText('2');
  await expect(value(/^Interviews$/)).toHaveText('1');
  await expect(value(/^Offers$/)).toHaveText('0');
  await expect(value(/^Response rate/)).toHaveText('50%');
  await expect(card(/^Response rate/)).toContainText('1 of 2 heard back');
  await expect(numbers).toHaveCount(5);
  await expectNoHorizontalScroll(page);

  await stats.getByLabel('Range').selectOption({ label: 'This month' });
  await expect(stats).toContainText('Oct 1, 2026 – Oct 31, 2026');
  await expect(value(/^Applied$/)).toHaveText('3');
  await expect(card(/^Response rate/)).toContainText('1 of 3 heard back');
  await expect(value(/^Response rate/)).toHaveText('33%');
  const outcomes = stats.getByRole('region', { name: 'Where they stand now' });
  await expect(outcomes.getByRole('listitem')).toHaveText(['Applied2', 'Interviewing1']);
  const perDay = stats.getByRole('region', { name: 'Applications per day' });
  await expect(perDay).toContainText('3 applications in this range.');
  // A bar for each day with applications: Oct 2, 12 and 16.
  await expect(perDay.locator('rect')).toHaveCount(3);
  await expectNoHorizontalScroll(page);

  // Custom: the From/To pair fits 320px too.
  await stats.getByLabel('Range').selectOption({ label: 'Custom' });
  await expect(stats.getByLabel('From')).toHaveValue('2026-09-17');
  await expectNoHorizontalScroll(page);
});
