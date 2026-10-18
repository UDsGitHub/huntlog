import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  addApplication,
  findDuplicates,
  setStatus,
  softDeleteApplication,
  updateApplication,
} from './applications';
import { backupBlob, collectBackup, toBase64, type BackupContents } from './backup';
import {
  countLiveData,
  mergeBackup,
  parseBackup,
  replaceWithBackup,
  SettingsRestoreError,
  type CheckedBackup,
} from './backupImport';
import { JobLogDB } from './db';
import { FORM_DEFAULTS_KEY } from './formDefaults';
import { addResume, setResumeArchived, type PickedFile } from './resumes';
import { readSettings, updateSettings } from './settings';
import type { Application } from './types';

let db: JobLogDB;
let other: JobLogDB;
beforeEach(() => {
  fakeBrowser.reset();
  db = new JobLogDB(`test-${crypto.randomUUID()}`);
  other = new JobLogDB(`test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
  await other.delete();
});

const PDF_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d, 0, 255, 128];
const DOCX_BYTES = [0x50, 0x4b, 3, 4, 9, 9];
const file = (name: string, bytes: number[]): PickedFile => ({
  name,
  size: bytes.length,
  arrayBuffer: async () => new Uint8Array(bytes).buffer,
});

const asText = async (contents: BackupContents) => backupBlob(contents).text();

/** Parses, failing the test with the errors if the file is refused. */
function parsed(text: string): CheckedBackup {
  const result = parseBackup(text);
  if ('errors' in result) throw new Error(result.errors.join('\n'));
  return result.backup;
}

/** A backup file written by hand, for the checks. */
function backupText(overrides: {
  applications?: unknown[];
  resumes?: unknown[];
  [key: string]: unknown;
}): string {
  return JSON.stringify({
    format: 'huntlog-backup',
    version: 1,
    exportedAt: '2026-10-18T12:00:00.000Z',
    settings: {},
    applications: [],
    resumes: [],
    ...overrides,
  });
}

const T = '2026-10-01T10:00:00.000Z';
const appRecord = (fields: Record<string, unknown> = {}) => ({
  id: 'a1',
  url: 'https://acme.com/jobs/1',
  company: 'Acme',
  status: 'applied',
  statusHistory: [{ status: 'applied', at: T }],
  appliedAt: '2026-10-01',
  createdAt: T,
  updatedAt: T,
  ...fields,
});
const resumeRecord = (fields: Record<string, unknown> = {}) => ({
  id: 'r1',
  name: 'Backend v3',
  fileName: 'Backend v3.pdf',
  mimeType: 'application/pdf',
  size: PDF_BYTES.length,
  archived: false,
  createdAt: T,
  updatedAt: T,
  file: toBase64(new Uint8Array(PDF_BYTES).buffer),
  ...fields,
});

/** Everything stored, files as plain byte arrays, for comparing two databases. */
async function snapshot(database: JobLogDB) {
  const files = await database.resumeFiles.toArray();
  return {
    applications: await database.applications.orderBy('id').toArray(),
    resumes: await database.resumes.orderBy('id').toArray(),
    files: files
      .map((f) => ({ id: f.id, bytes: [...new Uint8Array(f.data)] }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

async function seed(database: JobLogDB) {
  const pdf = await addResume(file('Backend v3.pdf', PDF_BYTES), { note: 'Main one' }, database);
  const docx = await addResume(file('Old.docx', DOCX_BYTES), {}, database);
  const acme = await addApplication(
    {
      url: 'https://acme.com/jobs/1?utm_source=x',
      company: 'Acme',
      title: 'Backend Engineer',
      resumeId: pdf.id,
      location: 'Berlin',
      workMode: 'hybrid',
      salaryMin: 85000,
      salaryMax: 95000.5,
      salaryCurrency: 'EUR',
      salaryPeriod: 'year',
      source: 'LinkedIn',
      notes: 'Line one\nLine two',
    },
    database,
  );
  await setStatus(acme.id, 'interviewing', {}, database);
  await addApplication(
    { url: 'https://globex.com/1', company: 'Globex', status: 'saved', resumeId: docx.id },
    database,
  );
  await setResumeArchived(docx.id, true, database);
  return { pdf, docx, acme };
}

describe('round trip (spec §10)', () => {
  it('Replace on a fresh database gives identical data, files and settings', async () => {
    await seed(db);
    await updateSettings({ theme: 'dark', weeklyGoal: 7, weekStartsOn: 1 });
    const text = await asText(await collectBackup(db));

    fakeBrowser.reset();
    await replaceWithBackup(parsed(text), other);
    expect(await snapshot(other)).toEqual(await snapshot(db));
    expect(await readSettings()).toMatchObject({ theme: 'dark', weeklyGoal: 7, weekStartsOn: 1 });
    // Derived fields are recomputed, so duplicate detection works on the restored rows.
    expect(
      await findDuplicates({ url: 'https://acme.com/jobs/1', company: 'x' }, {}, other),
    ).toHaveLength(1);
  });
});

describe('parseBackup', () => {
  it.each([
    ['not JSON', '{', 'This file isn’t valid JSON.'],
    ['another file', JSON.stringify({ hello: 1 }), 'This isn’t a Huntlog backup.'],
    ['a JSON array', '[]', 'This isn’t a Huntlog backup.'],
    [
      'a newer version',
      backupText({ version: 2 }),
      'This backup is from a newer version of Huntlog. Update Huntlog, then try again.',
    ],
    ['no version', backupText({ version: 'one' }), 'This backup has no valid version.'],
    [
      'missing lists',
      backupText({ applications: undefined }),
      'This backup is missing its applications or resumes.',
    ],
  ])('refuses %s', (_label, text, error) => {
    expect(parseBackup(text)).toEqual({ errors: [error] });
  });

  it.each([
    [{ url: 'javascript:alert(1)' }, 'has a job posting URL that isn’t a web address'],
    [{ url: 'ftp://acme.com/1' }, 'has a job posting URL that isn’t a web address'],
    [{ company: '  ' }, 'has no company'],
    [{ status: 'pending' }, 'has an unknown status'],
    [{ statusHistory: [] }, 'has an invalid status history'],
    [{ statusHistory: [{ status: 'applied', at: 'yesterday' }] }, 'has an invalid status history'],
    [{ updatedAt: '2026-10-01' }, 'has an invalid updatedAt'],
    [{ appliedAt: '2026-02-30' }, 'has an invalid Date applied'],
    [{ workMode: 'moon' }, 'has an unknown work mode'],
    [{ salaryMin: -1 }, 'has an invalid salaryMin'],
    [{ salaryMax: '85000' }, 'has an invalid salaryMax'],
    [{ salaryCurrency: 'euro' }, 'has an invalid currency'],
    [{ salaryPeriod: 'week' }, 'has an unknown salary period'],
    [{ location: 'x'.repeat(201) }, 'has a location that’s too long'],
    [{ notes: 42 }, 'has an invalid notes'],
    [{ id: '' }, 'has no valid id'],
    [{ status: 'offer' }, 'has a status history that doesn’t end at its status'],
    [{ appliedAt: '2099-01-01' }, 'has an invalid Date applied'],
    [{ salaryMin: 200000, salaryMax: 50000 }, 'has a minimum salary above its maximum'],
    [{ salaryCurrency: 'ZZZ' }, 'has an invalid currency'],
    [{ url: `https://acme.com/${'x'.repeat(2048)}` }, 'has a job posting URL that isn’t'],
    [{ title: 'x'.repeat(301) }, 'has a title that’s too long'],
  ])('refuses an application with %j', (fields, problem) => {
    const result = parseBackup(backupText({ applications: [appRecord(fields)] }));
    expect(result).toEqual({ errors: [expect.stringContaining(problem)] });
    expect((result as { errors: string[] }).errors[0]).toMatch(/^Application 1 /);
  });

  it.each([
    [{ file: 'not base64!' }, 'has a file that can’t be read'],
    [
      { file: toBase64(new Uint8Array(DOCX_BYTES).buffer) },
      "has a file that’s not valid (This file doesn't look like a PDF",
    ],
    [{ mimeType: 'text/html' }, 'isn’t a PDF, DOCX, DOC, TXT or RTF file'],
    [{ fileName: 'cv.exe', mimeType: 'application/pdf' }, 'isn’t a PDF, DOCX, DOC, TXT or RTF'],
    [{ name: '' }, 'has no valid name'],
    [{ archived: 'no' }, 'has an invalid archived flag'],
    [{ note: 'x'.repeat(501) }, 'has an invalid note'],
    [{ file: null, size: -3 }, 'has an invalid size'],
  ])('refuses a resume with %j', (fields, problem) => {
    expect(parseBackup(backupText({ resumes: [resumeRecord(fields)] }))).toEqual({
      errors: [expect.stringContaining(problem)],
    });
  });

  it('refuses a file over 10 MB', () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(PDF_BYTES);
    expect(
      parseBackup(backupText({ resumes: [resumeRecord({ file: toBase64(big.buffer) })] })),
    ).toEqual({ errors: [expect.stringContaining('10 MB or less')] });
  });

  it('lists every problem, naming each record, and refuses repeated ids', () => {
    const result = parseBackup(
      backupText({
        applications: [
          appRecord(),
          appRecord({ company: 'Globex' }),
          appRecord({ id: 'a3', company: 'Initech', status: 'nope' }),
        ],
        resumes: [resumeRecord(), resumeRecord({ name: 'Copy' })],
      }),
    );
    expect(result).toEqual({
      errors: [
        'Application 2 (Globex) repeats an earlier id.',
        'Application 3 (Initech) has an unknown status.',
        'Resume 2 (Copy) repeats an earlier id.',
      ],
    });
  });

  it('takes null as absent, drops unknown fields and recomputes derived ones', () => {
    const backup = parsed(
      backupText({
        applications: [
          appRecord({
            title: 'Engineer',
            location: null,
            urlNormalized: 'https://evil.example/',
            companyTitleKey: 'wrong',
            extra: 'dropped',
          }),
        ],
        resumes: [resumeRecord({ note: null, size: 999, extra: true })],
      }),
    );
    const [app] = backup.applications;
    expect(app).not.toHaveProperty('location');
    expect(app).not.toHaveProperty('extra');
    expect(app!.urlNormalized).toBe('https://acme.com/jobs/1');
    expect(app!.companyTitleKey).not.toBe('wrong');
    expect(app!.companyTitleKey).toBeTruthy();
    // The size is the file's, not what the file claims.
    expect(backup.resumes[0]!.resume.size).toBe(PDF_BYTES.length);
    expect(backup.resumes[0]!.resume).not.toHaveProperty('extra');
  });

  it('keeps a stored Date-applied-less job past Saved (Skip) and a resume without a file', () => {
    const backup = parsed(
      backupText({
        applications: [
          appRecord({
            status: 'interviewing',
            statusHistory: [
              { status: 'saved', at: T },
              { status: 'interviewing', at: T },
            ],
            appliedAt: undefined,
          }),
        ],
        resumes: [resumeRecord({ file: null })],
      }),
    );
    expect(backup.applications[0]).not.toHaveProperty('appliedAt');
    expect(backup.resumes[0]!.file).toBeNull();
    expect(backup.resumes[0]!.resume.size).toBe(PDF_BYTES.length);
  });

  it('takes a Date applied of tomorrow (a backup made a time zone ahead) and trims the company', () => {
    const now = new Date(2026, 9, 18, 9);
    const backup = parseBackup(
      backupText({ applications: [appRecord({ appliedAt: '2026-10-19', company: ' Acme ' })] }),
      now,
    );
    expect('backup' in backup && backup.backup.applications[0]).toMatchObject({
      appliedAt: '2026-10-19',
      company: 'Acme',
    });
  });

  it('keeps only valid settings', () => {
    const backup = parsed(
      backupText({ settings: { theme: 'dark', weeklyGoal: 500, weekStartsOn: 6 } }),
    );
    expect(backup.settings).toEqual({ theme: 'dark', weekStartsOn: 6 });
  });
});

describe('mergeBackup', () => {
  const stored = (id: string) => db.applications.get(id) as Promise<Application>;

  it('takes the newer record by updatedAt, keeps the stored one on a tie, and adds new ones', async () => {
    await db.applications.bulkAdd([
      {
        ...parsed(backupText({ applications: [appRecord({ id: 'older', company: 'Old' })] }))
          .applications[0]!,
      },
      {
        ...parsed(
          backupText({
            applications: [
              appRecord({ id: 'newer', company: 'Kept', updatedAt: '2026-10-05T00:00:00.000Z' }),
            ],
          }),
        ).applications[0]!,
      },
      {
        ...parsed(backupText({ applications: [appRecord({ id: 'tie', company: 'Mine' })] }))
          .applications[0]!,
      },
    ]);
    const counts = await mergeBackup(
      parsed(
        backupText({
          applications: [
            appRecord({
              id: 'older',
              company: 'Updated',
              title: 'Engineer',
              updatedAt: '2026-10-02T00:00:00.000Z',
            }),
            appRecord({ id: 'newer', company: 'Stale' }),
            appRecord({ id: 'tie', company: 'Theirs' }),
            appRecord({ id: 'fresh', company: 'Fresh' }),
          ],
        }),
      ),
      db,
    );
    expect(counts).toEqual({ applications: 2, resumes: 0, changed: true });
    expect((await stored('older')).company).toBe('Updated');
    expect((await stored('newer')).company).toBe('Kept');
    expect((await stored('tie')).company).toBe('Mine');
    expect((await stored('fresh')).company).toBe('Fresh');
    // The winner's derived fields follow its new company and title.
    expect(
      (
        await findDuplicates(
          { url: 'https://x.com', company: 'updated', title: 'engineer' },
          {},
          db,
        )
      ).map((a) => a.id),
    ).toEqual(['older']);
  });

  it('brings back a row deleted here before the backup’s newer change, not after', async () => {
    const kept = await addApplication(
      { url: 'https://acme.com/1', company: 'Acme' },
      db,
      new Date('2026-10-01T00:00:00Z'),
    );
    const gone = await addApplication(
      { url: 'https://acme.com/2', company: 'Acme' },
      db,
      new Date('2026-10-01T00:00:00Z'),
    );
    await softDeleteApplication(kept.id, db, new Date('2026-10-03T00:00:00Z'));
    await softDeleteApplication(gone.id, db, new Date('2026-10-03T00:00:00Z'));
    await mergeBackup(
      parsed(
        backupText({
          applications: [
            appRecord({ id: kept.id, updatedAt: '2026-10-02T00:00:00.000Z' }),
            appRecord({ id: gone.id, updatedAt: '2026-10-04T00:00:00.000Z' }),
          ],
        }),
      ),
      db,
    );
    expect((await stored(kept.id)).deletedAt).toBeDefined();
    expect((await stored(gone.id)).deletedAt).toBeUndefined();
  });

  it('merges resumes with their files, keeps a stored file the backup lacks, and leaves the settings', async () => {
    await updateSettings({ theme: 'light' });
    const mine = await addResume(
      file('Mine.pdf', PDF_BYTES),
      {},
      db,
      new Date('2026-10-01T00:00:00Z'),
    );
    const newBytes = [...PDF_BYTES, 7, 7];
    await mergeBackup(
      parsed(
        backupText({
          settings: { theme: 'dark' },
          resumes: [
            resumeRecord({
              id: mine.id,
              name: 'Renamed',
              fileName: 'Mine.pdf',
              file: null,
              updatedAt: '2026-10-09T00:00:00.000Z',
            }),
            resumeRecord({ id: 'r2', file: toBase64(new Uint8Array(newBytes).buffer) }),
          ],
        }),
      ),
      db,
    );
    expect((await db.resumes.get(mine.id))!.name).toBe('Renamed');
    expect([...new Uint8Array((await db.resumeFiles.get(mine.id))!.data)]).toEqual(PDF_BYTES);
    expect([...new Uint8Array((await db.resumeFiles.get('r2'))!.data)]).toEqual(newBytes);
    expect((await readSettings()).theme).toBe('light');
  });

  it('counts only what the user will see, and says when nothing changed', async () => {
    const backup = parsed(
      backupText({
        applications: [appRecord({ deletedAt: T }), appRecord({ id: 'a2', company: 'Live' })],
      }),
    );
    expect(await mergeBackup(backup, db)).toEqual({ applications: 1, resumes: 0, changed: true });
    expect(await mergeBackup(backup, db)).toEqual({ applications: 0, resumes: 0, changed: false });
  });

  it('keeps a link to a resume stored here or in the backup, and drops one to neither', async () => {
    const mine = await addResume(file('Mine.pdf', PDF_BYTES), {}, db);
    await mergeBackup(
      parsed(
        backupText({
          applications: [
            appRecord({ id: 'here', resumeId: mine.id, resumeNameSnapshot: 'Mine' }),
            appRecord({ id: 'backup', resumeId: 'r1', resumeNameSnapshot: 'Backend v3' }),
            appRecord({ id: 'nowhere', resumeId: 'gone', resumeNameSnapshot: 'Gone' }),
          ],
          resumes: [resumeRecord()],
        }),
      ),
      db,
    );
    expect((await stored('here')).resumeId).toBe(mine.id);
    expect((await stored('backup')).resumeId).toBe('r1');
    expect(await stored('nowhere')).not.toHaveProperty('resumeId');
    expect((await stored('nowhere')).resumeNameSnapshot).toBe('Gone');
  });

  it('writes nothing when a write fails part way', async () => {
    await db.applications.add(
      parsed(backupText({ applications: [appRecord({ company: 'Before' })] })).applications[0]!,
    );
    vi.spyOn(db.resumes, 'bulkPut').mockRejectedValue(new Error('disk full'));
    await expect(
      mergeBackup(
        parsed(
          backupText({
            applications: [appRecord({ company: 'After', updatedAt: '2026-10-09T00:00:00.000Z' })],
            resumes: [resumeRecord()],
          }),
        ),
        db,
      ),
    ).rejects.toThrow();
    expect((await stored('a1')).company).toBe('Before');
  });
});

describe('replaceWithBackup', () => {
  it('replaces every row, deleted ones too, restores the settings and clears the form defaults', async () => {
    const { acme } = await seed(db);
    await softDeleteApplication(acme.id, db);
    await updateSettings({ theme: 'dark', weeklyGoal: 3 });
    await fakeBrowser.storage.local.set({ [FORM_DEFAULTS_KEY]: { source: 'LinkedIn' } });
    await replaceWithBackup(
      parsed(
        backupText({
          settings: { weekStartsOn: 0 },
          applications: [appRecord()],
          resumes: [resumeRecord()],
        }),
      ),
      db,
    );
    expect((await db.applications.toArray()).map((a) => a.id)).toEqual(['a1']);
    expect((await db.resumes.toArray()).map((r) => r.id)).toEqual(['r1']);
    expect((await db.resumeFiles.toArray()).map((f) => f.id)).toEqual(['r1']);
    // Settings the backup doesn't hold go back to their defaults.
    const settings = await readSettings();
    expect(settings.theme).toBe('system');
    expect(settings.weeklyGoal).toBeUndefined();
    expect(settings.weekStartsOn).toBe(0);
    expect(await fakeBrowser.storage.local.get(FORM_DEFAULTS_KEY)).toEqual({});
  });

  it('changes nothing when writing the data fails', async () => {
    await seed(db);
    const before = await snapshot(db);
    vi.spyOn(db.resumeFiles, 'bulkAdd').mockRejectedValue(new Error('disk full'));
    await updateSettings({ theme: 'dark' });
    await expect(
      replaceWithBackup(
        parsed(backupText({ applications: [appRecord()], resumes: [resumeRecord()] })),
        db,
      ),
    ).rejects.toThrow();
    expect(await snapshot(db)).toEqual(before);
    expect((await readSettings()).theme).toBe('dark');
  });

  it('says so when the data is replaced but the settings aren’t', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValue(new Error('broken'));
    await expect(
      replaceWithBackup(
        parsed(backupText({ settings: { theme: 'dark' }, applications: [appRecord()] })),
        db,
      ),
    ).rejects.toBeInstanceOf(SettingsRestoreError);
    expect(await db.applications.count()).toBe(1);
  });

  it('succeeds when only clearing the form defaults fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(fakeBrowser.storage.local, 'remove').mockRejectedValue(new Error('broken'));
    await expect(
      replaceWithBackup(
        parsed(backupText({ settings: { theme: 'dark', weeklyGoal: 4, weekStartsOn: 1 } })),
        db,
      ),
    ).resolves.toBeUndefined();
    expect((await readSettings()).theme).toBe('dark');
  });

  it('drops a link to a resume the backup doesn’t hold, keeping its name', async () => {
    await replaceWithBackup(
      parsed(
        backupText({
          applications: [appRecord({ resumeId: 'gone', resumeNameSnapshot: 'Gone' })],
        }),
      ),
      db,
    );
    const [app] = await db.applications.toArray();
    expect(app).not.toHaveProperty('resumeId');
    expect(app!.resumeNameSnapshot).toBe('Gone');
  });
});

describe('countLiveData', () => {
  it('counts live applications and resumes only', async () => {
    const { acme } = await seed(db);
    await softDeleteApplication(acme.id, db);
    await updateApplication(
      (await addApplication({ url: 'https://x.com/1', company: 'X' }, db)).id,
      { url: 'https://x.com/1', company: 'Y' },
      db,
    );
    expect(await countLiveData(db)).toEqual({ applications: 2, resumes: 2 });
  });
});
