import { expect, expectNoHorizontalScroll, panelUrl, scrollPanel, test } from './fixtures';

// Spec §3, §4.2: a floating + Add on the Applications list, an empty state with a full-size
// button, and toasts that sit above the floating button and slide out.
test('the floating Add button, the empty state and toasts above it', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(session.extensionId));

  await expect(page.getByText('No applications yet.')).toBeVisible();
  const fab = page.getByRole('button', { name: 'Add application', exact: true });
  await expect(fab).toBeVisible();
  const fabBox = (await fab.boundingBox())!;
  // Bottom right, inside the panel.
  expect(fabBox.x + fabBox.width).toBeLessThanOrEqual(320);
  expect(fabBox.y + fabBox.height).toBeLessThanOrEqual(640);
  expect(fabBox.x).toBeGreaterThan(160);
  await expectNoHorizontalScroll(page);

  await page.getByRole('button', { name: 'Add your first application' }).click();
  await expect(page.getByRole('form', { name: 'Add application' })).toBeVisible();
  // The form's sheet covers the floating button (it stays behind, for focus to return to).
  await expect(page.getByRole('dialog', { name: 'Add application' })).toBeVisible();
  const covered = await fab.evaluate((button) => {
    const box = button.getBoundingClientRect();
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return !!top?.closest('dialog');
  });
  expect(covered).toBe(true);
  await page.getByLabel('Job posting URL').fill('https://acme.com/jobs/1');
  await page.getByLabel('Company').fill('Acme');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  const row = page.getByRole('listitem').filter({ hasText: 'Acme' });
  await row.getByRole('button', { name: /^Status: / }).click();
  await page
    .getByRole('dialog', { name: 'Change status' })
    .getByRole('button', { name: 'Screening', exact: true })
    .click();
  const toast = page.locator('.toast', { hasText: 'Moved Acme to Screening.' });
  await expect(toast).toBeVisible();
  // Raised as the status sheet closes, it shows in the sheet, then moves to the page.
  await expect(page.getByRole('dialog', { name: 'Change status' })).toBeHidden();
  await expect(toast).toBeVisible();
  const toastBox = (await toast.boundingBox())!;
  expect(toastBox.y + toastBox.height).toBeLessThanOrEqual((await fab.boundingBox())!.y);

  // Other tabs have no floating button, and the toast drops back to the bottom.
  await page.getByRole('tab', { name: 'Stats' }).click();
  await expect(fab).toBeHidden();
  await expect.poll(async () => (await toast.boundingBox())!.y).toBeGreaterThan(toastBox.y);
  await page.getByRole('tab', { name: 'Applications' }).click();

  // Dismissed: slides out, then it's gone.
  await toast.getByRole('button', { name: 'Dismiss' }).click();
  await expect(toast).toBeHidden();
  await expect(page.locator('.toast')).toHaveCount(0);
});

test('the last row stays reachable above the floating button', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto(panelUrl(session.extensionId));
  for (const company of ['One', 'Two', 'Three', 'Four', 'Five', 'Six']) {
    await page.getByRole('button', { name: 'Add application', exact: true }).click();
    await page.getByLabel('Job posting URL').fill(`https://${company.toLowerCase()}.com/1`);
    await page.getByLabel('Company').fill(company);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('listitem').filter({ hasText: company })).toBeVisible();
  }
  await scrollPanel(page, 'end');
  // Newest first, so "One" is last.
  const lastLink = page
    .getByRole('listitem')
    .filter({ hasText: 'One' })
    .getByRole('link', { name: /posting/i });
  const link = (await lastLink.boundingBox())!;
  const fab = (await page
    .getByRole('button', { name: 'Add application', exact: true })
    .boundingBox())!;
  expect(link.y + link.height).toBeLessThanOrEqual(fab.y);
});
