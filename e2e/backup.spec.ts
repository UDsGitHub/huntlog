import fs from 'node:fs';
import {
  expect,
  expectNoHorizontalScroll,
  panelUrl,
  sheetsClosed,
  test,
  uploadResume,
} from './fixtures';

/** A tiny but real PDF (Chrome's viewer accepts it). */
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
);

test('Export backup downloads every application and resume file', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('tab', { name: 'Resumes' }).click();
  await uploadResume(page, { name: 'Backend v3.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.getByRole('tab', { name: 'Applications' }).click();
  await page.getByRole('button', { name: 'Add application', exact: true }).click();
  await page.getByLabel('Job posting URL').fill('https://acme.com/jobs/1');
  await page.getByLabel('Company').fill('Acme');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Acme' })).toBeVisible();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const data = page
    .getByRole('dialog', { name: 'Settings' })
    .getByRole('region', { name: 'Your data' });
  await expect(data.getByText('Last backup: never')).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    data.getByRole('button', { name: 'Export backup' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^huntlog-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const backup = JSON.parse(fs.readFileSync((await download.path())!, 'utf8'));
  await download.delete();
  expect(backup.format).toBe('huntlog-backup');
  expect(backup.applications.map((app: { company: string }) => app.company)).toEqual(['Acme']);
  expect(backup.resumes).toHaveLength(1);
  expect(Buffer.from(backup.resumes[0].file, 'base64').equals(PDF)).toBe(true);
  await expect(data.getByText('Last backup: today')).toBeVisible();
});

// M7 slice: export a JSON backup → "Delete all data" → import with Replace → everything is back,
// including resume files that open.
test('a backup restores everything after Delete all data, resume files included', async ({
  session,
}) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('tab', { name: 'Resumes' }).click();
  await uploadResume(page, { name: 'Backend v3.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.getByRole('tab', { name: 'Applications' }).click();
  for (const company of ['Acme', 'Globex']) {
    await page.getByRole('button', { name: 'Add application', exact: true }).click();
    await page.getByLabel('Job posting URL').fill(`https://${company.toLowerCase()}.com/jobs/1`);
    await page.getByLabel('Company').fill(company);
    const resume = page.getByRole('combobox', { name: /^Resume/ });
    if ((await resume.inputValue()) !== 'Backend v3') {
      await resume.fill('backend');
      await resume.press('Enter');
    }
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('listitem').filter({ hasText: company })).toBeVisible();
  }

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.locator('label', { hasText: 'Dark' }).click();
  const data = settings.getByRole('region', { name: 'Your data' });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    data.getByRole('button', { name: 'Export backup' }).click(),
  ]);
  const backupPath = (await download.path())!;
  const backup = fs.readFileSync(backupPath);

  await data.getByRole('button', { name: 'Delete all data' }).click();
  const deleting = page.getByRole('dialog', { name: 'Delete all data?' });
  await deleting.getByLabel('Type DELETE to confirm').fill('DELETE');
  await deleting.getByRole('button', { name: 'Delete all data' }).click();
  await expect(deleting).toBeHidden();
  await settings.locator('label', { hasText: 'Light' }).click();

  await data.getByRole('button', { name: 'Import…' }).click();
  const importing = page.getByRole('dialog', { name: 'Import' });
  await importing.getByLabel('Backup file').setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'application/json',
    buffer: backup,
  });
  await expect(importing.getByText(/2 applications and 1 resume\./)).toBeVisible();
  await importing.locator('label', { hasText: 'Replace all' }).click();
  await expectNoHorizontalScroll(page);
  await importing.getByRole('button', { name: 'Replace all data…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Replace all data?' });
  await expect(confirm).toContainText(
    'This replaces your 0 applications and 0 resumes with the 2 applications and 1 resume in this backup',
  );
  await confirm.getByRole('button', { name: 'Replace all data' }).click();
  await expect(importing).toBeHidden();
  await expect(page.getByText('Backup restored: 2 applications and 1 resume.')).toBeVisible();
  await download.delete();
  // The theme came back with the settings.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Escape');
  await sheetsClosed(page);

  for (const company of ['Acme', 'Globex']) {
    await expect(page.getByRole('listitem').filter({ hasText: company })).toBeVisible();
  }
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Acme' })
    .getByRole('button', { name: /^Acme/ })
    .click();
  const [viewer] = await Promise.all([
    session.context.waitForEvent('page'),
    page.getByRole('button', { name: 'Open resume Backend v3' }).click(),
  ]);
  await expect(viewer).toHaveURL(/\/resume-viewer\.html\?id=/);
  const shown = await viewer.evaluate(async () => {
    const src = document.querySelector('iframe')!.src;
    return Array.from(new Uint8Array(await (await fetch(src)).arrayBuffer()));
  });
  expect(shown).toEqual(Array.from(PDF));
});
