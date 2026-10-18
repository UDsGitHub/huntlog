import { fakeBrowser } from 'wxt/testing/fake-browser';
import { addApplication, softDeleteApplication } from './applications';
import { applicationsCsv, CSV_COLUMNS, downloadCsvTemplate, exportCsv } from './applicationsCsv';
import { BOM, parseCsv } from './csv';
import { JobLogDB } from './db';
import { addResume, deleteResume, purgeDeletedResumeData, updateResume } from './resumes';
import type { Application } from './types';

let db: JobLogDB;
beforeEach(() => {
  fakeBrowser.reset();
  db = new JobLogDB(`test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
});

const pdf = (name: string) => ({
  name,
  size: 5,
  arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer,
});

function rows(text: string) {
  expect(text.startsWith(BOM)).toBe(true);
  const result = parseCsv(text);
  if ('error' in result) throw new Error(result.error);
  return result.rows.map((row) => row.cells);
}

/** Captures what downloadBlob saves. */
function captureDownloads() {
  const files: { name: string; blob: Blob }[] = [];
  let pending: Blob | undefined;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    pending = blob as Blob;
    return 'blob:x';
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    files.push({ name: this.download, blob: pending! });
  });
  return files;
}

describe('applicationsCsv', () => {
  it('writes the header and every field, plain and locale-free', async () => {
    const resume = await addResume(pdf('Backend v3.pdf'), {}, db);
    const app = await addApplication(
      {
        url: 'https://acme.com/jobs/1',
        company: 'Acme, Inc.',
        title: 'Backend "Platform" Engineer',
        status: 'interviewing',
        appliedAt: '2026-10-01',
        location: 'München',
        workMode: 'onsite',
        salaryMin: 85000,
        salaryMax: '95,000.5',
        salaryCurrency: 'EUR',
        salaryPeriod: 'month',
        source: 'Referral',
        notes: 'Line one\nLine two',
        resumeId: resume.id,
      },
      db,
      new Date('2026-10-02T09:00:00.000Z'),
    );
    expect(rows(applicationsCsv([app], [resume]))).toEqual([
      [...CSV_COLUMNS],
      [
        'Acme, Inc.',
        'Backend "Platform" Engineer',
        'https://acme.com/jobs/1',
        'Interviewing',
        '2026-10-01',
        'München',
        'On-site',
        '85000',
        '95000.5',
        'EUR',
        'Month',
        'Referral',
        'Line one\nLine two',
        'Backend v3',
        '2026-10-02T09:00:00.000Z',
        '2026-10-02T09:00:00.000Z',
      ],
    ]);
  });

  it('leaves blanks for what isn’t set', async () => {
    const app = await addApplication(
      { url: 'https://acme.com/1', company: 'Acme', status: 'saved' },
      db,
    );
    const [, row] = rows(applicationsCsv([app], []));
    expect(row!.filter(Boolean)).toEqual([
      'Acme',
      'https://acme.com/1',
      'Saved',
      app.createdAt,
      app.updatedAt,
    ]);
  });

  it('names the resume by its current name, or its snapshot once it’s gone', () => {
    const app = {
      company: 'Acme',
      url: 'https://acme.com/1',
      status: 'applied',
      resumeId: 'r1',
      resumeNameSnapshot: 'Old name',
      createdAt: 'c',
      updatedAt: 'u',
    } as Application;
    const resumeColumn = CSV_COLUMNS.indexOf('Resume');
    expect(rows(applicationsCsv([app], [{ id: 'r1', name: 'New name' }]))[1]![resumeColumn]).toBe(
      'New name',
    );
    expect(rows(applicationsCsv([app], []))[1]![resumeColumn]).toBe('Old name');
  });

  it('guards cells a spreadsheet would run as formulas', async () => {
    const app = await addApplication(
      { url: 'https://acme.com/1', company: '=HYPERLINK("x")', notes: '-5 years', source: '@x' },
      db,
    );
    const [, row] = rows(applicationsCsv([app], []));
    expect(row![0]).toBe('\'=HYPERLINK("x")');
    expect(row![CSV_COLUMNS.indexOf('Notes')]).toBe("'-5 years");
    expect(row![CSV_COLUMNS.indexOf('Source')]).toBe("'@x");
  });
});

describe('exportCsv', () => {
  it('downloads live applications, with resume names even for a just-deleted resume', async () => {
    const files = captureDownloads();
    const kept = await addResume(pdf('Kept.pdf'), {}, db);
    await updateResume(kept.id, { name: 'Renamed' }, db);
    const gone = await addResume(pdf('Gone.pdf'), {}, db);
    await addApplication({ url: 'https://acme.com/1', company: 'Acme', resumeId: kept.id }, db);
    const deleted = await addApplication({ url: 'https://globex.com/1', company: 'Globex' }, db);
    await softDeleteApplication(deleted.id, db);
    await deleteResume(gone.id, db);
    await purgeDeletedResumeData({ id: gone.id, olderThanMs: 0 }, db);

    expect(await exportCsv(db, new Date(2026, 9, 18, 23, 30))).toBe(1);
    expect(files.map((file) => file.name)).toEqual(['huntlog-applications-2026-10-18.csv']);
    expect(files[0]!.blob.type).toBe('text/csv;charset=utf-8');
    const [, row] = rows(await files[0]!.blob.text());
    expect(row![0]).toBe('Acme');
    expect(row![CSV_COLUMNS.indexOf('Resume')]).toBe('Renamed');
  });
});

describe('downloadCsvTemplate', () => {
  it('downloads the header row only', async () => {
    const files = captureDownloads();
    downloadCsvTemplate();
    expect(files[0]!.name).toBe('huntlog-template.csv');
    expect(rows(await files[0]!.blob.text())).toEqual([[...CSV_COLUMNS]]);
  });
});
