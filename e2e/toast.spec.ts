import { expect, panelUrl, sheetsClosed, test } from './fixtures';

// Regression: the toast region had no stacking order, so a row's status chip (z-10) drew over the
// toast's Undo and close buttons when it sat over the list.
test('a toast sits above the rows under it, its buttons reachable', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(session.extensionId));
  for (const n of [1, 2, 3, 4, 5]) {
    await page.getByRole('button', { name: 'Add application', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Add application' });
    await form.getByLabel('Job posting URL').fill(`https://c${n}.com/jobs/1`);
    await form.getByLabel('Company').fill(`Firm ${n}`);
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(form).toBeHidden();
  }
  await page
    .getByRole('button', { name: /^Status: / })
    .first()
    .click();
  await page
    .getByRole('dialog', { name: 'Change status' })
    .getByRole('button', { name: 'Screening' })
    .click();
  // Once the status sheet has gone, the toast is on the page, over the last rows.
  await sheetsClosed(page);
  const toast = page.locator('.toast');
  await expect(toast).toHaveAttribute('data-state', 'open');
  await expect.poll(() => toast.evaluate((el) => el.getAnimations().length)).toBe(0);
  for (const name of ['Undo', 'Dismiss']) {
    const button = page.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    const top = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.textContent ?? null,
      [box.x + box.width / 2, box.y + box.height / 2] as const,
    );
    expect(top).toBe(await button.textContent());
  }
});
