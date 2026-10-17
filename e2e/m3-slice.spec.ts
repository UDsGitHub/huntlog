import { expect, expectNoHorizontalScroll, panelUrl, test } from './fixtures';

/** Today as the app shows it (en-US, e.g. "Oct 17, 2026"). */
const todayText = () =>
  new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// M3 slice: tap a row's status chip → pick Interviewing → the list updates, the timeline records
// the date, and Undo reverts it.
test('chip → Interviewing → the timeline records it → Undo reverts it', async ({ session }) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('button', { name: 'Add application' }).click();
  await page.getByLabel('Job posting URL').fill('https://acme.com/jobs/1');
  await page.getByLabel('Company').fill('Acme');
  await page.getByRole('button', { name: 'Save' }).click();

  const row = page.getByRole('listitem').filter({ hasText: 'Acme' });
  await row.getByRole('button', { name: /^Status: Applied/ }).click();
  await page
    .getByRole('dialog', { name: 'Change status' })
    .getByRole('button', { name: 'Interviewing', exact: true })
    .click();
  await expect(row.getByRole('button', { name: /^Status: / })).toHaveText('Interviewing');

  await row.getByRole('button', { name: /^Acme/ }).click();
  const timeline = page.getByRole('region', { name: 'Status history' });
  const entry = (status: string) =>
    timeline.getByRole('listitem').filter({ hasText: new RegExp(`^${status}`) });
  await expect(entry('Applied')).toContainText(todayText());
  await expect(entry('Interviewing')).toContainText(todayText());

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(entry('Interviewing')).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Acme' }).getByRole('button', { name: /^Status: / }),
  ).toHaveText('Applied');
});

test('an interview date can be backfilled from the timeline', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('button', { name: 'Add application' }).click();
  await page.getByLabel('Job posting URL').fill('https://acme.com/jobs/1');
  await page.getByLabel('Company').fill('Acme');
  await page.getByLabel('Date applied').fill('2026-09-01');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: /^Status: Applied/ }).click();
  await page
    .getByRole('dialog', { name: 'Change status' })
    .getByRole('button', { name: 'Interviewing', exact: true })
    .click();
  await page.getByRole('button', { name: /^Acme/ }).click();

  const timeline = page.getByRole('region', { name: 'Status history' });
  await timeline.getByRole('button', { name: 'Change the date for Interviewing' }).click();
  await timeline.getByLabel('Interviewing date').fill('2026-09-10');
  await timeline.getByRole('button', { name: 'Save the date for Interviewing' }).click();
  await expect(timeline).toContainText('Sep 10, 2026');
  await expectNoHorizontalScroll(page);
  // Wait for the write itself before reloading.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<string[]>((resolve, reject) => {
            const open = indexedDB.open('job-log');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const all = open.result
                .transaction('applications')
                .objectStore('applications')
                .getAll();
              all.onsuccess = () => {
                const [row] = all.result as { statusHistory: { at: string }[] }[];
                resolve(row?.statusHistory.map((e) => e.at) ?? []);
                open.result.close();
              };
            };
          }),
      ),
    )
    .toContainEqual(expect.stringMatching(/^2026-09-(09|10|11)T/));

  // Survives a reload: it was saved.
  await page.reload();
  await page.getByRole('button', { name: /^Acme/ }).click();
  await expect(page.getByRole('region', { name: 'Status history' })).toContainText('Sep 10, 2026');
});
