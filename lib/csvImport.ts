import {
  SALARY_PERIOD_LABELS,
  SALARY_PERIODS,
  validateApplication,
  WORK_MODE_LABELS,
  WORK_MODES,
  type ApplicationInput,
  type InputField,
} from './applicationInput';
import { CSV_COLUMNS, type CsvColumn } from './applicationsCsv';
import { isTimestamp } from './backup';
import { parseCsv, restoreFormulaText } from './csv';
import { parseLocalDate } from './dates';
import { db as defaultDb, type JobLogDB } from './db';
import { derivedFields } from './dedupe';
import { foldText } from './listQuery';
import { appliedAtOptional, STATUS_LABELS, STATUSES } from './status';
import type { Application, Resume, Status } from './types';

/** What an import checks the rows against: what's stored, and when and where it runs. */
export interface CsvContext {
  /** Live applications, for "already logged". */
  applications: readonly Pick<Application, 'urlNormalized' | 'companyTitleKey'>[];
  /** Live resumes, newest first, to link by name. */
  resumes: readonly Pick<Resume, 'id' | 'name'>[];
  now?: Date;
  locale?: string;
}

/** A row that will be imported (spec §6), as the application it becomes. */
export interface CsvRow {
  /** Its row number in a spreadsheet: the header is row 1. */
  row: number;
  application: Application;
  warnings: string[];
  /** Same URL or company + title as a stored application or an earlier row. */
  duplicate: boolean;
}

export interface CsvPlan {
  rows: CsvRow[];
  /** Rows that can't be imported, and why. */
  skipped: { row: number; reason: string }[];
  /** Header cells that aren't Huntlog columns: their values aren't imported. */
  ignoredColumns: string[];
}

/** Letters and digits only, folded: "On-site", "onsite" and "ON SITE" match. */
const loose = (text: string) => foldText(text).replace(/[^\p{L}\p{N}]/gu, '');

/** Matches a cell to one of a set of values, by the value or its label, ignoring case. */
function choose<T extends string>(
  text: string,
  values: readonly T[],
  labels: Record<T, string>,
): T | undefined {
  const wanted = loose(text);
  return values.find((value) => loose(value) === wanted || loose(labels[value]) === wanted);
}

/** The column each field's errors belong to, to name it in a message. */
const FIELD_COLUMNS: Record<InputField, CsvColumn> = {
  url: 'URL',
  company: 'Company',
  location: 'Location',
  workMode: 'Work mode',
  salaryMin: 'Salary min',
  salaryMax: 'Salary max',
  salaryCurrency: 'Currency',
  salaryPeriod: 'Per',
  source: 'Source',
  notes: 'Notes',
  status: 'Status',
  resumeId: 'Resume',
  appliedAt: 'Date applied',
};

/** A plain number as the export writes it ("85000.5"); anything else is read in the locale. */
const PLAIN_NUMBER = /^\d+(\.\d{1,2})?$/;
const salary = (text: string) => (PLAIN_NUMBER.test(text) ? Number(text) : text || undefined);

/** Local noon of a date: a status entry on that day, whatever DST does. */
function noonOf(date: string): string {
  const day = parseLocalDate(date)!;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12).toISOString();
}

/**
 * Reads a CSV of applications (spec §6) into what an import would do, without writing anything:
 * the rows to import (with warnings, and whether each is already logged), the rows skipped and
 * why, and the columns ignored. The header must have Company and URL; other columns may be left
 * out or in any order. Each row is checked like the Add form. A CSV has no timeline, so each
 * application gets one status entry, dated its Date applied (else its Created time, else now).
 */
export function planCsvImport(
  text: string,
  context: CsvContext,
): { plan: CsvPlan } | { error: string } {
  const now = context.now ?? new Date();
  const parsed = parseCsv(text);
  if ('error' in parsed) return { error: parsed.error };
  const [header, ...records] = parsed.rows;
  if (!header) return { error: 'This file is empty.' };

  const columns = new Map<CsvColumn, number>();
  const ignoredColumns: string[] = [];
  header.cells.forEach((cell, index) => {
    const name = cell.trim();
    const column = CSV_COLUMNS.find((known) => loose(known) === loose(name));
    if (!column) {
      if (name) ignoredColumns.push(name);
    } else if (columns.has(column)) {
      ignoredColumns.push(name);
    } else columns.set(column, index);
  });
  if (!columns.has('Company') || !columns.has('URL')) {
    return {
      error: 'The file needs a Company and a URL column. Download the template to see them all.',
    };
  }

  const at = now.toISOString();
  const urls = new Set(context.applications.map((app) => app.urlNormalized));
  const keys = new Set(
    context.applications.flatMap((app) => (app.companyTitleKey ? [app.companyTitleKey] : [])),
  );
  const resumesByName = new Map<string, Pick<Resume, 'id' | 'name'>>();
  // Newest first: the first of a name is the one linked.
  for (const resume of context.resumes) {
    if (!resumesByName.has(loose(resume.name))) resumesByName.set(loose(resume.name), resume);
  }

  const rows: CsvRow[] = [];
  const skipped: CsvPlan['skipped'] = [];
  records.forEach(({ cells }, index) => {
    const row = index + 2;
    const get = (column: CsvColumn) => {
      const position = columns.get(column);
      return position === undefined ? '' : restoreFormulaText(cells[position] ?? '').trim();
    };
    // An empty row (a spreadsheet's blank line, saved as commas) is passed over.
    if (cells.every((cell) => !cell.trim())) return;

    const warnings: string[] = [];
    const problems: string[] = [];

    let status: Status = 'applied';
    const statusText = get('Status');
    if (statusText) {
      const match = choose(statusText, STATUSES, STATUS_LABELS);
      if (match) status = match;
      else warnings.push(`Unknown status “${statusText}”, imported as Applied.`);
    }
    const workModeText = get('Work mode');
    const workMode = workModeText ? choose(workModeText, WORK_MODES, WORK_MODE_LABELS) : undefined;
    if (workModeText && !workMode) problems.push('Work mode: Choose remote, hybrid or on-site.');
    const periodText = get('Per');
    const period = periodText
      ? choose(periodText, SALARY_PERIODS, SALARY_PERIOD_LABELS)
      : undefined;
    if (periodText && !period) problems.push('Per: Choose per year, month or hour.');

    const appliedAt = get('Date applied');
    // A job past Saved without a date is kept as one (like Skip), not given today's date.
    const undated = !appliedAt && !appliedAtOptional(status);
    if (undated) warnings.push('No Date applied, so it isn’t counted in Applied or the rates.');
    const input: ApplicationInput = {
      url: get('URL'),
      company: get('Company'),
      title: get('Job title'),
      location: get('Location'),
      workMode,
      salaryMin: salary(get('Salary min')),
      salaryMax: salary(get('Salary max')),
      salaryCurrency: get('Currency'),
      salaryPeriod: period,
      source: get('Source'),
      notes: get('Notes'),
      status,
      appliedAt,
    };
    const { values, errors } = validateApplication(input, now, context.locale, {
      current: undated ? { status } : undefined,
    });
    for (const [field, message] of Object.entries(errors) as [InputField, string][]) {
      problems.push(`${FIELD_COLUMNS[field]}: ${message}`);
    }
    if (!values || problems.length) {
      skipped.push({ row, reason: problems.join(' ') });
      return;
    }

    const application: Application = {
      id: crypto.randomUUID(),
      ...values,
      ...derivedFields(values),
      status,
      statusHistory: [],
      createdAt: at,
      updatedAt: at,
    };
    if (!application.companyTitleKey) delete application.companyTitleKey;
    const created = get('Created');
    const updated = get('Updated');
    if (isTimestamp(created)) application.createdAt = created;
    if (isTimestamp(updated)) application.updatedAt = updated;
    application.statusHistory = [
      {
        status,
        at: values.appliedAt ? noonOf(values.appliedAt) : isTimestamp(created) ? created : at,
      },
    ];

    const resumeName = get('Resume');
    if (resumeName) {
      const resume = resumesByName.get(loose(resumeName));
      if (resume) {
        application.resumeId = resume.id;
        application.resumeNameSnapshot = resume.name;
      } else {
        application.resumeNameSnapshot = resumeName;
        warnings.push(`No resume named “${resumeName}” in your library, so only its name is kept.`);
      }
    }

    const key = application.companyTitleKey;
    const duplicate = urls.has(application.urlNormalized) || (!!key && keys.has(key));
    urls.add(application.urlNormalized);
    if (key) keys.add(key);
    rows.push({ row, application, warnings, duplicate });
  });

  if (rows.length === 0 && skipped.length === 0) {
    return { error: 'This file has no applications to import.' };
  }
  return { plan: { rows, skipped, ignoredColumns } };
}

/**
 * Adds the planned applications (spec §6), all in one transaction: all of them or none. Returns
 * how many. Duplicates are left out unless `includeDuplicates`.
 */
export async function importCsvRows(
  plan: CsvPlan,
  { includeDuplicates = false }: { includeDuplicates?: boolean } = {},
  database: JobLogDB = defaultDb,
): Promise<number> {
  const applications = plan.rows
    .filter((row) => includeDuplicates || !row.duplicate)
    .map((row) => row.application);
  await database.transaction('rw', database.applications, () =>
    database.applications.bulkAdd(applications),
  );
  return applications.length;
}
