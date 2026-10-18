import type { Page } from '@playwright/test';
import {
  expect,
  expectNoHorizontalScroll,
  panelUrl,
  resumeAction,
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
/** Enough of a DOCX (a zip) to pass the content check. */
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200)]);

async function upload(
  page: Page,
  name: string,
  buffer: Buffer,
  mimeType: string,
  options?: { expectError?: boolean },
) {
  const sheet = await uploadResume(page, { name, mimeType, buffer }, options);
  return { panel: page.getByRole('tabpanel', { name: 'Resumes' }), sheet };
}

/** Drops files on an element as Chrome does from the desktop: a real DataTransfer of Files. */
async function dropFiles(
  page: Page,
  selector: string,
  files: { name: string; bytes: number[]; type: string }[],
) {
  return page.evaluate(
    ({ selector, files }) => {
      const target = document.querySelector(selector)!;
      const dataTransfer = new DataTransfer();
      for (const file of files) {
        dataTransfer.items.add(
          new File([new Uint8Array(file.bytes)], file.name, { type: file.type }),
        );
      }
      const fire = (type: string) => {
        const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      };
      fire('dragenter');
      const accepted = fire('dragover');
      fire('drop');
      return accepted;
    },
    { selector, files },
  );
}

test('upload a PDF and open it in a viewer tab', async ({ session }) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('tab', { name: 'Resumes' }).click();
  const { panel } = await upload(page, 'Backend v3.pdf', PDF, 'application/pdf');
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
  const { panel } = await upload(
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
  const { sheet } = await upload(page, 'cv.pdf', DOCX, 'application/pdf', { expectError: true });
  await expect(sheet.getByText(/doesn't look like a PDF/)).toBeVisible();
});

test('the Resumes tab fits a 320px panel', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('tab', { name: 'Resumes' }).click();
  // The empty state, the sheet with a long file picked, then the list with its menu open.
  await expect(page.getByRole('button', { name: 'Upload your first resume' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  const long = `${'Long'.repeat(40)}.pdf`;
  await page.getByRole('button', { name: 'Upload resume' }).click();
  const sheet = page.getByRole('dialog', { name: 'Upload a resume' });
  await sheet.getByLabel('Resume file').setInputFiles({
    name: long,
    mimeType: 'application/pdf',
    buffer: PDF,
  });
  await expect(sheet.getByText(long)).toBeVisible();
  await expectNoHorizontalScroll(page);
  await sheet.getByRole('button', { name: 'Upload', exact: true }).click();
  await sheetsClosed(page);
  await expect(page.getByRole('list', { name: 'Resumes' })).toBeVisible();
  await page.getByRole('button', { name: `More actions for ${'Long'.repeat(25)}` }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('a file dropped on the zone is picked; one dropped elsewhere is refused', async ({
  session,
}) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('tab', { name: 'Resumes' }).click();
  await page.getByRole('button', { name: 'Upload resume' }).click();
  const sheet = page.getByRole('dialog', { name: 'Upload a resume' });
  const pdf = { name: 'Dropped v1.pdf', bytes: Array.from(PDF), type: 'application/pdf' };

  // Two files at once: refused, saying why.
  expect(await dropFiles(page, '[data-dropzone]', [pdf, pdf])).toBe(true);
  await expect(sheet.getByText('Drop one file at a time.')).toBeVisible();
  await dropFiles(page, '[data-dropzone]', [pdf]);
  await expect(sheet.getByLabel('Name')).toHaveValue('Dropped v1');
  await expect(sheet.getByText('Dropped v1.pdf')).toBeVisible();
  await sheet.getByRole('button', { name: 'Upload', exact: true }).click();
  await sheetsClosed(page);
  await expect(page.getByRole('list', { name: 'Resumes' })).toContainText('Dropped v1');

  // Outside a drop zone the panel refuses the file, rather than letting Chrome open it.
  expect(await dropFiles(page, 'h2', [pdf])).toBe(true);
  await expect(page).toHaveURL(panelUrl(session.extensionId));
});

test('the drop zone opens the picker by click or keyboard, and shows keyboard focus', async ({
  session,
}) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('tab', { name: 'Resumes' }).click();
  await page.getByRole('button', { name: 'Upload resume' }).click();
  const sheet = page.getByRole('dialog', { name: 'Upload a resume' });
  const zone = sheet.locator('[data-dropzone]');

  const [byClick] = await Promise.all([page.waitForEvent('filechooser'), zone.click()]);
  await byClick.setFiles({ name: 'Clicked.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(sheet.getByLabel('Name')).toHaveValue('Clicked');

  // The sheet opened on the (visually hidden) file field: the zone draws its focus ring.
  const fileInput = sheet.getByLabel('Resume file');
  await fileInput.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(fileInput).toBeFocused();
  await expect(zone).not.toHaveCSS('outline-style', 'none');
  const [byKey] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.keyboard.press('Space'),
  ]);
  await byKey.setFiles({ name: 'Keyed.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(sheet.getByLabel('Name')).toHaveValue('Keyed');
});

test('rename in a sheet, archive into the accordion, search', async ({ session }) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('tab', { name: 'Resumes' }).click();
  await upload(page, 'cv-2026.pdf', PDF, 'application/pdf');
  await upload(page, 'other.pdf', PDF, 'application/pdf');

  await resumeAction(page, 'cv-2026', 'Rename');
  const rename = page.getByRole('dialog', { name: 'Rename resume' });
  await rename.getByLabel('Name', { exact: true }).fill('Backend v3');
  await rename.getByLabel('Name', { exact: true }).press('Enter');
  await sheetsClosed(page);
  await expect(page.getByRole('button', { name: 'More actions for Backend v3' })).toBeFocused();

  await resumeAction(page, 'other', 'Archive');
  const toggle = page.getByRole('button', { name: /Archived \(1\)/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(page.getByRole('list', { name: 'Archived resumes' })).toContainText('other');

  // Search covers the file name too.
  await page.getByRole('searchbox', { name: 'Search resumes' }).fill('2026');
  await expect(page.getByRole('list', { name: 'Resumes', exact: true })).toContainText(
    'Backend v3',
  );
  await expect(toggle).toBeHidden();
});

test('after the first upload, or a rename out of the search, focus stays in the tab', async ({
  session,
}) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('tab', { name: 'Resumes' }).click();
  await page.getByRole('button', { name: 'Upload your first resume' }).click();
  const sheet = page.getByRole('dialog', { name: 'Upload a resume' });
  await sheet
    .getByLabel('Resume file')
    .setInputFiles({ name: 'cv.pdf', mimeType: 'application/pdf', buffer: PDF });
  await sheet.getByLabel('Name', { exact: true }).fill('Backend v3');
  await sheet.getByRole('button', { name: 'Upload', exact: true }).click();
  await sheetsClosed(page);
  const heading = page.getByRole('heading', { name: 'Resumes' });
  await expect(heading).toBeFocused();

  // Matches the name only (not the file name), so the rename takes it out of the results.
  await page.getByRole('searchbox', { name: 'Search resumes' }).fill('backend');
  await resumeAction(page, 'Backend v3', 'Rename');
  await page
    .getByRole('dialog', { name: 'Rename resume' })
    .getByLabel('Name', { exact: true })
    .fill('Frontend v1');
  await page.keyboard.press('Enter');
  await sheetsClosed(page);
  await expect(heading).toBeFocused();
});
