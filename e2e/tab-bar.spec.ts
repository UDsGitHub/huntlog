import {
  activePanel,
  expect,
  expectNoHorizontalScroll,
  panelUrl,
  scrollPanel,
  test,
} from './fixtures';

test('the tab bar switches sections, by mouse and keyboard, and fits 320px', async ({
  session,
}) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(session.extensionId));

  // Every label fits its tab at 320px beside its icon, on one row, none cut off.
  for (const name of ['Applications', 'Stats', 'Resumes']) {
    const tab = page.getByRole('tab', { name });
    const label = tab.locator('span').last();
    // Fractional widths: scrollWidth rounds, hiding a label cut off by a fraction of a pixel.
    const room = await label.evaluate((e) => {
      const text = document.createRange();
      text.selectNodeContents(e);
      return e.getBoundingClientRect().width - text.getBoundingClientRect().width;
    });
    expect(room, name).toBeGreaterThanOrEqual(0);
    const [icon, text] = [await tab.locator('svg').boundingBox(), await label.boundingBox()];
    expect(icon!.x + icon!.width, name).toBeLessThanOrEqual(text!.x);
    expect(Math.abs(icon!.y + icon!.height / 2 - (text!.y + text!.height / 2)), name).toBeLessThan(
      2,
    );
  }
  // Settings is the gear in the title row, not a tab.
  await expect(page.getByRole('tab')).toHaveCount(3);
  const title = await page.getByRole('heading', { level: 1 }).boundingBox();
  const gear = await page.getByRole('button', { name: 'Settings', exact: true }).boundingBox();
  expect(Math.abs(gear!.y + gear!.height / 2 - (title!.y + title!.height / 2))).toBeLessThan(2);
  expect(gear!.x + gear!.width).toBeGreaterThan(300);

  await page.getByRole('tab', { name: 'Resumes' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Resumes' })).toContainText('No resumes yet.');
  // With real CSS, the section that slid out ends up out of sight.
  await expect(page.getByText(/No applications yet/)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Add application' })).toBeHidden();
  await expectNoHorizontalScroll(page);

  // Tab from the tab bar reaches the Resumes panel, skipping the hidden Applications panel.
  await page.getByRole('tab', { name: 'Resumes' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tabpanel', { name: 'Resumes' })).toBeFocused();

  await page.getByRole('tab', { name: 'Resumes' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Stats' })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Stats' })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Applications' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Applications' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText(/No applications yet/)).toBeVisible();

  // Switching slides: the next section comes in as the last goes out, then settles.
  await page.getByRole('tab', { name: 'Stats' }).click();
  // (Which way it slides is unit-tested; here, only that it settles. The slide itself lasts
  // 250ms, too short to assert on reliably.)
  const stats = page.getByRole('tabpanel', { name: 'Stats' });
  await expect(stats).not.toHaveAttribute('data-slide');
  await expect(page.getByText(/No applications yet/)).toBeHidden();
  await page.getByRole('tab', { name: 'Applications' }).click();
  await expect(page.getByText(/No applications yet/)).toBeVisible();

  // Each section keeps its own scroll position.
  for (const company of ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven']) {
    await page.getByRole('button', { name: 'Add application', exact: true }).click();
    await page.getByLabel('Job posting URL').fill(`https://${company.toLowerCase()}.com/1`);
    await page.getByLabel('Company').fill(company);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('listitem').filter({ hasText: company })).toBeVisible();
  }
  await scrollPanel(page, 'end');
  const scrolled = await activePanel(page).evaluate((element) => element.scrollTop);
  expect(scrolled).toBeGreaterThan(0);
  await page.getByRole('tab', { name: 'Stats' }).click();
  await expect(activePanel(page)).toHaveAttribute('id', /stats/);
  expect(await activePanel(page).evaluate((element) => element.scrollTop)).toBe(0);
  await page.getByRole('tab', { name: 'Applications' }).click();
  await expect(activePanel(page)).toHaveAttribute('id', /applications/);
  expect(await activePanel(page).evaluate((element) => element.scrollTop)).toBe(scrolled);
  await expectNoHorizontalScroll(page);

  // A form opens as a sheet over the panel; the tab bar stays in place behind it.
  await page.getByRole('button', { name: 'Add application', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add application' })).toBeVisible();
  await expect(page.locator('[role="tablist"]')).toHaveCount(1);
});
