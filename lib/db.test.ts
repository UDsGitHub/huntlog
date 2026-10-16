import Dexie from 'dexie';
import { JobLogDB } from './db';

const AT = '2026-10-15T12:00:00.000Z';

/** The v1 schema exactly as shipped in v0.0.0 and v0.1.0. Never edit it. */
function openV1(name: string) {
  const v1 = new Dexie(name);
  v1.version(1).stores({ applications: 'id, status, appliedAt, updatedAt' });
  return v1;
}

const v1Rows = [
  {
    id: 'with-title',
    url: 'http://Boards.greenhouse.io/acme/jobs/1/?gh_src=x&gh_jid=1',
    company: 'Acme',
    title: '  Senior   Engineer ',
    status: 'applied',
    statusHistory: [{ status: 'applied', at: AT }],
    appliedAt: '2026-10-15',
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: 'no-title',
    url: 'https://jobs.lever.co/beta/123',
    company: 'Beta',
    status: 'applied',
    statusHistory: [{ status: 'applied', at: AT }],
    appliedAt: '2026-10-14',
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: 'invalid-url',
    url: 'javascript:alert(1)',
    company: 'Imported',
    status: 'applied',
    statusHistory: [],
    createdAt: AT,
    updatedAt: AT,
  },
  {
    // Malformed (hand-edited or corrupted): must not abort the upgrade for everyone else.
    id: 'malformed',
    company: 42,
    status: 'applied',
    statusHistory: [],
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: 'deleted',
    url: 'https://acme.com/jobs/9',
    company: 'Gone',
    title: 'Old role',
    status: 'rejected',
    statusHistory: [{ status: 'applied', at: AT }],
    createdAt: AT,
    updatedAt: AT,
    deletedAt: AT,
  },
];

describe('JobLogDB', () => {
  let name: string;
  beforeEach(() => {
    name = `test-${crypto.randomUUID()}`;
  });
  afterEach(async () => {
    await Dexie.delete(name);
  });

  // Baseline for future migrations: if this changes, add a new Dexie version instead of editing v2.
  it('has the v2 schema', async () => {
    const db = new JobLogDB(name);
    await db.open();
    expect(db.verno).toBe(2);
    const table = db.applications.schema;
    expect(table.primKey.name).toBe('id');
    expect(table.indexes.map((i) => i.name).sort()).toEqual([
      'appliedAt',
      'companyTitleKey',
      'status',
      'updatedAt',
      'urlNormalized',
    ]);
    db.close();
  });

  describe('v1 → v2 migration', () => {
    async function migrate() {
      const v1 = openV1(name);
      await v1.table('applications').bulkAdd(v1Rows);
      v1.close();
      const db = new JobLogDB(name);
      await db.open();
      return db;
    }

    it('upgrades a v1 database and keeps every original field unchanged', async () => {
      const db = await migrate();
      expect(db.verno).toBe(2);
      for (const original of v1Rows) {
        expect(await db.applications.get(original.id)).toMatchObject(original);
      }
      expect(await db.applications.count()).toBe(v1Rows.length);
      db.close();
    });

    it('backfills urlNormalized and companyTitleKey', async () => {
      const db = await migrate();
      expect(await db.applications.get('with-title')).toMatchObject({
        urlNormalized: 'https://boards.greenhouse.io/acme/jobs/1?gh_jid=1',
        companyTitleKey: 'acme\u001fsenior engineer',
      });
      const noTitle = await db.applications.get('no-title');
      expect(noTitle?.urlNormalized).toBe('https://jobs.lever.co/beta/123');
      expect(noTitle).not.toHaveProperty('companyTitleKey');
      expect((await db.applications.get('invalid-url'))?.urlNormalized).toBe('javascript:alert(1)');
      const malformed = await db.applications.get('malformed');
      expect(malformed?.urlNormalized).toBe('');
      expect(malformed).not.toHaveProperty('companyTitleKey');
      db.close();
    });

    it('makes the new indexes queryable, including for soft-deleted rows', async () => {
      const db = await migrate();
      const byUrl = await db.applications
        .where('urlNormalized')
        .equals('https://boards.greenhouse.io/acme/jobs/1?gh_jid=1')
        .primaryKeys();
      expect(byUrl).toEqual(['with-title']);
      const byKey = await db.applications
        .where('companyTitleKey')
        .equals('gone\u001fold role')
        .primaryKeys();
      expect(byKey).toEqual(['deleted']);
      db.close();
    });

    it('migrates an empty v1 database', async () => {
      const v1 = openV1(name);
      await v1.open();
      v1.close();
      const db = new JobLogDB(name);
      await db.open();
      expect(db.verno).toBe(2);
      expect(await db.applications.count()).toBe(0);
      db.close();
    });
  });

  describe('derived-field hooks', () => {
    let db: JobLogDB;
    beforeEach(() => {
      db = new JobLogDB(name);
    });
    afterEach(() => db.close());

    const row = {
      id: 'h1',
      url: 'http://acme.com/jobs/1?utm_source=x',
      urlNormalized: 'stale',
      companyTitleKey: 'stale',
      company: 'Acme',
      title: 'Engineer',
      status: 'applied' as const,
      statusHistory: [],
      createdAt: AT,
      updatedAt: AT,
    };

    it('computes derived fields on add, ignoring what the caller passed', async () => {
      await db.applications.add(row);
      expect(await db.applications.get('h1')).toMatchObject({
        urlNormalized: 'https://acme.com/jobs/1',
        companyTitleKey: 'acme\u001fengineer',
      });
    });

    it('recomputes on update when url, company or title change', async () => {
      await db.applications.add(row);
      await db.applications.update('h1', { url: 'https://acme.com/jobs/2/' });
      expect((await db.applications.get('h1'))?.urlNormalized).toBe('https://acme.com/jobs/2');
      await db.applications.update('h1', { company: 'Beta' });
      expect((await db.applications.get('h1'))?.companyTitleKey).toBe('beta\u001fengineer');
    });

    it('removes the company + title key when the title is cleared', async () => {
      await db.applications.add(row);
      await db.applications.update('h1', { title: undefined });
      // Dexie stores a hook's undefined as an undefined-valued property; the index skips it.
      expect((await db.applications.get('h1'))?.companyTitleKey).toBeUndefined();
      expect(
        await db.applications.where('companyTitleKey').equals('acme\u001fengineer').count(),
      ).toBe(0);
    });

    it('recomputes on put and modify too', async () => {
      await db.applications.add(row);
      await db.applications.put({ ...row, url: 'https://acme.com/jobs/3', urlNormalized: 'x' });
      expect((await db.applications.get('h1'))?.urlNormalized).toBe('https://acme.com/jobs/3');
      await db.applications.where('id').equals('h1').modify({ title: 'Designer' });
      expect((await db.applications.get('h1'))?.companyTitleKey).toBe('acme\u001fdesigner');
    });

    it('leaves derived fields alone when unrelated fields change', async () => {
      await db.applications.add(row);
      await db.applications.update('h1', { status: 'screening' });
      expect((await db.applications.get('h1'))?.urlNormalized).toBe('https://acme.com/jobs/1');
    });
  });

  it('keeps data after the database is closed and reopened', async () => {
    const first = new JobLogDB(name);
    await first.applications.add({
      id: 'a1',
      url: 'https://example.com/jobs/1',
      urlNormalized: 'https://example.com/jobs/1',
      company: 'Acme',
      status: 'applied',
      statusHistory: [{ status: 'applied', at: AT }],
      appliedAt: '2026-10-15',
      createdAt: AT,
      updatedAt: AT,
    });
    first.close();

    const second = new JobLogDB(name);
    expect(await second.applications.get('a1')).toMatchObject({ company: 'Acme' });
    second.close();
  });
});
