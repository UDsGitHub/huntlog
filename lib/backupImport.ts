import {
  MAX_LOCATION_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_SALARY,
  MAX_SOURCE_LENGTH,
  SALARY_PERIODS,
  WORK_MODES,
} from './applicationInput';
import { safeHref } from './applications';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  fromBase64,
  isTimestamp,
  type BackupSettings,
} from './backup';
import { isValidLocalDate } from './dates';
import { db as defaultDb, type JobLogDB } from './db';
import { derivedFields } from './dedupe';
import { FORM_DEFAULTS_KEY } from './formDefaults';
import {
  checkContents,
  formatMimeType,
  MAX_RESUME_NAME_LENGTH,
  MAX_RESUME_NOTE_LENGTH,
} from './resumes';
import { isWeeklyGoal, THEMES, updateSettings, WEEK_STARTS } from './settings';
import { isStatus } from './status';
import type { Application, Resume, StatusHistoryEntry } from './types';

/** A backup that passed every check, ready to write. */
export interface CheckedBackup {
  exportedAt?: string;
  settings: BackupSettings;
  /** With their derived fields computed here, so no write path depends on the file's. */
  applications: Application[];
  resumes: { resume: Resume; file: ArrayBuffer | null }[];
}

export type ParsedBackup = { backup: CheckedBackup } | { errors: string[] };

/** A record's fields as read from the file: anything at all. */
type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const chars = (text: string) => Array.from(text).length;

/** JSON has no undefined: an absent optional field may come as null, which means the same. */
const absent = (value: unknown) => value === undefined || value === null;

const MAX_ID_LENGTH = 100;
const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '' && value.length <= MAX_ID_LENGTH;

/**
 * Checks one application from a backup, as strictly as typed input (spec §6): a web address that
 * is http(s), known statuses and choices, text within its limits. It doesn't apply the form's
 * rules about combinations (a job moved past Saved with Skip has no Date applied, and stays
 * valid). Returns the record to store, or what's wrong with it.
 */
function checkApplication(raw: unknown): { application?: Application; problem?: string } {
  if (!isObject(raw)) return { problem: 'isn’t a record' };
  if (!isId(raw.id)) return { problem: 'has no valid id' };
  if (typeof raw.url !== 'string' || !safeHref(raw.url)) {
    return { problem: 'has a job posting URL that isn’t a web address (http or https)' };
  }
  if (typeof raw.company !== 'string' || !raw.company.trim()) return { problem: 'has no company' };
  if (!isStatus(raw.status)) return { problem: 'has an unknown status' };
  const history = raw.statusHistory;
  if (
    !Array.isArray(history) ||
    history.length === 0 ||
    !history.every((entry) => isObject(entry) && isStatus(entry.status) && isTimestamp(entry.at))
  ) {
    return { problem: 'has an invalid status history' };
  }
  for (const field of ['createdAt', 'updatedAt'] as const) {
    if (!isTimestamp(raw[field])) return { problem: `has an invalid ${field}` };
  }
  if (!absent(raw.deletedAt) && !isTimestamp(raw.deletedAt)) {
    return { problem: 'has an invalid deletedAt' };
  }

  const application: Application = {
    id: raw.id,
    url: raw.url,
    company: raw.company,
    status: raw.status,
    statusHistory: (history as Raw[]).map((entry): StatusHistoryEntry => ({
      status: entry.status as StatusHistoryEntry['status'],
      at: entry.at as string,
    })),
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt as string,
    ...derivedFields(raw),
  };
  if (!application.companyTitleKey) delete application.companyTitleKey;
  if (!absent(raw.deletedAt)) application.deletedAt = raw.deletedAt as string;

  const texts: [keyof Application, number | undefined][] = [
    ['title', undefined],
    ['resumeNameSnapshot', undefined],
    ['location', MAX_LOCATION_LENGTH],
    ['source', MAX_SOURCE_LENGTH],
    ['notes', MAX_NOTES_LENGTH],
  ];
  for (const [field, max] of texts) {
    const value = raw[field];
    if (absent(value)) continue;
    if (typeof value !== 'string') return { problem: `has an invalid ${field}` };
    if (max !== undefined && chars(value) > max)
      return { problem: `has a ${field} that’s too long` };
    (application as unknown as Raw)[field] = value;
  }
  if (!absent(raw.resumeId)) {
    if (!isId(raw.resumeId)) return { problem: 'has an invalid resumeId' };
    application.resumeId = raw.resumeId;
  }
  if (!absent(raw.appliedAt)) {
    if (typeof raw.appliedAt !== 'string' || !isValidLocalDate(raw.appliedAt)) {
      return { problem: 'has an invalid Date applied' };
    }
    application.appliedAt = raw.appliedAt;
  }
  if (!absent(raw.workMode)) {
    if (!(WORK_MODES as unknown[]).includes(raw.workMode))
      return { problem: 'has an unknown work mode' };
    application.workMode = raw.workMode as Application['workMode'];
  }
  for (const field of ['salaryMin', 'salaryMax'] as const) {
    const value = raw[field];
    if (absent(value)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_SALARY) {
      return { problem: `has an invalid ${field}` };
    }
    application[field] = value;
  }
  if (!absent(raw.salaryCurrency)) {
    if (typeof raw.salaryCurrency !== 'string' || !/^[A-Z]{3}$/.test(raw.salaryCurrency)) {
      return { problem: 'has an invalid currency' };
    }
    application.salaryCurrency = raw.salaryCurrency;
  }
  if (!absent(raw.salaryPeriod)) {
    if (!(SALARY_PERIODS as unknown[]).includes(raw.salaryPeriod)) {
      return { problem: 'has an unknown salary period' };
    }
    application.salaryPeriod = raw.salaryPeriod as Application['salaryPeriod'];
  }
  return { application };
}

/**
 * Checks one resume and decodes its file: a format Huntlog accepts, whose bytes match it (the
 * same check as an upload) and are 10 MB or less. The stored size is the decoded file's.
 */
function checkResume(raw: unknown): {
  entry?: { resume: Resume; file: ArrayBuffer | null };
  problem?: string;
} {
  if (!isObject(raw)) return { problem: 'isn’t a record' };
  if (!isId(raw.id)) return { problem: 'has no valid id' };
  if (
    typeof raw.name !== 'string' ||
    !raw.name.trim() ||
    chars(raw.name) > MAX_RESUME_NAME_LENGTH
  ) {
    return { problem: 'has no valid name' };
  }
  if (typeof raw.fileName !== 'string' || !raw.fileName.trim()) {
    return { problem: 'has no file name' };
  }
  const mimeType = formatMimeType(raw.fileName);
  if (!mimeType || raw.mimeType !== mimeType) {
    return { problem: 'isn’t a PDF, DOCX, DOC, TXT or RTF file' };
  }
  if (typeof raw.archived !== 'boolean') return { problem: 'has an invalid archived flag' };
  for (const field of ['createdAt', 'updatedAt'] as const) {
    if (!isTimestamp(raw[field])) return { problem: `has an invalid ${field}` };
  }
  if (!absent(raw.deletedAt) && !isTimestamp(raw.deletedAt)) {
    return { problem: 'has an invalid deletedAt' };
  }
  if (
    !absent(raw.note) &&
    (typeof raw.note !== 'string' || chars(raw.note) > MAX_RESUME_NOTE_LENGTH)
  ) {
    return { problem: 'has an invalid note' };
  }

  let file: ArrayBuffer | null = null;
  if (!absent(raw.file)) {
    if (typeof raw.file !== 'string') return { problem: 'has an invalid file' };
    try {
      file = fromBase64(raw.file);
    } catch {
      return { problem: 'has a file that can’t be read' };
    }
    const error = checkContents(raw.fileName, file);
    if (error) return { problem: `has a file that’s not valid (${error})` };
  }
  const size = file ? file.byteLength : raw.size;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 0) {
    return { problem: 'has an invalid size' };
  }

  const resume: Resume = {
    id: raw.id,
    name: raw.name,
    fileName: raw.fileName,
    mimeType,
    size,
    archived: raw.archived,
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt as string,
  };
  if (!absent(raw.note)) resume.note = raw.note as string;
  if (!absent(raw.deletedAt)) resume.deletedAt = raw.deletedAt as string;
  return { entry: { resume, file } };
}

/** The settings a backup holds; a malformed one is left out (it means its default). */
function checkSettings(raw: unknown): BackupSettings {
  const settings: BackupSettings = {};
  if (!isObject(raw)) return settings;
  if (isWeeklyGoal(raw.weeklyGoal)) settings.weeklyGoal = raw.weeklyGoal;
  if ((WEEK_STARTS as unknown[]).includes(raw.weekStartsOn)) {
    settings.weekStartsOn = raw.weekStartsOn as BackupSettings['weekStartsOn'];
  }
  if ((THEMES as readonly unknown[]).includes(raw.theme)) {
    settings.theme = raw.theme as BackupSettings['theme'];
  }
  return settings;
}

/** "Application 3 (Acme)": where a problem is, for a person to find in the file. */
function describe(kind: string, index: number, raw: unknown, label: 'company' | 'name'): string {
  const name = isObject(raw) && typeof raw[label] === 'string' ? raw[label].trim() : '';
  return `${kind} ${index + 1}${name ? ` (${Array.from(name).slice(0, 40).join('')})` : ''}`;
}

/**
 * Reads and checks a JSON backup (spec §6). The whole file is checked before anything is written:
 * any invalid record refuses it, with every problem listed, so nothing is half imported. A file
 * that isn't a Huntlog backup, or is from a newer version, is refused with one message.
 */
export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { errors: ['This file isn’t valid JSON.'] };
  }
  if (!isObject(raw) || raw.format !== BACKUP_FORMAT) {
    return { errors: ['This isn’t a Huntlog backup.'] };
  }
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) {
    return { errors: ['This backup has no valid version.'] };
  }
  if (raw.version > BACKUP_VERSION) {
    return {
      errors: ['This backup is from a newer version of Huntlog. Update Huntlog, then try again.'],
    };
  }
  if (!Array.isArray(raw.applications) || !Array.isArray(raw.resumes)) {
    return { errors: ['This backup is missing its applications or resumes.'] };
  }

  const errors: string[] = [];
  const applications: Application[] = [];
  const appIds = new Set<string>();
  raw.applications.forEach((item, i) => {
    const { application, problem } = checkApplication(item);
    const where = describe('Application', i, item, 'company');
    if (problem) errors.push(`${where} ${problem}.`);
    else if (appIds.has(application!.id)) errors.push(`${where} repeats an earlier id.`);
    else {
      appIds.add(application!.id);
      applications.push(application!);
    }
  });
  const resumes: CheckedBackup['resumes'] = [];
  const resumeIds = new Set<string>();
  raw.resumes.forEach((item, i) => {
    const { entry, problem } = checkResume(item);
    const where = describe('Resume', i, item, 'name');
    if (problem) errors.push(`${where} ${problem}.`);
    else if (resumeIds.has(entry!.resume.id)) errors.push(`${where} repeats an earlier id.`);
    else {
      resumeIds.add(entry!.resume.id);
      resumes.push(entry!);
    }
  });
  if (errors.length) return { errors };
  return {
    backup: {
      ...(isTimestamp(raw.exportedAt) && { exportedAt: raw.exportedAt }),
      settings: checkSettings(raw.settings),
      applications,
      resumes,
    },
  };
}

/** Live applications and resumes: what Replace all would replace, for its confirmation. */
export async function countLiveData(
  database: JobLogDB = defaultDb,
): Promise<{ applications: number; resumes: number }> {
  const [applications, resumes] = await Promise.all([
    database.applications.filter((app) => !app.deletedAt).count(),
    database.resumes.filter((resume) => !resume.deletedAt).count(),
  ]);
  return { applications, resumes };
}

/** The data was replaced, but the settings or the remembered form defaults weren't restored. */
export class SettingsRestoreError extends Error {
  constructor(cause: unknown) {
    super('Data replaced, but the settings could not be restored', { cause });
    this.name = 'SettingsRestoreError';
  }
}

/**
 * Replace all (spec §6): every application and resume is replaced by the backup's, in one
 * transaction (all or nothing). Then the settings are restored from it and the remembered form
 * defaults cleared, as Delete all data does. A failure after the data is written rejects with
 * `SettingsRestoreError`: the data is replaced, only the settings aren't.
 */
export async function replaceWithBackup(
  backup: CheckedBackup,
  database: JobLogDB = defaultDb,
): Promise<void> {
  await database.transaction(
    'rw',
    database.applications,
    database.resumes,
    database.resumeFiles,
    async () => {
      await database.applications.clear();
      await database.resumes.clear();
      await database.resumeFiles.clear();
      await database.applications.bulkAdd(backup.applications);
      await database.resumes.bulkAdd(backup.resumes.map(({ resume }) => resume));
      await database.resumeFiles.bulkAdd(
        backup.resumes.flatMap(({ resume, file }) => (file ? [{ id: resume.id, data: file }] : [])),
      );
    },
  );
  try {
    const { weeklyGoal, weekStartsOn, theme } = backup.settings;
    // A setting the backup doesn't hold goes back to its default (undefined clears it).
    await updateSettings({ weeklyGoal, weekStartsOn, theme });
    await browser.storage.local.remove(FORM_DEFAULTS_KEY);
  } catch (error) {
    throw new SettingsRestoreError(error);
  }
}

export interface MergeCounts {
  /** Applications and resumes the backup added or updated. */
  applications: number;
  resumes: number;
}

const newer = (incoming: { updatedAt: string }, stored: { updatedAt: string } | undefined) =>
  !stored || Date.parse(incoming.updatedAt) > Date.parse(stored.updatedAt);

/**
 * Merge (spec §6): each record is matched by id, and the newer `updatedAt` wins (on a tie, the
 * stored one stays). A resume's file goes with it. The settings stay as they are. One
 * transaction, so a failure leaves everything as it was.
 */
export function mergeBackup(
  backup: CheckedBackup,
  database: JobLogDB = defaultDb,
): Promise<MergeCounts> {
  return database.transaction(
    'rw',
    database.applications,
    database.resumes,
    database.resumeFiles,
    async () => {
      const storedApps = await database.applications.bulkGet(
        backup.applications.map((app) => app.id),
      );
      const apps = backup.applications.filter((app, i) => newer(app, storedApps[i]));
      await database.applications.bulkPut(apps);

      const storedResumes = await database.resumes.bulkGet(
        backup.resumes.map(({ resume }) => resume.id),
      );
      const resumes = backup.resumes.filter(({ resume }, i) => newer(resume, storedResumes[i]));
      await database.resumes.bulkPut(resumes.map(({ resume }) => resume));
      // A winning resume without a file keeps the stored file, if there is one.
      await database.resumeFiles.bulkPut(
        resumes.flatMap(({ resume, file }) => (file ? [{ id: resume.id, data: file }] : [])),
      );
      return { applications: apps.length, resumes: resumes.length };
    },
  );
}
