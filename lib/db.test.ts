import { JobLogDB } from './db';

describe('JobLogDB', () => {
  let name: string;
  beforeEach(() => {
    name = `test-${crypto.randomUUID()}`;
  });
  afterEach(async () => {
    await new JobLogDB(name).delete();
  });

  // Baseline for future migrations: if this changes, add a new Dexie version instead of editing v1.
  it('has the v1 schema', async () => {
    const db = new JobLogDB(name);
    await db.open();
    expect(db.verno).toBe(1);
    const table = db.applications.schema;
    expect(table.primKey.name).toBe('id');
    expect(table.indexes.map((i) => i.name).sort()).toEqual(['appliedAt', 'status', 'updatedAt']);
    db.close();
  });

  it('keeps data after the database is closed and reopened', async () => {
    const first = new JobLogDB(name);
    await first.applications.add({
      id: 'a1',
      url: 'https://example.com/jobs/1',
      company: 'Acme',
      status: 'applied',
      statusHistory: [{ status: 'applied', at: '2026-10-15T12:00:00.000Z' }],
      appliedAt: '2026-10-15',
      createdAt: '2026-10-15T12:00:00.000Z',
      updatedAt: '2026-10-15T12:00:00.000Z',
    });
    first.close();

    const second = new JobLogDB(name);
    expect(await second.applications.get('a1')).toMatchObject({ company: 'Acme' });
    second.close();
  });
});
