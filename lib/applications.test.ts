import { addApplication, listApplications, safeHref, ValidationError } from './applications';
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
