import { expect, expectNoHorizontalScroll, panelUrl, test } from './fixtures';

test('the tab bar switches sections, by mouse and keyboard, and fits 320px', async ({
  session,
}) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(session.extensionId));

  await page.getByRole('tab', { name: 'Resumes' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Resumes' })).toContainText('No resumes yet.');
  // With real CSS, the hidden panel must not render (its flex classes mustn't beat [hidden]).
  await expect(page.getByText(/No applications yet/)).toBeHidden();
  await expect(page.getByRole('button', { name: '+ Add application' })).toBeHidden();
  await expectNoHorizontalScroll(page);

  // Tab from the tab bar reaches the Resumes panel, skipping the hidden Applications panel.
  await page.getByRole('tab', { name: 'Resumes' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tabpanel', { name: 'Resumes' })).toBeFocused();

  await page.getByRole('tab', { name: 'Resumes' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Applications' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Applications' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText(/No applications yet/)).toBeVisible();

  // Hidden while a form is open, so the sticky Save bar owns the panel.
  await page.getByRole('button', { name: '+ Add application' }).click();
  await expect(page.getByRole('tablist')).toHaveCount(0);
});
