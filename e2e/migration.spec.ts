import { expect, test } from './fixtures';

// DoD #5 in real Chrome: a database written by v0.1.0 (Dexie schema v1) upgrades in place when
// the new build opens it. The service worker shares the extension origin, so it can create the
// old database before the side panel ever loads.
const AT = '2026-10-15T12:00:00.000Z';

test('a v1 database from v0.1.0 upgrades to the latest schema and keeps its rows', async ({
  session,
}) => {
  await session.serviceWorker.evaluate(async (at) => {
    await new Promise<void>((resolve, reject) => {
      // Dexie stores schema version N as IndexedDB version N * 10.
      const request = indexedDB.open('job-log', 10);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('applications', { keyPath: 'id' });
        for (const index of ['status', 'appliedAt', 'updatedAt']) store.createIndex(index, index);
        store.add({
          id: 'legacy-1',
          url: 'http://Boards.greenhouse.io/acme/jobs/1/?gh_src=x&gh_jid=1',
          company: 'Legacy Co',
          title: 'Senior  Engineer',
          status: 'applied',
          statusHistory: [{ status: 'applied', at }],
          appliedAt: '2026-10-15',
          createdAt: at,
          updatedAt: at,
        });
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }, AT);

  const panel = await session.context.newPage();
  await panel.goto(`chrome-extension://${session.extensionId}/sidepanel.html`);
  await expect(panel.getByRole('list', { name: 'Applications' })).toContainText('Legacy Co');

  const stored = await panel.evaluate(
    () =>
      new Promise<{
        version: number;
        stores: string[];
        indexes: string[];
        row: Record<string, unknown>;
      }>((resolve, reject) => {
        const request = indexedDB.open('job-log');
        request.onsuccess = () => {
          const tx = request.result.transaction('applications');
          const store = tx.objectStore('applications');
          const get = store.get('legacy-1');
          get.onsuccess = () => {
            resolve({
              version: request.result.version,
              stores: [...request.result.objectStoreNames].sort(),
              indexes: [...store.indexNames].sort(),
              row: get.result,
            });
            request.result.close();
          };
          get.onerror = () => reject(get.error);
        };
        request.onerror = () => reject(request.error);
      }),
  );
  expect(stored.version).toBe(30);
  expect(stored.stores).toEqual(['applications', 'resumeFiles', 'resumes']);
  expect(stored.indexes).toEqual([
    'appliedAt',
    'companyTitleKey',
    'resumeId',
    'status',
    'updatedAt',
    'urlNormalized',
  ]);
  expect(stored.row).toMatchObject({
    company: 'Legacy Co',
    title: 'Senior  Engineer',
    appliedAt: '2026-10-15',
    urlNormalized: 'https://boards.greenhouse.io/acme/jobs/1?gh_jid=1',
    companyTitleKey: 'legacy co\u001fsenior engineer',
  });
});

test('a v2 database from v0.2–v0.3 upgrades to the latest schema and keeps its rows', async ({
  session,
}) => {
  const row = {
    id: 'v2-1',
    url: 'https://acme.com/jobs/1',
    urlNormalized: 'https://acme.com/jobs/1',
    companyTitleKey: 'acme\u001fengineer',
    company: 'Acme',
    title: 'Engineer',
    status: 'interviewing',
    statusHistory: [
      { status: 'applied', at: AT },
      { status: 'interviewing', at: AT },
    ],
    appliedAt: '2026-10-15',
    location: 'Berlin',
    salaryMin: 85000,
    salaryCurrency: 'EUR',
    salaryPeriod: 'year',
    notes: 'Line one\nLine two',
    createdAt: AT,
    updatedAt: AT,
  };
  await session.serviceWorker.evaluate(async (seed) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('job-log', 20);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('applications', { keyPath: 'id' });
        for (const index of [
          'status',
          'appliedAt',
          'updatedAt',
          'urlNormalized',
          'companyTitleKey',
        ]) {
          store.createIndex(index, index);
        }
        store.add(seed);
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }, row);

  const panel = await session.context.newPage();
  await panel.goto(`chrome-extension://${session.extensionId}/sidepanel.html`);
  await expect(panel.getByRole('list', { name: 'Applications' })).toContainText('Acme');

  const stored = await panel.evaluate(
    () =>
      new Promise<{ version: number; stores: string[]; row: unknown }>((resolve, reject) => {
        const request = indexedDB.open('job-log');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const get = request.result
            .transaction('applications')
            .objectStore('applications')
            .get('v2-1');
          get.onsuccess = () => {
            resolve({
              version: request.result.version,
              stores: [...request.result.objectStoreNames].sort(),
              row: get.result,
            });
            request.result.close();
          };
        };
      }),
  );
  expect(stored.version).toBe(30);
  expect(stored.stores).toEqual(['applications', 'resumeFiles', 'resumes']);
  expect(stored.row).toEqual(row);
});
