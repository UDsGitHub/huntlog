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
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('listitem').filter({ hasText: company })).toBeVisible();
  }
  await add('Acme'); // today
  await add('Globex', '2026-10-12');
  await add('Initech', '2026-10-02'); // this month, not this week

  const acme = page.getByRole('listitem').filter({ hasText: 'Acme' });
  await acme.getByRole('button', { name: /^Status: Applied/ }).click();
  await page
    .getByRole('dialog', { name: 'Change status' })
    .getByRole('button', { name: 'Interviewing', exact: true })
    .click();
  await expect(acme.getByRole('button', { name: /^Status: / })).toHaveText('Interviewing');

  await page.getByRole('tab', { name: 'Stats' }).click();
  const stats = page.getByRole('tabpanel', { name: 'Stats' });
  const range = stats.getByRole('radiogroup', { name: 'Range' });
  await expect(range.getByRole('radio', { checked: true })).toHaveText('This week');
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

  await range.getByRole('radio', { name: 'This month' }).click();
  await expect(stats).toContainText('Oct 1, 2026 – Oct 31, 2026');
  await expect(value(/^Applied$/)).toHaveText('3');
  await expect(card(/^Response rate/)).toContainText('1 of 3 heard back');
  await expect(value(/^Response rate/)).toHaveText('33%');
  const outcomes = stats.getByRole('region', { name: 'Where they stand now' });
  await expect(outcomes.getByRole('listitem')).toHaveText(['Applied2', 'Interviewing1']);
  const perDay = stats.getByRole('region', { name: 'Applications per day' });
  await expect(perDay).toContainText('3 applications in this range.');
  // A bar for each day with applications: Oct 2, 12 and 16.
  await expect(perDay.locator('[data-bar]')).toHaveCount(3);
  await expectNoHorizontalScroll(page);

  // At 320px the chips scroll inside their row, never the tab. The keyboard reaches Custom,
  // which scrolls into view clear of the edge.
  const row = await range.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(row.scroll).toBeGreaterThan(row.client);
  // No scrollbar (spec §3): the edge with more chips beyond it fades instead.
  await expect(range).toHaveAttribute('data-fade-end', 'true');
  expect(await range.evaluate((el) => getComputedStyle(el).scrollbarWidth)).toBe('none');
  await range.getByRole('radio', { name: 'This month' }).focus();
  await page.keyboard.press('End');
  const custom = range.getByRole('radio', { name: 'Custom…' });
  await expect(custom).toBeFocused();
  await expect(range).toHaveAttribute('data-fade-start', 'true');
  await expect(range).not.toHaveAttribute('data-fade-end');
  await page.keyboard.press('Home');
  await expect(range).not.toHaveAttribute('data-fade-start');
  await expect(range).toHaveAttribute('data-fade-end', 'true');
  await page.keyboard.press('End');
  const [rowBox, chipBox] = [await range.boundingBox(), await custom.boundingBox()];
  expect(chipBox!.x + chipBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width);
  await expectNoHorizontalScroll(page);

  // Custom: its From/To sheet fits 320px too, and Apply shows that range.
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Custom range' });
  await expect(sheet.getByLabel('From')).toHaveValue('2026-09-17');
  await expect(sheet.getByLabel('From')).toBeFocused();
  await expectNoHorizontalScroll(page);
  await sheet.getByLabel('From').fill('2026-10-10');
  await sheet.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(range.getByRole('radio', { checked: true })).toHaveText('Custom…');
  await expect(stats).toContainText('Oct 10, 2026 – Oct 16, 2026');
  await expect(value(/^Applied$/)).toHaveText('2');
});
