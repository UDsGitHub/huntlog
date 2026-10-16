import {
  addApplication,
  findDuplicates,
  getApplication,
  listApplications,
  NotFoundError,
  restoreApplication,
  safeHref,
  softDeleteApplication,
  updateApplication,
  ValidationError,
} from './applications';
import { JobLogDB } from './db';
import type { Application } from './types';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let db: JobLogDB;
beforeEach(() => {
  db = new JobLogDB(`test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  await db.delete();
});

describe('safeHref', () => {
  it.each([
    ['https://example.com/a', 'https://example.com/a'],
    ['http://example.com', 'http://example.com'],
    ['javascript:alert(1)', undefined],
    ['data:text/html,x', undefined],
    ['not a url', undefined],
  ])('%j → %j', (input, expected) => {
    expect(safeHref(input)).toBe(expected);
  });
});

describe('addApplication', () => {
  const now = new Date('2026-10-15T17:00:00.000Z');

  it('creates an applied record with id, timestamps, history and appliedAt', async () => {
    const app = await addApplication(
      { url: 'https://example.com/jobs/1', company: 'Acme' },
      db,
      now,
    );

    expect(app).toEqual<Application>({
      id: expect.stringMatching(UUID_V4),
      url: 'https://example.com/jobs/1',
      urlNormalized: 'https://example.com/jobs/1',
      company: 'Acme',
      status: 'applied',
      statusHistory: [{ status: 'applied', at: '2026-10-15T17:00:00.000Z' }],
      appliedAt: '2026-10-15',
      createdAt: '2026-10-15T17:00:00.000Z',
      updatedAt: '2026-10-15T17:00:00.000Z',
    });
    expect(app).not.toHaveProperty('deletedAt');
    expect(await db.applications.get(app.id)).toEqual(app);
  });

  it('trims whitespace, including tabs and newlines', async () => {
    const app = await addApplication(
      { url: '\t https://example.com/x \n', company: '  Acme Corp\t' },
      db,
    );
    expect(app.url).toBe('https://example.com/x');
    expect(app.company).toBe('Acme Corp');
  });

  it('stores the derived duplicate-detection fields', async () => {
    const app = await addApplication(
      {
        url: 'http://Boards.greenhouse.io/acme/jobs/1/?gh_src=x&gh_jid=1',
        company: ' ACME ',
        title: 'Senior  Engineer',
      },
      db,
    );
    expect(await db.applications.get(app.id)).toMatchObject({
      urlNormalized: 'https://boards.greenhouse.io/acme/jobs/1?gh_jid=1',
      companyTitleKey: 'acme\u001fsenior engineer',
    });
  });

  it('leaves out the company + title key when there is no title', async () => {
    const app = await addApplication({ url: 'https://example.com', company: 'Acme' }, db);
    expect(await db.applications.get(app.id)).not.toHaveProperty('companyTitleKey');
  });

  it('stores an optional title, trimmed', async () => {
    const app = await addApplication(
      { url: 'https://example.com', company: 'Acme', title: '  Senior Engineer \n' },
      db,
    );
    expect((await db.applications.get(app.id))?.title).toBe('Senior Engineer');
  });

  it('normalizes a typed title like a captured one', async () => {
    const app = await addApplication(
      {
        url: 'https://example.com',
        company: 'Acme',
        title: 'Senior\n\n  Engineer' + ' x'.repeat(500),
      },
      db,
    );
    expect(app.title).toMatch(/^Senior Engineer x/);
    expect(app.title!.length).toBeLessThanOrEqual(300);
  });

  it.each([[undefined], [''], ['   \t']])('omits a blank title %j', async (title) => {
    const app = await addApplication({ url: 'https://example.com', company: 'Acme', title }, db);
    expect(await db.applications.get(app.id)).not.toHaveProperty('title');
  });

  it('keeps unicode and very long company names unchanged', async () => {
    const long = 'Ünïcødé 株式会社 🚀 '.repeat(40).trim();
    const app = await addApplication({ url: 'https://example.com', company: long }, db);
    expect((await db.applications.get(app.id))?.company).toBe(long);
  });

  it.each([
    [{ url: '', company: 'Acme' }, ['url']],
    [{ url: 'https://example.com', company: '' }, ['company']],
    [{ url: 'https://example.com', company: '   ' }, ['company']],
    [{ url: '   ', company: '  ' }, ['company', 'url']],
    [{ url: 'javascript:alert(1)', company: 'Acme' }, ['url']],
  ])('rejects %j without writing', async (input, fields) => {
    const error = await addApplication(input, db).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys((error as ValidationError).fields).sort()).toEqual(fields);
    expect(await db.applications.count()).toBe(0);
  });

  it('gives every application a distinct id', async () => {
    const apps = await Promise.all(
      Array.from({ length: 10 }, () =>
        addApplication({ url: 'https://example.com', company: 'Acme' }, db),
      ),
    );
    expect(new Set(apps.map((a) => a.id)).size).toBe(10);
  });
});

describe('listApplications', () => {
  it('returns an empty list for a new database', async () => {
    expect(await listApplications(db)).toEqual([]);
  });

  it('orders by most recently updated first', async () => {
    await addApplication(
      { url: 'https://a.com', company: 'A' },
      db,
      new Date('2026-10-01T00:00:00Z'),
    );
    await addApplication(
      { url: 'https://c.com', company: 'C' },
      db,
      new Date('2026-10-03T00:00:00Z'),
    );
    await addApplication(
      { url: 'https://b.com', company: 'B' },
      db,
      new Date('2026-10-02T00:00:00Z'),
    );
    expect((await listApplications(db)).map((a) => a.company)).toEqual(['C', 'B', 'A']);
  });

  it('never returns soft-deleted rows', async () => {
    const kept = await addApplication({ url: 'https://a.com', company: 'Kept' }, db);
    const gone = await addApplication({ url: 'https://b.com', company: 'Gone' }, db);
    await db.applications.update(gone.id, { deletedAt: new Date().toISOString() });
    expect((await listApplications(db)).map((a) => a.id)).toEqual([kept.id]);
  });
});

describe('updateApplication', () => {
  const created = new Date('2026-10-01T10:00:00.000Z');
  const edited = new Date('2026-10-05T10:00:00.000Z');

  it('replaces editable fields and keeps status, history, id and createdAt', async () => {
    const app = await addApplication(
      { url: 'https://a.com/1', company: 'Acme', title: 'Engineer', appliedAt: '2026-10-01' },
      db,
      created,
    );
    const updated = await updateApplication(
      app.id,
      {
        url: 'https://b.com/2?utm_source=x',
        company: 'Beta',
        title: 'Designer',
        location: 'Remote, EU',
        workMode: 'remote',
        salaryMin: '70000',
        salaryCurrency: 'EUR',
        salaryPeriod: 'year',
        appliedAt: '2026-09-30',
      },
      db,
      edited,
    );
    expect(updated).toMatchObject({
      id: app.id,
      url: 'https://b.com/2?utm_source=x',
      urlNormalized: 'https://b.com/2',
      company: 'Beta',
      title: 'Designer',
      companyTitleKey: 'beta\u001fdesigner',
      location: 'Remote, EU',
      workMode: 'remote',
      salaryMin: 70000,
      salaryCurrency: 'EUR',
      appliedAt: '2026-09-30',
      status: app.status,
      statusHistory: app.statusHistory,
      createdAt: app.createdAt,
      updatedAt: edited.toISOString(),
    });
    expect(await db.applications.get(app.id)).toEqual(updated);
  });

  it('removes optional fields the user cleared', async () => {
    const app = await addApplication(
      {
        url: 'https://a.com/1',
        company: 'Acme',
        title: 'Engineer',
        location: 'Berlin',
        salaryMin: '1',
        notes: 'note',
      },
      db,
    );
    const updated = await updateApplication(app.id, { url: app.url, company: 'Acme' }, db);
    for (const field of [
      'title',
      'location',
      'salaryMin',
      'salaryCurrency',
      'salaryPeriod',
      'notes',
    ]) {
      expect(updated).not.toHaveProperty(field);
    }
    expect(updated.companyTitleKey).toBeUndefined();
  });

  it('validates before writing', async () => {
    const app = await addApplication({ url: 'https://a.com/1', company: 'Acme' }, db);
    await expect(
      updateApplication(app.id, { url: '', company: 'Acme' }, db),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await db.applications.get(app.id)).toEqual(app);
  });

  it.each([['missing'], ['soft-deleted']])('fails for a %s row', async (kind) => {
    const app = await addApplication({ url: 'https://a.com/1', company: 'Acme' }, db);
    if (kind === 'soft-deleted') await softDeleteApplication(app.id, db);
    const id = kind === 'missing' ? 'nope' : app.id;
    await expect(
      updateApplication(id, { url: 'https://a.com', company: 'X' }, db),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.applications.count()).toBe(1);
  });
});

describe('updateApplication and Date applied', () => {
  it('requires a date applied for an applied job', async () => {
    const app = await addApplication({ url: 'https://a.com/1', company: 'Acme' }, db);
    const error = await updateApplication(
      app.id,
      { url: app.url, company: 'Acme', appliedAt: '' },
      db,
    ).catch((e: unknown) => e);
    expect((error as ValidationError).fields).toEqual({ appliedAt: 'Enter the date you applied.' });
  });

  it('lets a saved job be edited without a date applied, and clears it', async () => {
    const app = await addApplication({ url: 'https://a.com/1', company: 'Acme' }, db);
    await db.applications.update(app.id, { status: 'saved' });
    const updated = await updateApplication(
      app.id,
      { url: app.url, company: 'Acme Corp', appliedAt: '' },
      db,
    );
    expect(updated.company).toBe('Acme Corp');
    expect(updated).not.toHaveProperty('appliedAt');
  });
});

describe('soft delete and restore', () => {
  it('hides a deleted row and brings it back with a newer updatedAt', async () => {
    const app = await addApplication(
      { url: 'https://a.com/1', company: 'Acme' },
      db,
      new Date('2026-10-01T00:00:00Z'),
    );
    const deleted = await softDeleteApplication(app.id, db, new Date('2026-10-02T00:00:00Z'));
    expect(deleted).toMatchObject({
      deletedAt: '2026-10-02T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    });
    expect(await getApplication(app.id, db)).toBeUndefined();

    const restored = await restoreApplication(app.id, db, new Date('2026-10-03T00:00:00Z'));
    expect(restored).not.toHaveProperty('deletedAt');
    expect(restored.updatedAt).toBe('2026-10-03T00:00:00.000Z');
    expect({ ...restored, updatedAt: app.updatedAt }).toEqual(app);
    expect(await getApplication(app.id, db)).toEqual(restored);
  });

  it('keeps the row in storage, so nothing is lost', async () => {
    const app = await addApplication({ url: 'https://a.com/1', company: 'Acme' }, db);
    await softDeleteApplication(app.id, db);
    expect(await db.applications.count()).toBe(1);
  });

  it.each([
    ['delete a missing row', (id: string) => softDeleteApplication(`${id}-x`, db)],
    [
      'delete twice',
      async (id: string) => {
        await softDeleteApplication(id, db);
        return softDeleteApplication(id, db);
      },
    ],
    ['restore a live row', (id: string) => restoreApplication(id, db)],
    ['restore a missing row', (id: string) => restoreApplication(`${id}-x`, db)],
  ])('refuses to %s', async (_label, action) => {
    const app = await addApplication({ url: 'https://a.com/1', company: 'Acme' }, db);
    await expect(action(app.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

// Spec §5: every query filters out soft-deleted rows. Each read in this module is listed here.
describe('soft-deleted rows stay out of every read', () => {
  const reads: [string, (app: Application) => Promise<unknown>][] = [
    ['listApplications', async () => (await listApplications(db)).length],
    ['getApplication', (app) => getApplication(app.id, db)],
    [
      'findDuplicates',
      async (app) =>
        (await findDuplicates({ url: app.url, company: app.company, title: app.title }, {}, db))
          .length,
    ],
  ];

  it.each(reads)('%s', async (_name, read) => {
    const app = await addApplication(
      { url: 'https://a.com/1', company: 'Acme', title: 'Engineer' },
      db,
    );
    const visible = await read(app);
    await softDeleteApplication(app.id, db);
    const hidden = await read(app);
    expect(visible).toBeTruthy();
    expect(hidden === undefined || hidden === 0).toBe(true);
  });
});
