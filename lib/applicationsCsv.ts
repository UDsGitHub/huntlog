import { SALARY_PERIOD_LABELS, WORK_MODE_LABELS } from './applicationInput';
import { listApplications } from './applications';
import { BOM, neutralizeFormula, toCsv } from './csv';
import { todayLocal } from './dates';
import { db as defaultDb, type JobLogDB } from './db';
import { downloadBlob } from './download';
import { STATUS_LABELS } from './status';
import type { Application, Resume } from './types';

/**
 * The CSV's columns (spec §6), in order: the export writes them, the template holds them and an
 * import reads them by name.
 */
export const CSV_COLUMNS = [
  'Company',
  'Job title',
  'URL',
  'Status',
  'Date applied',
  'Location',
  'Work mode',
  'Salary min',
  'Salary max',
  'Currency',
  'Per',
  'Source',
  'Notes',
  'Resume',
  'Created',
  'Updated',
] as const;
export type CsvColumn = (typeof CSV_COLUMNS)[number];

/** Plain, locale-free numbers ("85000.5"), so the file reads the same everywhere. */
const plainNumber = (value: number | undefined) => (value === undefined ? '' : String(value));

/**
 * One row per application, values plain and locale-free (spec §6). The resume is named by its
 * current name, or the snapshot when it's gone. Every cell is guarded against formulas.
 */
export function applicationRow(
  app: Application,
  resumeNames: ReadonlyMap<string, string>,
): string[] {
  const values: Record<CsvColumn, string> = {
    Company: app.company,
    'Job title': app.title ?? '',
    URL: app.url,
    Status: STATUS_LABELS[app.status],
    'Date applied': app.appliedAt ?? '',
    Location: app.location ?? '',
    'Work mode': app.workMode ? WORK_MODE_LABELS[app.workMode] : '',
    'Salary min': plainNumber(app.salaryMin),
    'Salary max': plainNumber(app.salaryMax),
    Currency: app.salaryCurrency ?? '',
    Per: app.salaryPeriod ? SALARY_PERIOD_LABELS[app.salaryPeriod] : '',
    Source: app.source ?? '',
    Notes: app.notes ?? '',
    Resume: (app.resumeId && resumeNames.get(app.resumeId)) || app.resumeNameSnapshot || '',
    Created: app.createdAt,
    Updated: app.updatedAt,
  };
  return CSV_COLUMNS.map((column) => neutralizeFormula(values[column]));
}

/** The CSV file's text: a byte-order mark (so Excel reads accents), the header, then the rows. */
export function applicationsCsv(
  applications: readonly Application[],
  resumes: readonly Pick<Resume, 'id' | 'name'>[],
): string {
  const names = new Map(resumes.map((resume) => [resume.id, resume.name]));
  return BOM + toCsv([[...CSV_COLUMNS], ...applications.map((app) => applicationRow(app, names))]);
}

/** Downloads every live application as CSV (spec §6), newest change first. Returns how many. */
export async function exportCsv(
  database: JobLogDB = defaultDb,
  now: Date = new Date(),
): Promise<number> {
  const [applications, resumes] = await database.transaction(
    'r',
    database.applications,
    database.resumes,
    // Deleted resumes too: a link to one within its Undo window still shows its name.
    () => Promise.all([listApplications(database), database.resumes.toArray()]),
  );
  downloadBlob(
    new Blob([applicationsCsv(applications, resumes)], { type: 'text/csv;charset=utf-8' }),
    `huntlog-applications-${todayLocal(now)}.csv`,
  );
  return applications.length;
}

/** The CSV template (spec §6): the header row only, since an example row would be imported. */
export function downloadCsvTemplate(): void {
  downloadBlob(
    new Blob([BOM + toCsv([[...CSV_COLUMNS]])], { type: 'text/csv;charset=utf-8' }),
    'huntlog-template.csv',
  );
}
