import fs from 'node:fs';
import { expect, panelUrl, test, uploadResume } from './fixtures';

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
