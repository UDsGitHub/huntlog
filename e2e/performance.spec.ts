import type { Locator, Page } from '@playwright/test';
import { expect, expectNoHorizontalScroll, panelUrl, test } from './fixtures';

// Spec §10: with 1,000 applications the panel shows its list in under 300 ms.
const COUNT = 1000;
const BUDGET_MS = 300;
const LOADS = 5;

// Tracing snapshots the DOM as the page loads, which would be timed too.
test.use({ trace: 'off' });

/** Stores `count` applications straight into IndexedDB (the panel must have created it). */
async function seedApplications(page: Page, count: number) {
  await page.evaluate(async (count) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('job-log');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction('applications', 'readwrite');
    const store = transaction.objectStore('applications');
    const statuses = ['saved', 'applied', 'interviewing', 'offer', 'rejected'];
    for (let i = 0; i < count; i++) {
      const at = new Date(Date.UTC(2025, 0, 1) + i * 6 * 3600_000).toISOString();
      const status = statuses[i % statuses.length]!;
      // Every third row has only the required fields, so rows differ in height as in real use.
      const full = i % 3 !== 0;
      store.add({
        id: crypto.randomUUID(),
        url: `https://jobs.example.com/${i}`,
        urlNormalized: `jobs.example.com/${i}`,
        company: `Company ${i}`,
        title: full ? `Software Engineer ${i}` : '',
        companyTitleKey: `company ${i}\u001f${full ? `software engineer ${i}` : ''}`,
        status,
        statusHistory: [{ status, at }],
        appliedAt: status === 'saved' ? undefined : at.slice(0, 10),
        ...(full && { location: 'Berlin', workMode: 'hybrid', source: 'LinkedIn' }),
        createdAt: at,
        updatedAt: at,
      });
    }
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, count);
}

/**
 * Opens the panel and returns the time from navigation to the first frame painted with rows,
 * observed inside the page, so Playwright's own round trips aren't counted.
 */
async function timeToList(page: Page, url: string) {
  await page.addInitScript(() => {
    const target = window as { listShownAt?: number };
    const observer = new MutationObserver(() => {
      if (!document.querySelector('ul[aria-label="Applications"] > li')) return;
      observer.disconnect();
      // Rows are in the DOM; the frame after next has laid them out and painted them.
      requestAnimationFrame(() => setTimeout(() => (target.listShownAt = performance.now())));
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  await page.goto(url);
  const shown = await page.waitForFunction(() => (window as { listShownAt?: number }).listShownAt);
  return (await shown.jsonValue()) as number;
}

test.describe('1,000 applications', () => {
  test.beforeEach(async ({ session }) => {
    const page = await session.context.newPage();
    await page.goto(panelUrl(session.extensionId));
    await expect(page.getByRole('button', { name: 'Add your first application' })).toBeVisible();
    await seedApplications(page, COUNT);
    await page.close();
  });

  test('the panel shows the list in under 300 ms', async ({ session }) => {
    const times: number[] = [];
    for (let i = 0; i < LOADS; i++) {
      const page = await session.context.newPage();
      await page.setViewportSize({ width: 360, height: 800 });
      times.push(await timeToList(page, panelUrl(session.extensionId)));
      // Every row is there (nothing is left out), only off-screen ones skip rendering: this
      // holds however fast the machine is, where the timing alone could miss a regression.
      const rows = page.getByRole('list', { name: 'Applications' }).getByRole('listitem');
      await expect(rows).toHaveCount(COUNT);
      // (The card's content is what it skips, not the card itself.)
      const rendered = (row: Locator) =>
        row
          .locator('> div')
          .evaluate((card) =>
            card.firstElementChild!.checkVisibility({ contentVisibilityAuto: true }),
          );
      expect(await rendered(rows.first())).toBe(true);
      expect(await rendered(rows.last())).toBe(false);
      await page.close();
    }
    const median = [...times].sort((a, b) => a - b)[Math.floor(LOADS / 2)]!;
    console.log(`List shown in ${times.map((t) => Math.round(t)).join(', ')} ms`);
    expect(median).toBeLessThan(BUDGET_MS);
  });

  test('a row far down opens, and focus comes back to it', async ({ session }) => {
    const page = await session.context.newPage();
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(panelUrl(session.extensionId));
    const row = page.getByRole('button', { name: 'Company 400, Software Engineer 400' });
    await row.click();
    await expect(page.getByRole('heading', { name: 'Company 400' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to applications' }).click();
    await expect(row).toBeFocused();
    await expect(row).toBeInViewport();
    await expectNoHorizontalScroll(page);
  });
});
