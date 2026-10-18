import { fakeBrowser } from 'wxt/testing/fake-browser';
import { addApplication, listApplications } from './applications';
import { applicationsCsv, CSV_COLUMNS } from './applicationsCsv';
import { BOM, toCsv } from './csv';
import { importCsvRows, planCsvImport, type CsvContext, type CsvPlan } from './csvImport';
import { JobLogDB } from './db';
import { addResume, listResumes, setResumeArchived } from './resumes';
import { setStatus } from './applications';

let db: JobLogDB;
beforeEach(() => {
  fakeBrowser.reset();
  db = new JobLogDB(`test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
});

const NOW = new Date(2026, 9, 18, 9, 0);
const empty: CsvContext = { applications: [], resumes: [], now: NOW, locale: 'en-US' };

const csv = (header: string[], ...rows: string[][]) => toCsv([header, ...rows]);
const HEADER = ['Company', 'URL', 'Status', 'Date applied'];

function plan(text: string, context: CsvContext = empty): CsvPlan {
  const result = planCsvImport(text, context);
  if ('error' in result) throw new Error(result.error);
  return result.plan;
}

describe('planCsvImport', () => {
  it('reads what the export writes back into the same applications', async () => {
    const resume = await addResume(
      {
        name: 'Backend v3.pdf',
        size: 5,
        arrayBuffer: async () => new Uint8Array([37, 80, 68, 70, 45]).buffer,
      },
      {},
      db,
    );
    const acme = await addApplication(
      {
        url: 'https://acme.com/jobs/1',
        company: '=Acme, Inc.',
        title: 'Backend "Platform" Engineer',
        status: 'interviewing',
        appliedAt: '2026-10-01',
        location: 'München',
        workMode: 'onsite',
        salaryMin: 85000,
        salaryMax: 95000.5,
        salaryCurrency: 'EUR',
        salaryPeriod: 'month',
        source: 'Referral',
        notes: '-5 years\nLine two',
        resumeId: resume.id,
      },
      db,
      new Date(2026, 9, 2, 9),
    );
    const text = applicationsCsv([acme], [resume]);
    // Read in another locale too: the file is locale-free.
    const { rows, skipped } = plan(text, {
      applications: [],
      resumes: [resume],
      now: NOW,
      locale: 'de-DE',
    });
    expect(skipped).toEqual([]);
    const [{ application, warnings, duplicate }] = rows as [CsvPlan['rows'][number]];
    expect(warnings).toEqual([]);
    expect(duplicate).toBe(false);
    const fields: Partial<typeof acme> = { ...acme };
    delete fields.id;
    delete fields.statusHistory;
    expect(application).toMatchObject(fields);
    expect(application.id).not.toBe(acme.id);
    expect(application.statusHistory).toEqual([
      { status: 'interviewing', at: new Date(2026, 9, 1, 12).toISOString() },
    ]);
  });

  it('takes columns in any order, any case, and leaves out what’s missing', () => {
    const { rows, ignoredColumns } = plan(
      csv(['url', 'COMPANY', 'Favourite colour'], ['acme.com/jobs/1', 'Acme', 'blue']),
    );
    expect(ignoredColumns).toEqual(['Favourite colour']);
    expect(rows[0]!.application).toMatchObject({
      url: 'https://acme.com/jobs/1',
      company: 'Acme',
      status: 'applied',
    });
    // Without a Date applied, it isn't given today's: it stays undated (like Skip).
    expect(rows[0]!.application).not.toHaveProperty('appliedAt');
  });

  it('needs Company and URL columns', () => {
    expect(planCsvImport(csv(['Company', 'Title'], ['Acme', 'x']), empty)).toEqual({
      error: 'The file needs a Company and a URL column. Download the template to see them all.',
    });
  });

  it.each([
    ['an empty file', ''],
    ['only a header', `${BOM}${csv(CSV_COLUMNS as unknown as string[])}`],
    ['only blank rows', csv(HEADER, ['', '', '', ''], ['', ' ', '', ''])],
  ])('refuses %s', (_label, text) => {
    expect(planCsvImport(text, empty)).toHaveProperty('error');
  });

  it('reports a quote that never closes', () => {
    expect(planCsvImport('Company,URL\r\n"Acme,x', empty)).toEqual({
      error: 'A quoted value starting on line 2 never ends.',
    });
  });

  it('maps an unknown status to Applied, with a warning', () => {
    const { rows } = plan(csv(HEADER, ['Acme', 'acme.com/1', 'Pending', '2026-10-01']));
    expect(rows[0]!.application.status).toBe('applied');
    expect(rows[0]!.warnings).toEqual(['Unknown status “Pending”, imported as Applied.']);
  });

  it('matches statuses, work modes and periods by label or value, ignoring case', () => {
    const { rows } = plan(
      csv(
        ['Company', 'URL', 'Status', 'Date applied', 'Work mode', 'Salary min', 'Per'],
        ['A', 'a.com/1', 'INTERVIEWING', '2026-10-01', 'on site', '1', 'HOUR'],
        ['B', 'b.com/1', 'ghosted', '2026-10-01', 'Onsite', '2', 'year'],
      ),
    );
    expect(rows.map(({ application: a }) => [a.status, a.workMode, a.salaryPeriod])).toEqual([
      ['interviewing', 'onsite', 'hour'],
      ['ghosted', 'onsite', 'year'],
    ]);
  });

  it('skips rows with errors, naming the column, and numbers rows as a spreadsheet does', () => {
    const { rows, skipped } = plan(
      csv(
        ['Company', 'URL', 'Date applied', 'Work mode', 'Salary min', 'Salary max', 'Notes'],
        ['Good', 'good.com/1', '2026-10-01', '', '', '', 'two\nlines'],
        ['', 'nocompany.com/1', '2026-10-01', '', '', '', ''],
        ['Bad URL', 'javascript:alert(1)', '2026-10-01', '', '', '', ''],
        ['Future', 'future.com/1', '2099-01-01', '', '', '', ''],
        ['Mode', 'mode.com/1', '2026-10-01', 'Moon', '', '', ''],
        ['Salary', 'salary.com/1', '2026-10-01', '', '90000', '50000', ''],
        ['Ambiguous', 'amb.com/1', '2026-10-01', '', '85.000', '', ''],
      ),
    );
    expect(rows.map((row) => [row.row, row.application.company])).toEqual([[2, 'Good']]);
    expect(skipped).toEqual([
      { row: 3, reason: 'Company: Enter the company name.' },
      { row: 4, reason: 'URL: Enter a valid web address (http or https).' },
      { row: 5, reason: "Date applied: The date applied can't be in the future." },
      { row: 6, reason: 'Work mode: Choose remote, hybrid or on-site.' },
      { row: 7, reason: 'Salary max: Maximum must be at least the minimum.' },
      { row: 8, reason: 'Salary min: Enter a number, like 85,000.' },
    ]);
  });

  it('reads a salary in the locale’s own format too', () => {
    const { rows } = plan(
      csv(['Company', 'URL', 'Salary min', 'Currency'], ['Acme', 'acme.com/1', '85.000', 'EUR']),
      { ...empty, locale: 'de-DE' },
    );
    expect(rows[0]!.application.salaryMin).toBe(85000);
  });

  it('keeps a job past Saved without a date as undated, with a warning, and Saved without one', () => {
    const { rows } = plan(
      csv(HEADER, ['A', 'a.com/1', 'Interviewing', ''], ['B', 'b.com/1', 'Saved', '']),
    );
    expect(rows[0]!.application).not.toHaveProperty('appliedAt');
    expect(rows[0]!.warnings).toEqual([
      'No Date applied, so it isn’t counted in Applied or the rates.',
    ]);
    expect(rows[1]!.application).not.toHaveProperty('appliedAt');
    expect(rows[1]!.warnings).toEqual([]);
  });

  it('dates the status entry by Date applied, else Created, else now', () => {
    const { rows } = plan(
      csv(
        ['Company', 'URL', 'Status', 'Date applied', 'Created', 'Updated'],
        ['A', 'a.com/1', 'Offer', '2026-10-01', '', ''],
        ['B', 'b.com/1', 'Saved', '', '2026-09-01T08:00:00.000Z', '2026-09-02T08:00:00.000Z'],
        ['C', 'c.com/1', 'Saved', '', 'yesterday', ''],
      ),
    );
    expect(
      rows.map(({ application: a }) => [a.statusHistory[0]!.at, a.createdAt, a.updatedAt]),
    ).toEqual([
      [new Date(2026, 9, 1, 12).toISOString(), NOW.toISOString(), NOW.toISOString()],
      ['2026-09-01T08:00:00.000Z', '2026-09-01T08:00:00.000Z', '2026-09-02T08:00:00.000Z'],
      [NOW.toISOString(), NOW.toISOString(), NOW.toISOString()],
    ]);
  });

  it('links a resume by name (the newest of that name), else keeps the name only', () => {
    const resumes = [
      { id: 'archived', name: 'Backend v3', archived: true },
      { id: 'new', name: 'Backend v3', archived: false },
      { id: 'old', name: 'Backend v3', archived: false },
    ];
    const { rows } = plan(
      csv(
        ['Company', 'URL', 'Resume', 'Status'],
        ['A', 'a.com/1', 'backend V3', 'Saved'],
        ['B', 'b.com/1', 'Frontend', 'Saved'],
      ),
      { ...empty, resumes },
    );
    expect(rows[0]!.application).toMatchObject({
      resumeId: 'new',
      resumeNameSnapshot: 'Backend v3',
    });
    expect(rows[1]!.application).not.toHaveProperty('resumeId');
    expect(rows[1]!.application.resumeNameSnapshot).toBe('Frontend');
    expect(rows[1]!.warnings).toEqual([
      'No resume named “Frontend” in your library, so only its name is kept.',
    ]);
  });

  it('numbers rows as a spreadsheet does, counting blank lines but not line breaks in a cell', () => {
    const { skipped } = plan('Company,URL\r\n\r\n"Two\r\nlines",a.com/1\r\nBad,javascript:x\r\n');
    expect(skipped).toEqual([
      { row: 4, reason: 'URL: Enter a valid web address (http or https).' },
    ]);
  });

  it('reads a semicolon-separated file, as Excel saves one in many locales', () => {
    const { rows } = plan('Company;URL;Salary min\r\nAcme;acme.com/1;85000,5\r\n', {
      ...empty,
      locale: 'de-DE',
    });
    expect(rows[0]!.application).toMatchObject({ company: 'Acme', salaryMin: 85000.5 });
  });

  it.each([
    ['en-US', '3/1/2026', '2026-03-01'],
    ['en-US', '3/1/26 0:00', '2026-03-01'],
    ['en-GB', '01/03/2026', '2026-03-01'],
    ['de-DE', '01.03.2026', '2026-03-01'],
    ['en-US', '2026/3/1', '2026-03-01'],
  ])('reads a Date applied a spreadsheet rewrote (%s %s)', (locale, text, date) => {
    const { rows } = plan(csv(['Company', 'URL', 'Date applied'], ['A', 'a.com/1', text]), {
      ...empty,
      locale,
    });
    expect(rows[0]!.application.appliedAt).toBe(date);
  });

  it('skips a Date applied it can’t read', () => {
    const { skipped } = plan(
      csv(['Company', 'URL', 'Date applied'], ['A', 'a.com/1', '2/30/2026']),
    );
    expect(skipped).toEqual([{ row: 2, reason: 'Date applied: Enter a valid date.' }]);
  });

  it('reads Created and Updated leniently, never in the future or out of order', () => {
    const { rows } = plan(
      csv(
        ['Company', 'URL', 'Status', 'Created', 'Updated'],
        ['A', 'a.com/1', 'Saved', '2026-09-01 08:00', '2026-08-01T00:00:00Z'],
        ['B', 'b.com/1', 'Saved', '2026-09-01T00:00:00Z', '2099-01-01T00:00:00Z'],
        ['C', 'c.com/1', 'Saved', 'last week', ''],
      ),
    );
    const [a, b, c] = rows.map((row) => row.application);
    expect(a!.createdAt).toBe(new Date(2026, 8, 1, 8).toISOString());
    expect(a!.updatedAt).toBe(a!.createdAt);
    expect(b!.updatedAt).toBe(NOW.toISOString());
    expect(c!.createdAt).toBe(NOW.toISOString());
    expect(rows[2]!.warnings).toEqual([
      'Created “last week” couldn’t be read, so the import time is used.',
    ]);
  });

  it('marks rows already logged, or repeated earlier in the file', async () => {
    await addApplication({ url: 'https://acme.com/jobs/1?utm_source=x', company: 'Acme' }, db);
    await addApplication({ url: 'https://other.com/1', company: 'Globex', title: 'Engineer' }, db);
    const { rows } = plan(
      csv(
        ['Company', 'Job title', 'URL'],
        ['Acme', '', 'acme.com/jobs/1'],
        ['GLOBEX', 'engineer', 'globex.com/new'],
        ['Initech', '', 'initech.com/1'],
        ['Initech', '', 'initech.com/1'],
      ),
      { ...empty, applications: await listApplications(db) },
    );
    expect(rows.map((row) => row.duplicate)).toEqual([true, true, false, true]);
  });
});

describe('importCsvRows', () => {
  it('adds the rows, leaving duplicates out unless asked', async () => {
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' }, db);
    const text = csv(['Company', 'URL'], ['Acme', 'acme.com/1'], ['Globex', 'globex.com/1']);
    const context = {
      ...empty,
      applications: await listApplications(db),
      resumes: await listResumes(db),
    };
    expect(await importCsvRows(plan(text, context), {}, db)).toBe(1);
    expect((await listApplications(db)).map((a) => a.company).sort()).toEqual(['Acme', 'Globex']);
    expect(await importCsvRows(plan(text, context), { includeDuplicates: true }, db)).toBe(2);
    expect(await listApplications(db)).toHaveLength(4);
  });

  it('adds rows that work with the rest of the app', async () => {
    const [row] = plan(csv(HEADER, ['Acme', 'acme.com/1', 'Applied', '2026-10-01'])).rows;
    await importCsvRows({ rows: [row!], skipped: [], ignoredColumns: [] }, {}, db);
    // A status change appends to the imported timeline.
    const change = await setStatus(row!.application.id, 'screening', {}, db);
    expect(change.after.statusHistory.map((entry) => entry.status)).toEqual([
      'applied',
      'screening',
    ]);
  });

  it('checks again at import time: a job added since, or a resume archived since', async () => {
    const resume = await addResume(
      {
        name: 'Cv.pdf',
        size: 5,
        arrayBuffer: async () => new Uint8Array([37, 80, 68, 70, 45]).buffer,
      },
      {},
      db,
    );
    const planned = plan(
      csv(
        ['Company', 'URL', 'Resume'],
        ['Acme', 'acme.com/1', 'Cv'],
        ['Globex', 'globex.com/1', 'Cv'],
      ),
      { ...empty, resumes: await listResumes(db) },
    );
    expect(planned.rows.map((row) => row.duplicate)).toEqual([false, false]);
    // Meanwhile, in another window.
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' }, db);
    await setResumeArchived(resume.id, true, db);
    expect(await importCsvRows(planned, {}, db)).toBe(1);
    const globex = (await listApplications(db)).find((app) => app.company === 'Globex')!;
    expect(globex).not.toHaveProperty('resumeId');
    expect(globex.resumeNameSnapshot).toBe('Cv');
  });

  it('adds none when the write fails', async () => {
    vi.spyOn(db.applications, 'bulkAdd').mockRejectedValue(new Error('disk full'));
    await expect(
      importCsvRows(plan(csv(['Company', 'URL'], ['Acme', 'acme.com/1'])), {}, db),
    ).rejects.toThrow('disk full');
    expect(await db.applications.count()).toBe(0);
  });
});
