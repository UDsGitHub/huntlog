import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  addApplication,
  animationsSettled,
  chooseOption,
  expect,
  panelUrl,
  pickStatus,
  resumeAction,
  sheetsClosed,
  test,
  uploadResume,
} from './fixtures';

// Spec §10: every screen and sheet passes axe's WCAG 2.2 A/AA rules at 320px, in light and dark,
// and so do the extension's other pages (resume viewer, notices, privacy). The one exception is
// the owner's: the destructive button's shadcn tint (v0.7.1), under 4.5:1.

const PDF = Buffer.from('%PDF-1.7\n' + ' '.repeat(200));
const CSV = [
  'Company,Job title,URL,Status,Date applied',
  'Stark Industries,Frontend Engineer,https://stark.example/jobs/7,Applied,2026-10-15',
  'Acme,Frontend Engineer,https://jobs.example.com/4,Interviewing,2026-10-12',
  ',Designer,https://nocompany.example/1,Applied,2026-10-10',
].join('\r\n');

/** Runs axe on what's on screen; collects violations by screen rather than stopping at one. */
async function audit(page: Page, screen: string, found: string[]) {
  await animationsSettled(page);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
    .analyze();
  for (const violation of violations) {
    const nodes = violation.nodes.filter(
      (node) =>
        // The owner's exception: the tinted destructive button.
        !(violation.id === 'color-contrast' && node.html.includes('btn-destructive')),
    );
    for (const node of nodes) {
      found.push(`${screen}: ${violation.id} (${violation.impact}) ${node.target.join(' ')}
    ${node.html.slice(0, 200)}
    ${node.failureSummary?.split('\n').join('\n    ')}`);
    }
  }
}

async function setTheme(page: Page, theme: 'Light' | 'Dark') {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('dialog', { name: 'Settings' }).locator('label', { hasText: theme }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase());
  await page.keyboard.press('Escape');
  await sheetsClosed(page);
}

test('every screen and sheet passes axe in both themes', async ({ session }) => {
  test.setTimeout(240_000);
  const page = await session.context.newPage();
  await page.clock.setFixedTime(new Date(2026, 9, 16, 15));
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(panelUrl(session.extensionId));
  const found: string[] = [];

  for (const theme of ['Light', 'Dark'] as const) {
    await setTheme(page, theme);
    for (const tab of ['Applications', 'Stats', 'Resumes'] as const) {
      await page.getByRole('tab', { name: tab }).click();
      await audit(page, `${theme} empty ${tab}`, found);
    }
  }

  // Sample data: two resumes, three jobs, a weekly goal.
  await page.getByRole('tab', { name: 'Resumes' }).click();
  await uploadResume(page, { name: 'Backend v3.pdf', mimeType: 'application/pdf', buffer: PDF });
  await uploadResume(page, { name: 'Frontend.pdf', mimeType: 'application/pdf', buffer: PDF });
  await resumeAction(page, 'Frontend', 'Archive');
  await page.getByRole('tab', { name: 'Applications' }).click();
  for (const [company, title, applied] of [
    ['Acme', 'Frontend Engineer', '2026-10-12'],
    ['Globex', 'Software Engineer II', '2026-10-13'],
    ['Initech', 'Full-stack Developer', '2026-10-14'],
  ] as const) {
    await addApplication(page, {
      company,
      title,
      url: `https://jobs.example.com/${company}`,
      applied,
    });
  }
  // Saved, with no Date applied, so a move to Interviewing asks for one.
  await page.getByRole('button', { name: 'Add application', exact: true }).click();
  await page.getByLabel('Company').fill('Hooli');
  await page.getByLabel('Job posting URL').fill('https://jobs.example.com/hooli');
  await chooseOption(page.getByRole('dialog'), 'Status', 'Saved');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await sheetsClosed(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('switch', { name: 'Set a weekly goal' }).click();
  await settings.getByLabel('Applications per week').fill('10');
  await settings.getByLabel('Applications per week').press('Enter');
  await page.keyboard.press('Escape');
  await sheetsClosed(page);
  // A backup to import, for the Replace confirmation.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    settings.getByRole('button', { name: 'Export backup' }).click(),
  ]);
  const backup = await download.path();
  await page.keyboard.press('Escape');
  await sheetsClosed(page);
  // The Undo toasts have gone, so they don't sit over every screen.
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0, { timeout: 10_000 });

  for (const theme of ['Light', 'Dark'] as const) {
    await page.reload();
    await setTheme(page, theme);
    const at = (screen: string) => audit(page, `${theme} ${screen}`, found);

    // Applications.
    await at('list');
    await page.getByRole('button', { name: /^Filters/ }).click();
    await at('filter sheet');
    await page.keyboard.press('Escape');
    await sheetsClosed(page);
    const initech = page.getByRole('listitem').filter({ hasText: 'Initech' });
    await initech.getByRole('button', { name: /^Status: / }).click();
    await at('status sheet');
    await page.keyboard.press('Escape');
    await sheetsClosed(page);
    await pickStatus(page, 'Hooli', 'Interviewing');
    await expect(page.getByRole('dialog', { name: 'When did you apply?' })).toBeVisible();
    await at('date applied step');
    await page.getByRole('button', { name: 'Choose another status' }).click();
    await page.keyboard.press('Escape');
    await sheetsClosed(page);
    await page.getByRole('button', { name: 'Add application', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Add application' });
    await form.getByRole('combobox', { name: 'Status' }).click();
    await expect(page.getByRole('listbox')).toBeVisible();
    await at('form with a Select open');
    await page.keyboard.press('Escape');
    await form.getByRole('combobox', { name: 'Resume' }).click();
    await expect(page.getByRole('listbox')).toBeVisible();
    await at('form with the resume list open');
    await page.keyboard.press('Escape');
    await form.getByRole('button', { name: 'Upload new resume' }).click();
    await at('form with the inline upload');
    await form.getByRole('button', { name: 'Close resume upload' }).click();
    await form.getByRole('button', { name: /^More details/ }).click();
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await at('add form with errors');
    await form.getByLabel('Company').fill('Typed');
    await form.getByRole('button', { name: 'Back', exact: true }).click();
    await at('discard question');
    await page.getByRole('button', { name: 'Discard' }).click();
    await sheetsClosed(page);
    await page.getByRole('button', { name: 'Acme, Frontend Engineer' }).click();
    await at('detail');
    await page
      .getByRole('button', { name: /^Change the date for/ })
      .first()
      .click();
    await at('timeline date editor');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'More actions for Acme' }).click();
    await at('detail menu');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await at('edit form');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await sheetsClosed(page);
    await page.getByRole('button', { name: 'Back to applications' }).click();

    // Stats.
    await page.getByRole('tab', { name: 'Stats' }).click();
    await at('stats');
    await page.getByRole('radio', { name: 'Custom…' }).click();
    await at('custom range sheet');
    await page.keyboard.press('Escape');
    await sheetsClosed(page);

    // Resumes.
    await page.getByRole('tab', { name: 'Resumes' }).click();
    await page.getByRole('button', { name: /^Archived/ }).click();
    await at('resumes');
    await page.getByRole('button', { name: 'More actions for Backend v3' }).click();
    await at('resume menu');
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await at('rename sheet');
    await page.keyboard.press('Escape');
    await sheetsClosed(page);
    await page.getByRole('button', { name: 'Upload resume' }).click();
    await at('upload sheet');
    await page.keyboard.press('Escape');
    await sheetsClosed(page);

    // Settings and its sheets.
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await at('settings');
    await settings.getByRole('button', { name: 'Delete all data' }).click();
    await at('delete all sheet');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Delete all data?' })).toBeHidden();
    await settings.getByRole('button', { name: 'Reset settings' }).click();
    await at('reset settings sheet');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Reset settings?' })).toBeHidden();
    await settings.getByRole('button', { name: 'Import' }).click();
    const importing = page.getByRole('dialog', { name: 'Import' });
    await at('import sheet');
    await importing.getByLabel('File to import').setInputFiles({
      name: 'applications.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(CSV),
    });
    await expect(importing.getByText(/ready to import/)).toBeVisible();
    await at('import CSV preview');
    await importing.getByLabel('File to import').setInputFiles(backup);
    await importing.locator('label', { hasText: 'Replace all' }).click();
    await at('import backup preview');
    await importing.getByRole('button', { name: 'Replace all data…' }).click();
    await at('replace confirmation');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Replace all data?' })).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(importing).toBeHidden();
    await page.keyboard.press('Escape');
    await sheetsClosed(page);
    await page.getByRole('tab', { name: 'Applications' }).click();
    // A status change's Undo toast (a different status each pass: the current one is marked).
    await pickStatus(page, 'Globex', theme === 'Light' ? 'Screening' : 'Interviewing');
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await at('toast');
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0, { timeout: 10_000 });

    // The extension's other pages follow the theme setting.
    const [viewer] = await Promise.all([
      session.context.waitForEvent('page'),
      page
        .getByRole('tab', { name: 'Resumes' })
        .click()
        .then(() => page.getByRole('button', { name: 'Open Backend v3' }).click()),
    ]);
    await expect(viewer.locator('iframe')).toBeVisible();
    await audit(viewer, `${theme} resume viewer`, found);
    await viewer.close();
    await page.getByRole('tab', { name: 'Applications' }).click();
    for (const name of ['notices', 'privacy']) {
      const other = await session.context.newPage();
      await other.setViewportSize({ width: 320, height: 720 });
      await other.goto(`chrome-extension://${session.extensionId}/${name}.html`);
      await expect(other.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase());
      await audit(other, `${theme} ${name} page`, found);
      await other.close();
    }
  }

  expect(found, found.join('\n\n')).toEqual([]);
});
