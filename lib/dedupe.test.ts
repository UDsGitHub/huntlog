import { addApplication } from './applications';
import { JobLogDB } from './db';
import { companyTitleKey, findDuplicates } from './dedupe';

describe('companyTitleKey', () => {
  it('ignores case, surrounding and repeated whitespace', () => {
    expect(companyTitleKey('  ACME  Corp ', 'Senior\n\tEngineer')).toBe(
      companyTitleKey('acme corp', 'senior engineer'),
    );
  });

  it('ignores Unicode form differences', () => {
    // Full-width letters and a decomposed é normalize to the same key under NFKC.
    expect(companyTitleKey('Ａｃｍｅ', 'Ingénieur')).toBe(companyTitleKey('Acme', 'Ingénieur'));
  });

  it('keeps company and title apart', () => {
    expect(companyTitleKey('Acme Senior', 'Engineer')).not.toBe(
      companyTitleKey('Acme', 'Senior Engineer'),
    );
  });

  it('cannot be forged with the separator character', () => {
    expect(companyTitleKey('Acme\u001fSenior', 'Engineer')).not.toBe(
      companyTitleKey('Acme', 'Senior\u001fEngineer'),
    );
  });

  it.each([[undefined], [''], ['   ']])('is undefined without a title (%j)', (title) => {
    expect(companyTitleKey('Acme', title)).toBeUndefined();
  });

  it('is undefined without a company', () => {
    expect(companyTitleKey('  ', 'Engineer')).toBeUndefined();
  });
});

describe('findDuplicates', () => {
  let db: JobLogDB;
  beforeEach(() => {
    db = new JobLogDB(`test-${crypto.randomUUID()}`);
  });
  afterEach(async () => {
    await db.delete();
  });

  const add = (url: string, company: string, title?: string, now?: Date) =>
    addApplication({ url, company, title }, db, now);

  it('matches a URL that differs only in tracking parameters', async () => {
    const existing = await add('https://boards.greenhouse.io/acme/jobs/1?gh_jid=1', 'Acme');
    const found = await findDuplicates(db, {
      url: 'http://boards.greenhouse.io/acme/jobs/1/?utm_source=li&gh_src=x&gh_jid=1',
      company: 'Someone else',
    });
    expect(found.map((a) => a.id)).toEqual([existing.id]);
  });

  it('matches company + title regardless of case and spacing', async () => {
    const existing = await add('https://a.com/1', 'Acme', 'Senior Engineer');
    const found = await findDuplicates(db, {
      url: 'https://b.com/2',
      company: ' acme ',
      title: 'SENIOR   engineer',
    });
    expect(found.map((a) => a.id)).toEqual([existing.id]);
  });

  it('does not match the same company with a different title', async () => {
    await add('https://a.com/1', 'Acme', 'Senior Engineer');
    expect(
      await findDuplicates(db, { url: 'https://b.com/2', company: 'Acme', title: 'Designer' }),
    ).toEqual([]);
  });

  it('does not match on company alone when titles are missing', async () => {
    await add('https://a.com/1', 'Acme');
    expect(await findDuplicates(db, { url: 'https://b.com/2', company: 'Acme' })).toEqual([]);
  });

  it('excludes soft-deleted rows', async () => {
    const gone = await add('https://a.com/1', 'Acme', 'Engineer');
    await db.applications.update(gone.id, { deletedAt: new Date().toISOString() });
    expect(
      await findDuplicates(db, { url: 'https://a.com/1', company: 'Acme', title: 'Engineer' }),
    ).toEqual([]);
  });

  it('excludes the record being edited', async () => {
    const self = await add('https://a.com/1', 'Acme', 'Engineer');
    expect(
      await findDuplicates(
        db,
        { url: 'https://a.com/1', company: 'Acme', title: 'Engineer' },
        { excludeId: self.id },
      ),
    ).toEqual([]);
  });

  it('lists a record matching both ways once, newest first', async () => {
    const older = await add(
      'https://a.com/1',
      'Acme',
      'Engineer',
      new Date('2026-10-01T00:00:00Z'),
    );
    const newer = await add(
      'https://c.com/3',
      'Acme',
      'Engineer',
      new Date('2026-10-05T00:00:00Z'),
    );
    const found = await findDuplicates(db, {
      url: 'https://a.com/1',
      company: 'Acme',
      title: 'Engineer',
    });
    expect(found.map((a) => a.id)).toEqual([newer.id, older.id]);
  });

  it('returns nothing for an empty database', async () => {
    expect(await findDuplicates(db, { url: 'https://a.com', company: 'Acme' })).toEqual([]);
  });
});
