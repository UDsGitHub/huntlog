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
    await page.getByRole('button', { name: 'Save' }).click();
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

  // Hidden while a form is open, so the sticky Save bar owns the panel.
  await page.getByRole('button', { name: 'Add application', exact: true }).click();
  await expect(page.getByRole('tablist')).toHaveCount(0);
});
