import { expect, expectNoHorizontalScroll, panelUrl, test } from './fixtures';

// M2 slice: add, view, edit and delete an application with every v1 field (except the resume),
// and get warned about duplicates.
test('a full application record, end to end, with the duplicate warning', async ({ session }) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));

  // Add with every field.
  await page.getByRole('button', { name: '+ Add application' }).click();
  await page
    .getByLabel('Job posting URL')
    .fill('https://boards.greenhouse.io/acme/jobs/1?gh_jid=1');
  await page.getByLabel('Company').fill('Acme');
  await page.getByLabel(/Job title/).fill('Senior Engineer');
  await page.getByRole('button', { name: 'More details' }).click();
  await page.getByLabel(/Location/).fill('Berlin');
  await page.getByLabel(/Work mode/).selectOption('hybrid');
  await page.getByLabel('Date applied').fill('2026-10-01');
  await page.getByLabel('Minimum').fill('85,000');
  await page.getByLabel('Maximum').fill('95,000');
  await page.getByLabel('Currency').selectOption('EUR');
  await page.getByLabel('Per').selectOption('year');
  await page.getByLabel(/Source/).fill('Referral');
  await page.getByLabel(/Notes/).fill('Met the team.\nFollow up with Dana.');
  await page.getByRole('button', { name: 'Save' }).click();

  // View it.
  await page.getByRole('button', { name: /^Acme/ }).click();
  const detail = page.getByRole('region', { name: 'Acme' });
  await expect(detail).toContainText('Senior Engineer');
  await expect(detail).toContainText('Berlin');
  await expect(detail).toContainText('Hybrid');
  await expect(detail).toContainText('2026-10-01');
  await expect(detail).toContainText('€85,000–€95,000 per year');
  await expect(detail).toContainText('Referral');
  await expect(detail).toContainText('Follow up with Dana.');

  // Edit it.
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel(/Location/).fill('Remote, EU');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(detail).toContainText('Remote, EU');

  // Add the same posting again via a tracking link: warned, and View existing opens the original.
  await page.getByRole('button', { name: '← Back to applications' }).click();
  await page.getByRole('button', { name: '+ Add application' }).click();
  await page
    .getByLabel('Job posting URL')
    .fill('http://boards.greenhouse.io/acme/jobs/1/?utm_source=linkedin&gh_src=x&gh_jid=1');
  await page.getByLabel('Company').fill('Acme Inc');
  await page.getByRole('button', { name: 'Save' }).click();
  const warning = page.getByRole('group', { name: 'You may have logged this already' });
  await expect(warning).toContainText('Acme · Senior Engineer, applied 2026-10-01');
  await expect(warning).toContainText('Same job posting URL');
  await warning.getByRole('button', { name: 'View existing' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Acme' })).toBeFocused();

  // Delete it, Undo, delete again.
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('list', { name: 'Applications' })).toContainText('Acme');
  await page.getByRole('button', { name: /^Acme/ }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText(/No applications yet/)).toBeVisible();

  // A deleted application no longer counts as a duplicate.
  await page.getByRole('button', { name: '+ Add application' }).click();
  await page
    .getByLabel('Job posting URL')
    .fill('https://boards.greenhouse.io/acme/jobs/1?gh_jid=1');
  await page.getByLabel('Company').fill('Acme');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('list', { name: 'Applications' })).toContainText('Acme');
});

test('the duplicate warning fits a 320px panel', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(session.extensionId));
  for (const company of [`Long${'Q'.repeat(150)}`, 'Second']) {
    await page.getByRole('button', { name: '+ Add application' }).click();
    await page.getByLabel('Job posting URL').fill(`https://acme.com/${'a'.repeat(200)}`);
    await page.getByLabel('Company').fill(company);
    await page.getByLabel(/Job title/).fill(`Title ${'W'.repeat(150)}`);
    await page.getByRole('button', { name: 'Save' }).click();
  }
  await expect(page.getByRole('group', { name: 'You may have logged this already' })).toBeVisible();
  await expectNoHorizontalScroll(page);
});
