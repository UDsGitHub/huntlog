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
