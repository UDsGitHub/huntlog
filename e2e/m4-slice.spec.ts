import { expect, expectNoHorizontalScroll, panelUrl, test } from './fixtures';

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
);

// M4 slice: upload "Backend v3.pdf" → pick it on an application → open it later from that
// application.
test('upload a resume, link it to an application, open it from the application', async ({
  session,
}) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));

  await page.getByRole('tab', { name: 'Resumes' }).click();
  const resumes = page.getByRole('tabpanel', { name: 'Resumes' });
  await resumes
    .getByLabel('Resume file')
    .setInputFiles({ name: 'Backend v3.pdf', mimeType: 'application/pdf', buffer: PDF });
  await resumes.getByRole('button', { name: 'Upload' }).click();
  await expect(resumes.getByRole('list', { name: 'Resumes' })).toContainText('Backend v3');

  await page.getByRole('tab', { name: 'Applications' }).click();
  await page.getByRole('button', { name: 'Add application' }).click();
  await page.getByLabel('Job posting URL').fill('https://acme.com/jobs/1');
  await page.getByLabel('Company').fill('Acme');
  // The searchable resume dropdown: type to filter, Enter picks.
  await page.getByRole('combobox', { name: /^Resume/ }).fill('backend');
  await expect(page.getByRole('listbox', { name: 'Resumes' }).getByRole('option')).toHaveText([
    'Backend v3',
  ]);
  await page.getByRole('combobox', { name: /^Resume/ }).press('Enter');
  await expect(page.getByRole('combobox', { name: /^Resume/ })).toHaveValue('Backend v3');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // The row leaves the resume out (spec §4.4); the detail view shows it.
  const row = page.getByRole('listitem').filter({ hasText: 'Acme' });
  await row.getByRole('button', { name: /^Acme/ }).click();

  const [viewer] = await Promise.all([
    session.context.waitForEvent('page'),
    page.getByRole('button', { name: 'Open resume Backend v3' }).click(),
  ]);
  await expect(viewer).toHaveURL(/\/resume-viewer\.html\?id=/);
  await expect(viewer).toHaveTitle('Backend v3');
  const shown = await viewer.evaluate(async () => {
    const src = document.querySelector('iframe')!.src;
    return Array.from(new Uint8Array(await (await fetch(src)).arrayBuffer()));
  });
  expect(shown).toEqual(Array.from(PDF));
});

test('a resume an application uses is archived, not deleted, and still opens', async ({
  session,
}) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('button', { name: 'Add application' }).click();
  await page.getByLabel('Job posting URL').fill('https://acme.com/jobs/1');
  await page.getByLabel('Company').fill('Acme');
  // Upload straight from the form.
  await page.getByRole('button', { name: 'Upload new resume' }).click();
  const upload = page.getByRole('group', { name: 'Upload a new resume' });
  await upload
    .getByLabel('Resume file')
    .setInputFiles({ name: 'Backend v3.pdf', mimeType: 'application/pdf', buffer: PDF });
  await upload.getByRole('button', { name: 'Upload and use' }).click();
  await expect(page.getByRole('combobox', { name: /^Resume/ })).toHaveValue('Backend v3');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Acme' })).toBeVisible();

  await page.getByRole('tab', { name: 'Resumes' }).click();
  await page.getByRole('button', { name: 'Delete Backend v3' }).click();
  await expect(
    page.getByText('Backend v3 is used by applications, so it was archived instead.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Archived \(1\)/ })).toBeVisible();

  await page.getByRole('tab', { name: 'Applications' }).click();
  await page.getByRole('button', { name: /^Acme/ }).click();
  const [viewer] = await Promise.all([
    session.context.waitForEvent('page'),
    page.getByRole('button', { name: 'Open resume Backend v3' }).click(),
  ]);
  await expect(viewer).toHaveTitle('Backend v3');
});

test('the form with an inline upload fits a 320px panel', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('button', { name: 'Add application' }).click();
  await page.getByRole('button', { name: 'Upload new resume' }).click();
  await expect(page.getByRole('group', { name: 'Upload a new resume' })).toBeVisible();
  await expectNoHorizontalScroll(page);
});
