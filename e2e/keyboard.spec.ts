import type { Locator, Page } from '@playwright/test';
import { expect, panelUrl, test } from './fixtures';

// Spec §10: the main flows work by keyboard alone, and focus returns where the user came from.
// Nothing here clicks: focus moves only by Tab, arrows, Enter, Space and Escape.

/** Presses Tab until `target` has focus, the way a keyboard user would get there. */
async function tabTo(page: Page, target: Locator, { backwards = false, max = 40 } = {}) {
  // The target must exist (a wrong locator fails here, plainly), but may not be reachable yet.
  await expect(target).toHaveCount(1);
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
  }
  const focused = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 150));
  throw new Error(`Tab never reached ${target}; focus is on ${focused}`);
}

test('add, open, change status, filter, switch tabs and open Settings by keyboard', async ({
  session,
}) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(panelUrl(session.extensionId));
  await expect(page.getByRole('button', { name: 'Add your first application' })).toBeVisible();

  // Add an application: the form opens on Company, and ⌘/Ctrl+Enter saves.
  await tabTo(page, page.getByRole('button', { name: 'Add your first application' }));
  await page.keyboard.press('Enter');
  const form = page.getByRole('dialog', { name: 'Add application' });
  await expect(form.getByLabel('Company')).toBeFocused();
  await page.keyboard.type('Acme');
  await page.keyboard.press('Tab');
  await expect(form.getByLabel('Job title')).toBeFocused();
  await page.keyboard.type('Frontend Engineer');
  await page.keyboard.press('Tab');
  await expect(form.getByLabel('Job posting URL')).toBeFocused();
  await page.keyboard.type('https://acme.example/jobs/1');
  await page.keyboard.press('Control+Enter');
  await expect(form).toBeHidden();
  // The empty state's button has gone with the empty list: focus goes to + Add.
  await expect(page.getByRole('button', { name: 'Add application', exact: true })).toBeFocused();

  // Open it, and come back with Escape: focus returns to its row.
  const row = page.getByRole('button', { name: 'Acme, Frontend Engineer' });
  await tabTo(page, row, { backwards: true });
  await page.keyboard.press('Enter');
  // The page opens on its heading, so a screen reader starts at the company.
  await expect(page.getByRole('heading', { name: 'Acme' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(row).toBeFocused();

  // Change its status from the chip: ArrowDown opens the sheet on the current status, arrows
  // move, Enter picks, and focus comes back to the chip.
  await page.keyboard.press('Tab');
  const chip = page.getByRole('button', { name: /^Status: Applied/ });
  await expect(chip).toBeFocused();
  await page.keyboard.press('ArrowDown');
  const statuses = page.getByRole('dialog', { name: 'Change status' });
  await expect(statuses.getByRole('button', { name: 'Applied (current)' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(statuses.getByRole('button', { name: 'Screening' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(statuses).toBeHidden();
  const screening = page.getByRole('button', { name: /^Status: Screening/ });
  await expect(screening).toBeFocused();

  // Filter by a status: Space toggles a chip, ⌘/Ctrl+Enter applies, focus returns to Filters.
  const filters = page.getByRole('button', { name: /^Filters/ });
  await tabTo(page, filters, { backwards: true });
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Filter and sort' });
  const interviewing = sheet.getByRole('button', { name: 'Interviewing', exact: true });
  await tabTo(page, interviewing);
  await page.keyboard.press('Space');
  await expect(interviewing).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+Enter');
  await expect(sheet).toBeHidden();
  await expect(filters).toBeFocused();
  await expect(page.getByText('No applications match.')).toBeVisible();
  await tabTo(page, page.getByRole('button', { name: 'Clear search and filters' }));
  await page.keyboard.press('Enter');
  await expect(row).toBeVisible();

  // Tabs: arrow keys move between them and show each one.
  const applications = page.getByRole('tab', { name: 'Applications' });
  await tabTo(page, applications, { backwards: true });
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Stats' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Stats' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Resumes' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(applications).toHaveAttribute('aria-selected', 'true');

  // Settings opens over the tab and Escape returns focus to the gear.
  const gear = page.getByRole('button', { name: 'Settings', exact: true });
  await tabTo(page, gear, { backwards: true });
  await page.keyboard.press('Enter');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(gear).toBeFocused();
});
