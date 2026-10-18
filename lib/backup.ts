import { isValidLocalDate, todayLocal } from './dates';
import { db as defaultDb, type JobLogDB } from './db';
import { downloadBlob } from './download';
import { formatNumber } from './numberInput';
import { readStoredSettings, SETTINGS_KEYS, type Settings } from './settings';
import { daysBetween } from './stats';
import type { Application, Resume } from './types';

/** What marks a file as a Huntlog backup, whatever it's called (spec §6). */
export const BACKUP_FORMAT = 'huntlog-backup';
/** Raised only when the layout changes in a way older versions can't read. */
export const BACKUP_VERSION = 1;

/** The settings a backup holds: those set (an absent one means its default). */
export type BackupSettings = Partial<Pick<Settings, 'weeklyGoal' | 'weekStartsOn' | 'theme'>>;

/** An application as backed up: without its derived fields, which an import recomputes. */
export type BackupApplication = Omit<Application, 'urlNormalized' | 'companyTitleKey'>;

/** A resume as backed up, with its file's bytes in base64 (null if the file is gone). */
export interface BackupResume extends Resume {
  file: string | null;
}

/**
 * The JSON backup (spec §6): every live application and resume, with the resumes' files, and the
 * settings. Soft-deleted rows stay out: a backup holds what the user still has.
 */
export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  appVersion?: string;
  settings: BackupSettings;
  applications: BackupApplication[];
  resumes: BackupResume[];
}

/** Bytes as base64, converted in chunks: spreading a whole 10 MB file as arguments would throw. */
export function toBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Base64 back to bytes. Throws on anything that isn't base64. */
export function fromBase64(text: string): ArrayBuffer {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** An application without the fields derived from it (an import recomputes them). */
export function withoutDerivedFields(app: Application): BackupApplication {
  const copy: Partial<Application> = { ...app };
  delete copy.urlNormalized;
  delete copy.companyTitleKey;
  return copy as BackupApplication;
}

function appVersion(): string | undefined {
  try {
    return browser.runtime.getManifest().version;
  } catch {
    return undefined;
  }
}

/** What a backup holds before it's written: the resume files still as bytes. */
export interface BackupContents extends Omit<Backup, 'resumes'> {
  resumes: { resume: Resume; file: ArrayBuffer | null }[];
}

/**
 * The settings the user has set, leaving out any at its default, so restoring a backup never
 * turns a default into a choice. Rejects if they can't be read, rather than backing up defaults
 * nobody chose.
 */
async function storedSettings(): Promise<BackupSettings> {
  const settings = await readStoredSettings();
  const raw = await browser.storage.local.get(Object.values(SETTINGS_KEYS));
  const chosen: BackupSettings = {};
  if (raw[SETTINGS_KEYS.theme] !== undefined) chosen.theme = settings.theme;
  if (settings.weeklyGoal !== undefined) chosen.weeklyGoal = settings.weeklyGoal;
  if (settings.weekStartsOn !== undefined) chosen.weekStartsOn = settings.weekStartsOn;
  return chosen;
}

/**
 * Reads everything a backup holds, the tables in one read transaction so they agree with each
 * other: the live applications and resumes, plus any deleted resume a live application still
 * links to (deleted within its Undo window), so no link in the backup points at nothing.
 */
export async function collectBackup(
  database: JobLogDB = defaultDb,
  now: Date = new Date(),
): Promise<BackupContents> {
  const settings = await storedSettings();
  const { applications, resumes } = await database.transaction(
    'r',
    database.applications,
    database.resumes,
    database.resumeFiles,
    async () => {
      const apps = await database.applications.filter((app) => !app.deletedAt).toArray();
      const linked = new Set(apps.flatMap((app) => (app.resumeId ? [app.resumeId] : [])));
      const kept = await database.resumes
        .filter((resume) => !resume.deletedAt || linked.has(resume.id))
        .toArray();
      const files = await database.resumeFiles.bulkGet(kept.map((resume) => resume.id));
      return {
        applications: apps.map(withoutDerivedFields),
        resumes: kept.map((resume, i) => ({ resume, file: files[i]?.data ?? null })),
      };
    },
  );
  const version = appVersion();
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    ...(version && { appVersion: version }),
    settings,
    applications,
    resumes,
  };
}

/**
 * The backup as a JSON file. Each resume is encoded on its own and turned into a Blob at once,
 * so a library of large files is never one huge string, nor held as text all together.
 */
export function backupBlob(contents: BackupContents): Blob {
  const { resumes, ...rest } = contents;
  const head = JSON.stringify(rest);
  const parts: BlobPart[] = [`${head.slice(0, -1)},"resumes":[`];
  resumes.forEach(({ resume, file }, i) => {
    const entry: BackupResume = { ...resume, file: file ? toBase64(file) : null };
    parts.push(new Blob([(i ? ',' : '') + JSON.stringify(entry)]));
  });
  parts.push(']}');
  return new Blob(parts, { type: 'application/json' });
}

/** `huntlog-backup-2026-10-18.json`, by the local date. */
export function backupFileName(now: Date = new Date()): string {
  return `huntlog-backup-${todayLocal(now)}.json`;
}

/** Where the time of the last JSON export is kept (`chrome.storage.local`). */
export const LAST_BACKUP_KEY = 'backup.lastExportedAt';

/**
 * Downloads a JSON backup of everything and records when (spec §6: "Last backup: N days ago").
 * The time is recorded once the download has started; whether the user kept the file can't be
 * known. Returns what it holds.
 */
export async function exportBackup(
  database: JobLogDB = defaultDb,
  now: Date = new Date(),
): Promise<{ applications: number; resumes: number }> {
  const backup = await collectBackup(database, now);
  downloadBlob(backupBlob(backup), backupFileName(now));
  try {
    await browser.storage.local.set({ [LAST_BACKUP_KEY]: now.toISOString() });
  } catch (error) {
    // The backup itself was made; only the reminder line is off.
    console.error('Recording the backup time failed', error);
  }
  return { applications: backup.applications.length, resumes: backup.resumes.length };
}

/** An ISO timestamp as Huntlog writes them (`toISOString`), and a real one. */
export const isTimestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value) &&
  !Number.isNaN(Date.parse(value));

/** When the last backup was made, or undefined (never, or unreadable). Never throws. */
export async function readLastBackup(): Promise<string | undefined> {
  try {
    const stored = (await browser.storage.local.get(LAST_BACKUP_KEY))[LAST_BACKUP_KEY];
    return isTimestamp(stored) ? stored : undefined;
  } catch (error) {
    console.error('Reading the last backup time failed', error);
    return undefined;
  }
}

/** Calls `listener` when a backup is made in any window. Returns the unsubscribe function. */
export function onLastBackupChanged(listener: (at: string | undefined) => void): () => void {
  const handle = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local' || !(LAST_BACKUP_KEY in changes)) return;
    const value = changes[LAST_BACKUP_KEY]!.newValue;
    listener(isTimestamp(value) ? value : undefined);
  };
  browser.storage.onChanged.addListener(handle);
  return () => browser.storage.onChanged.removeListener(handle);
}

/**
 * "Last backup: never", "today", "yesterday" or "N days ago", counted in local calendar days, so
 * one made late last night is "yesterday" this morning.
 */
export function lastBackupText(at: string | undefined, now: Date = new Date()): string {
  const then = at && isTimestamp(at) ? todayLocal(new Date(at)) : undefined;
  // Anything unreadable (a hand edit, a year past 9999) counts as never.
  if (!then || !isValidLocalDate(then)) return 'Last backup: never';
  const days = daysBetween(then, todayLocal(now)) - 1;
  if (days <= 0) return 'Last backup: today';
  if (days === 1) return 'Last backup: yesterday';
  return `Last backup: ${formatNumber(days)} days ago`;
}
