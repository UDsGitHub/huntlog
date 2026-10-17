import type { Page } from '@playwright/test';
import path from 'node:path';
import { expect, panelUrl, sheetsClosed, test, uploadResume } from '../e2e/fixtures';

// Every screen at 320px, in light and dark, for the owner's design review (milestones.md, after
// M6). Saved to docs/design-review/screenshots/<screen>-<theme>.png.
const OUT = path.resolve(import.meta.dirname, '../docs/design-review/screenshots');
const PDF = Buffer.from('%PDF-1.7\n' + ' '.repeat(200));

const JOBS = [
  { company: 'Acme', title: 'Frontend Engineer', applied: '2026-10-12', status: 'Interviewing' },
  { company: 'Globex', title: 'Software Engineer II', applied: '2026-10-13', status: 'Screening' },
  { company: 'Initech', title: 'Full-stack Developer', applied: '2026-10-14' },
  {
    company: 'Umbrella Health',
    title: 'React Developer',
    applied: '2026-10-02',
    status: 'Rejected',
  },
  { company: 'Hooli', title: 'Senior Web Engineer', applied: '2026-10-16' },
] as const;

async function shot(page: Page, name: string, theme: string) {
  // Let a slide that a click just started begin, then finish (capped: an animation in a hidden section never runs).
  await page.waitForTimeout(150);
  await page.evaluate(() =>
    Promise.race([
      Promise.allSettled(document.getAnimations().map((a) => a.finished)),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]),
  );
  await page.screenshot({ path: `${OUT}/${name}-${theme}.png` });
}

/** Leaves Settings open: its sheet is the next screenshot. */
async function setTheme(page: Page, theme: 'Light' | 'Dark') {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('dialog', { name: 'Settings' }).locator('label', { hasText: theme }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase());
}

test('design-review screenshots', async ({ session }) => {
  const page = await session.context.newPage();
  // Friday Oct 16 2026, so dates and "this week" are stable.
  await page.clock.setFixedTime(new Date(2026, 9, 16, 15));
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(panelUrl(session.extensionId));

  // Empty states first.
  for (const theme of ['Light', 'Dark'] as const) {
    await setTheme(page, theme);
    await page.keyboard.press('Escape');
    await sheetsClosed(page);
    for (const tab of ['Applications', 'Stats', 'Resumes'] as const) {
      await page.getByRole('tab', { name: tab }).click();
      await shot(page, `empty-${tab.toLowerCase()}`, theme.toLowerCase());
    }
  }

  // Sample data.
  await page.getByRole('tab', { name: 'Resumes' }).click();
  await uploadResume(page, { name: 'Backend v3.pdf', mimeType: 'application/pdf', buffer: PDF });
  await uploadResume(page, { name: 'Frontend 2026.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.getByRole('tab', { name: 'Applications' }).click();
  for (const job of JOBS) {
    await page.getByRole('button', { name: 'Add application', exact: true }).click();
    await page.getByLabel('Company').fill(job.company);
    await page.getByLabel('Job title').fill(job.title);
    await page.getByLabel('Job posting URL').fill(`https://jobs.example.com/${job.company.length}`);
    await page.getByLabel('Date applied').fill(job.applied);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await sheetsClosed(page);
    if ('status' in job) {
      const row = page.getByRole('listitem').filter({ hasText: job.company });
      await row.getByRole('button', { name: /^Status: / }).click();
      await page
        .getByRole('dialog', { name: 'Change status' })
        .getByRole('button', { name: job.status, exact: true })
        .click();
      await sheetsClosed(page);
    }
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('switch', { name: 'Set a weekly goal' }).click();
  await settings.getByLabel('Applications per week').fill('10');
  await settings.getByLabel('Applications per week').press('Enter');
  await page.keyboard.press('Escape');
  await sheetsClosed(page);
  // Let the Undo toasts go, so they don't cover the screens.
  await page.waitForTimeout(6_000);

  for (const theme of ['light', 'dark'] as const) {
    // A fresh panel each pass, so state left by the light pass (scrolled chips, focus) can't
    // differ between the two shots of a screen. The theme is a setting, so it stays.
    await page.reload();
    await setTheme(page, theme === 'light' ? 'Light' : 'Dark');
    // Picking the theme scrolled the sheet: show it from the top.
    await settings.locator('[data-sheet-body]').evaluate((body) => body.scrollTo(0, 0));
    await shot(page, 'settings', theme);
    await settings.getByRole('button', { name: 'Delete all data' }).click();
    await shot(page, 'sheet-delete-all', theme);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Delete all data?' })).toBeHidden();
    await page.keyboard.press('Escape');
    await sheetsClosed(page);

    await shot(page, 'list', theme);
    await page.getByRole('button', { name: /^Filters/ }).click();
    await shot(page, 'sheet-filters', theme);
    await page.keyboard.press('Escape');
    await sheetsClosed(page);
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Initech' })
      .getByRole('button', { name: /^Status: / })
      .click();
    await shot(page, 'sheet-status', theme);
    await page.keyboard.press('Escape');
    await sheetsClosed(page);

    await page.getByRole('button', { name: 'Add application', exact: true }).click();
    await shot(page, 'form-add', theme);
    await page.getByRole('button', { name: 'Back' }).click();
    await sheetsClosed(page);

    await page.getByRole('button', { name: 'Acme, Frontend Engineer' }).click();
    await shot(page, 'detail', theme);
    await page.getByRole('button', { name: 'Back to applications' }).click();

    await page.getByRole('tab', { name: 'Stats' }).click();
    await shot(page, 'stats', theme);
    await page.getByRole('radio', { name: 'Custom…' }).click();
    await shot(page, 'sheet-custom-range', theme);
    await page.keyboard.press('Escape');
    await sheetsClosed(page);

    await page.getByRole('tab', { name: 'Resumes' }).click();
    await shot(page, 'resumes', theme);
    await page.getByRole('button', { name: 'More actions for Backend v3' }).click();
    await shot(page, 'resumes-menu', theme);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Upload resume' }).click();
    await shot(page, 'sheet-upload', theme);
    await page.keyboard.press('Escape');
    await sheetsClosed(page);
  }
});
