import {
  addApplication,
  findDuplicates,
  getApplication,
  listApplications,
  NotFoundError,
  restoreApplication,
  saveApplication,
  setStatus,
  undoStatusChange,
  safeHref,
  softDeleteApplication,
  updateApplication,
  ValidationError,
} from './applications';
import { JobLogDB } from './db';
import { addResume, deleteResume, setResumeArchived, updateResume } from './resumes';
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

describe('saveApplication', () => {
  const seed = () =>
    addApplication(
      { url: 'https://acme.com/jobs/1?utm_source=x', company: 'Acme', title: 'Engineer' },
      db,
    );

  it('adds when nothing matches', async () => {
    const result = await saveApplication({ url: 'https://new.com/1', company: 'New' }, {}, db);
    expect('saved' in result && result.saved.company).toBe('New');
  });

  it('returns matches with their reason instead of saving', async () => {
    const existing = await seed();
    const byUrl = await saveApplication({ url: 'http://acme.com/jobs/1/', company: 'X' }, {}, db);
    expect(byUrl).toEqual({ duplicates: [{ application: existing, reason: 'url' }] });
    const byTitle = await saveApplication(
      { url: 'https://other.com/2', company: ' ACME ', title: 'engineer' },
      {},
      db,
    );
    expect(byTitle).toEqual({ duplicates: [{ application: existing, reason: 'companyTitle' }] });
    expect(await db.applications.count()).toBe(1);
  });

  it('saves anyway when allowed', async () => {
    const existing = await seed();
    const result = await saveApplication(
      { url: existing.url, company: 'Acme' },
      { allowDuplicate: true },
      db,
    );
    expect('saved' in result).toBe(true);
    expect(await db.applications.count()).toBe(2);
  });

  it('updates without re-checking when url, company and title are unchanged', async () => {
    const existing = await seed();
    await addApplication({ url: existing.url, company: 'Twin', title: 'Engineer' }, db);
    const twin = (await db.applications.toArray()).find((a) => a.company === 'Twin')!;
    const result = await saveApplication(
      { url: twin.url, company: 'Twin', title: 'Engineer', notes: 'Second round' },
      { id: twin.id },
      db,
    );
    expect('saved' in result && result.saved.notes).toBe('Second round');
  });

  it('re-checks an edit that changes url, company or title, ignoring itself', async () => {
    const existing = await seed();
    const other = await addApplication({ url: 'https://beta.com/1', company: 'Beta' }, db);
    const result = await saveApplication(
      { url: existing.url, company: 'Beta' },
      { id: other.id },
      db,
    );
    expect(result).toEqual({ duplicates: [{ application: existing, reason: 'url' }] });
    const self = await saveApplication(
      { url: 'https://acme.com/jobs/1', company: 'Acme', title: 'Engineer Two' },
      { id: existing.id },
      db,
    );
    expect('saved' in self).toBe(true);
  });

  it('applies the status-aware Date applied rule when editing', async () => {
    const existing = await seed();
    await expect(
      saveApplication(
        { url: existing.url, company: 'Acme', appliedAt: '' },
        { id: existing.id },
        db,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await db.applications.update(existing.id, { status: 'saved' });
    const result = await saveApplication(
      { url: existing.url, company: 'Acme', title: 'Engineer', appliedAt: '' },
      { id: existing.id },
      db,
    );
    expect('saved' in result && result.saved).not.toHaveProperty('appliedAt');
  });

  it('fails for a missing or soft-deleted id', async () => {
    const existing = await seed();
    await softDeleteApplication(existing.id, db);
    await expect(
      saveApplication({ url: 'https://a.com', company: 'A' }, { id: existing.id }, db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('setStatus and undoStatusChange', () => {
  const t0 = new Date('2026-10-01T10:00:00.000Z');
  const t1 = new Date('2026-10-05T10:00:00.000Z');
  const t2 = new Date('2026-10-06T10:00:00.000Z');

  async function savedJob() {
    const result = await saveApplication(
      { url: 'https://acme.com/1', company: 'Acme', status: 'saved' },
      {},
      db,
      t0,
    );
    if (!('saved' in result)) throw new Error('expected a save');
    return result.saved;
  }

  it('records the change and returns before and after', async () => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' }, db, t0);
    const { before, after } = await setStatus(app.id, 'interviewing', {}, db, t1);
    expect(before).toEqual(app);
    expect(after.status).toBe('interviewing');
    expect(after.statusHistory.map((e) => e.status)).toEqual(['applied', 'interviewing']);
    expect(await db.applications.get(app.id)).toEqual(after);
  });

  it('does nothing for the current status', async () => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' }, db, t0);
    const change = await setStatus(app.id, 'applied', {}, db, t1);
    expect(change.after).toBe(change.before);
    expect(await db.applications.get(app.id)).toEqual(app);
    expect(await undoStatusChange(change, db)).toBe(false);
  });

  it('uses the date given when asked, and rejects a bad one before writing', async () => {
    const app = await savedJob();
    await expect(
      setStatus(app.id, 'interviewing', { appliedAt: '2999-01-01' }, db, t1),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await db.applications.get(app.id))?.status).toBe('saved');
    const { after } = await setStatus(app.id, 'interviewing', { appliedAt: '2026-10-02' }, db, t1);
    expect(after.appliedAt).toBe('2026-10-02');
  });

  it.each([['missing'], ['soft-deleted']])('fails for a %s row', async (kind) => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' }, db);
    if (kind === 'soft-deleted') await softDeleteApplication(app.id, db);
    await expect(
      setStatus(kind === 'missing' ? 'nope' : app.id, 'offer', {}, db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('Undo restores the earlier record, clearing a date the change set', async () => {
    const app = await savedJob();
    const change = await setStatus(app.id, 'applied', {}, db, t1);
    expect(change.after.appliedAt).toBeDefined();
    expect(await undoStatusChange(change, db, t2)).toBe(true);
    const restored = await db.applications.get(app.id);
    expect(restored).toEqual({ ...app, updatedAt: t2.toISOString() });
    expect(restored).not.toHaveProperty('appliedAt');
  });

  it("Undo does nothing once the row has changed again, and can't run twice", async () => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' }, db, t0);
    const first = await setStatus(app.id, 'screening', {}, db, t1);
    const second = await setStatus(app.id, 'interviewing', {}, db, t2);
    expect(await undoStatusChange(first, db)).toBe(false);
    expect((await db.applications.get(app.id))?.status).toBe('interviewing');
    expect(await undoStatusChange(second, db)).toBe(true);
    expect((await db.applications.get(app.id))?.status).toBe('screening');
    expect(await undoStatusChange(second, db)).toBe(false);
  });

  it('Undo tells apart two changes made in the same millisecond', async () => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' }, db, t0);
    const first = await setStatus(app.id, 'screening', {}, db, t1);
    await setStatus(app.id, 'interviewing', {}, db, t1);
    expect(await undoStatusChange(first, db)).toBe(false);
    expect((await db.applications.get(app.id))?.status).toBe('interviewing');
  });

  it('Undo does nothing for a row deleted meanwhile', async () => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' }, db, t0);
    const change = await setStatus(app.id, 'offer', {}, db, t1);
    await softDeleteApplication(app.id, db, t2);
    expect(await undoStatusChange(change, db)).toBe(false);
  });
});

describe('saving with a status', () => {
  it('a new Saved job has no date applied and starts its history as Saved', async () => {
    const result = await saveApplication(
      { url: 'https://acme.com/1', company: 'Acme', status: 'saved' },
      {},
      db,
    );
    if (!('saved' in result)) throw new Error('expected a save');
    expect(result.saved).not.toHaveProperty('appliedAt');
    expect(result.saved.statusHistory.map((e) => e.status)).toEqual(['saved']);
  });

  it('an edit that changes the status appends one history entry', async () => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' }, db);
    const updated = await updateApplication(
      app.id,
      { url: app.url, company: 'Acme', status: 'offer', appliedAt: app.appliedAt },
      db,
      new Date('2026-10-20T10:00:00.000Z'),
    );
    expect(updated.status).toBe('offer');
    expect(updated.statusHistory).toEqual([
      ...app.statusHistory,
      { status: 'offer', at: '2026-10-20T10:00:00.000Z' },
    ]);
  });

  it('an edit that keeps the status leaves history alone', async () => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' }, db);
    const updated = await updateApplication(
      app.id,
      { url: app.url, company: 'Acme Corp', status: 'applied', appliedAt: app.appliedAt },
      db,
    );
    expect(updated.statusHistory).toEqual(app.statusHistory);
  });
});

describe('linking a resume (spec §4.6)', () => {
  const pdf = (name: string) => {
    const data = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2]);
    return { name, size: data.byteLength, arrayBuffer: async () => data.slice().buffer };
  };
  const saved = async (input: Parameters<typeof saveApplication>[0], id?: string) => {
    const result = await saveApplication(input, { id, allowDuplicate: true }, db);
    if (!('saved' in result)) throw new Error('expected a save');
    return result.saved;
  };

  it('stores the resume id and its name at the moment it is linked', async () => {
    const resume = await addResume(pdf('cv.pdf'), { name: 'Backend v3' }, db);
    const app = await saved({ url: 'https://a.com/1', company: 'Acme', resumeId: resume.id });
    expect(app).toMatchObject({ resumeId: resume.id, resumeNameSnapshot: 'Backend v3' });
  });

  it('keeps the snapshot when an edit keeps the same resume, even after a rename or archive', async () => {
    const resume = await addResume(pdf('cv.pdf'), { name: 'Backend v3' }, db);
    const app = await saved({ url: 'https://a.com/1', company: 'Acme', resumeId: resume.id });
    await updateResume(resume.id, { name: 'Backend v3 (old)' }, db);
    await setResumeArchived(resume.id, true, db);
    const edited = await saved(
      { url: app.url, company: 'Acme Corp', resumeId: resume.id, appliedAt: app.appliedAt },
      app.id,
    );
    expect(edited).toMatchObject({ resumeId: resume.id, resumeNameSnapshot: 'Backend v3' });
  });

  it('takes a new snapshot when the resume changes, and clears both when removed', async () => {
    const a = await addResume(pdf('a.pdf'), { name: 'Backend v3' }, db);
    const b = await addResume(pdf('b.pdf'), { name: 'Frontend v1' }, db);
    const app = await saved({ url: 'https://a.com/1', company: 'Acme', resumeId: a.id });
    const switched = await saved(
      { url: app.url, company: 'Acme', resumeId: b.id, appliedAt: app.appliedAt },
      app.id,
    );
    expect(switched.resumeNameSnapshot).toBe('Frontend v1');
    const cleared = await saved(
      { url: app.url, company: 'Acme', resumeId: '', appliedAt: app.appliedAt },
      app.id,
    );
    expect(cleared).not.toHaveProperty('resumeId');
    expect(cleared).not.toHaveProperty('resumeNameSnapshot');
  });

  it.each([
    ['archived', async (id: string) => void (await setResumeArchived(id, true, db))],
    ['deleted', async (id: string) => void (await deleteResume(id, db))],
    ['missing', async () => {}],
  ])('refuses to newly link a %s resume', async (kind, prepare) => {
    const resume = await addResume(pdf('cv.pdf'), {}, db);
    await prepare(resume.id);
    const resumeId = kind === 'missing' ? 'nope' : resume.id;
    const error = await saveApplication(
      { url: 'https://a.com/1', company: 'Acme', resumeId },
      {},
      db,
    ).catch((e: unknown) => e);
    expect((error as ValidationError).fields).toEqual({
      resumeId: "That resume isn't available any more. Choose another.",
    });
    expect(await db.applications.count()).toBe(0);
  });

  it('addApplication links a resume with its snapshot too', async () => {
    const resume = await addResume(pdf('cv.pdf'), { name: 'Backend v3' }, db);
    const app = await addApplication(
      { url: 'https://a.com/1', company: 'Acme', resumeId: resume.id },
      db,
    );
    expect(app).toMatchObject({ resumeId: resume.id, resumeNameSnapshot: 'Backend v3' });
    await setResumeArchived(resume.id, true, db);
    await expect(
      addApplication({ url: 'https://b.com/1', company: 'Beta', resumeId: resume.id }, db),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('keeps the link when an edit leaves resumeId out', async () => {
    const resume = await addResume(pdf('cv.pdf'), { name: 'Backend v3' }, db);
    const app = await saved({ url: 'https://a.com/1', company: 'Acme', resumeId: resume.id });
    const edited = await updateApplication(
      app.id,
      { url: app.url, company: 'Acme Corp', appliedAt: app.appliedAt },
      db,
    );
    expect(edited).toMatchObject({ resumeId: resume.id, resumeNameSnapshot: 'Backend v3' });
  });

  it('makes a linked resume archive instead of delete', async () => {
    const resume = await addResume(pdf('cv.pdf'), {}, db);
    await saved({ url: 'https://a.com/1', company: 'Acme', resumeId: resume.id });
    expect((await deleteResume(resume.id, db)).outcome).toBe('archived');
  });
});
