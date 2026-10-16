import type { Page } from '@playwright/test';
import { expect, expectNoHorizontalScroll, panelUrl, test } from './fixtures';

/** A tiny but real PDF (Chrome's viewer accepts it). */
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
);
/** Enough of a DOCX (a zip) to pass the content check. */
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200)]);

async function upload(page: Page, name: string, buffer: Buffer, mimeType: string) {
  const panel = page.getByRole('tabpanel', { name: 'Resumes' });
  await panel.getByLabel('Resume file').setInputFiles({ name, mimeType, buffer });
  await panel.getByRole('button', { name: 'Upload' }).click();
  return panel;
}

test('upload a PDF and open it in a viewer tab', async ({ session }) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('tab', { name: 'Resumes' }).click();
  const panel = await upload(page, 'Backend v3.pdf', PDF, 'application/pdf');
  await expect(panel.getByRole('list', { name: 'Resumes' })).toContainText('Backend v3');

  const [viewer] = await Promise.all([
    session.context.waitForEvent('page'),
    panel.getByRole('button', { name: 'Open Backend v3' }).click(),
  ]);
  await expect(viewer).toHaveURL(/\/resume-viewer\.html\?id=/);
  await expect(viewer).toHaveTitle('Backend v3');
  const frame = viewer.locator('iframe');
  await expect(frame).toHaveAttribute('src', /^blob:chrome-extension:/);
  // The blob the viewer shows is the exact file uploaded.
  const shown = await viewer.evaluate(async () => {
    const src = document.querySelector('iframe')!.src;
    return Array.from(new Uint8Array(await (await fetch(src)).arrayBuffer()));
  });
  expect(shown).toEqual(Array.from(PDF));

  // The tab outlives the side panel.
  await page.close();
  await expect(viewer.locator('iframe')).toHaveAttribute('src', /^blob:/);
});

test('a DOCX downloads under its original name', async ({ session }) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('tab', { name: 'Resumes' }).click();
  const panel = await upload(
    page,
    'Backend v3.docx',
    DOCX,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('button', { name: 'Download Backend v3' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('Backend v3.docx');
  // Same bytes as uploaded. Finishing (and deleting) the download also lets the browser close.
  const fs = await import('node:fs');
  expect(fs.readFileSync((await download.path())!).equals(DOCX)).toBe(true);
  await download.delete();
});

test('a file that is not what its name says is refused', async ({ session }) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('tab', { name: 'Resumes' }).click();
  const panel = await upload(page, 'cv.pdf', DOCX, 'application/pdf');
  await expect(panel.getByText(/doesn't look like a PDF/)).toBeVisible();
});

test('the Resumes tab fits a 320px panel', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('tab', { name: 'Resumes' }).click();
  await upload(page, `${'Long'.repeat(40)}.pdf`, PDF, 'application/pdf');
  await expect(page.getByRole('list', { name: 'Resumes' })).toBeVisible();
  await expectNoHorizontalScroll(page);
});
