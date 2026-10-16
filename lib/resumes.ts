import { NotFoundError } from './applications';
import { db as defaultDb, type JobLogDB } from './db';
import type { Resume } from './types';

/** Spec §4.6: PDF, DOCX, DOC, TXT or RTF, up to 10 MB. */
export const MAX_RESUME_BYTES = 10 * 1024 * 1024;
export const MAX_RESUME_NAME_LENGTH = 100;
export const MAX_RESUME_NOTE_LENGTH = 500;
/** How long a deleted resume can be restored (the Undo toast) before its bytes go. */
export const RESUME_UNDO_WINDOW_MS = 60 * 1000;

/** Accepted extensions and the file types browsers report for them. */
const FORMATS: Record<string, { label: string; types: string[] }> = {
  pdf: { label: 'PDF', types: ['application/pdf'] },
  docx: {
    label: 'DOCX',
    types: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  },
  doc: { label: 'DOC', types: ['application/msword'] },
  txt: { label: 'TXT', types: ['text/plain'] },
  rtf: { label: 'RTF', types: ['application/rtf', 'text/rtf'] },
};
/** Some systems report no type, or a generic one, for .doc, .rtf and the like. */
const UNKNOWN_TYPES = ['', 'application/octet-stream'];

/** For the file picker's `accept`. */
export const RESUME_ACCEPT = Object.keys(FORMATS)
  .map((extension) => `.${extension}`)
  .join(',');

/** The minimal File surface used here, so tests can pass plain objects. */
export interface ResumeFile {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type ResumeFields = { name?: string; note?: string };
export type ResumeErrors = Partial<Record<'file' | 'name' | 'note', string>>;

export class ResumeValidationError extends Error {
  constructor(readonly fields: ResumeErrors) {
    super('Invalid resume');
    this.name = 'ResumeValidationError';
  }
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

/** "PDF", "DOCX", …: the format label shown next to a resume's name. */
export function formatLabel(fileName: string): string {
  return FORMATS[extensionOf(fileName)]?.label ?? (extensionOf(fileName).toUpperCase() || 'File');
}

/**
 * Checks a picked file: an accepted extension whose reported type matches (or is unknown), and
 * 1 byte to 10 MB. Returns the type to store (the reported one, or the format's own if unknown).
 */
export function checkResumeFile(
  file: Pick<ResumeFile, 'name' | 'type' | 'size'>,
): { mimeType: string } | { error: string } {
  const format = FORMATS[extensionOf(file.name)];
  if (!format) return { error: 'Choose a PDF, DOCX, DOC, TXT or RTF file.' };
  const type = file.type.toLowerCase();
  if (!UNKNOWN_TYPES.includes(type) && !format.types.includes(type)) {
    return { error: "This file's contents don't match its extension." };
  }
  if (file.size <= 0) return { error: 'This file is empty.' };
  if (file.size > MAX_RESUME_BYTES) return { error: 'Choose a file of 10 MB or less.' };
  return { mimeType: UNKNOWN_TYPES.includes(type) ? format.types[0]! : type };
}

/** "Backend v3.pdf" → "Backend v3": the suggested display name. */
export function defaultResumeName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = (dot > 0 ? fileName.slice(0, dot) : fileName).replace(/\s+/g, ' ').trim();
  return Array.from(base).slice(0, MAX_RESUME_NAME_LENGTH).join('').trim();
}

function checkFields(fields: ResumeFields): {
  values: { name: string; note?: string } | null;
  errors: ResumeErrors;
} {
  const errors: ResumeErrors = {};
  const name = (fields.name ?? '').replace(/\s+/g, ' ').trim();
  const note = fields.note?.trim();
  if (!name) errors.name = 'Enter a name for this resume.';
  else if (Array.from(name).length > MAX_RESUME_NAME_LENGTH) {
    errors.name = `Use ${MAX_RESUME_NAME_LENGTH} characters or fewer.`;
  }
  if (note && Array.from(note).length > MAX_RESUME_NOTE_LENGTH) {
    errors.note = `Use ${MAX_RESUME_NOTE_LENGTH} characters or fewer.`;
  }
  if (Object.keys(errors).length > 0) return { values: null, errors };
  return { values: { name, ...(note && { note }) }, errors };
}

/** Uploads a resume. The name defaults to the file name without its extension. */
export async function addResume(
  file: ResumeFile,
  fields: ResumeFields = {},
  database: JobLogDB = defaultDb,
  now: Date = new Date(),
): Promise<Resume> {
  const checked = checkResumeFile(file);
  const { values, errors } = checkFields({
    ...fields,
    name: fields.name ?? defaultResumeName(file.name),
  });
  if ('error' in checked) errors.file = checked.error;
  if (!values || 'error' in checked) throw new ResumeValidationError(errors);
  const at = now.toISOString();
  const resume: Resume = {
    id: crypto.randomUUID(),
    ...values,
    fileName: file.name,
    mimeType: checked.mimeType,
    size: file.size,
    data: await file.arrayBuffer(),
    archived: false,
    createdAt: at,
    updatedAt: at,
  };
  await database.resumes.add(resume);
  return resume;
}

/**
 * Live (not soft-deleted) resumes, newest first. Every resume read goes through this module, so
 * the soft-delete filter lives in one place (as `lib/applications.ts` does for applications).
 */
export async function listResumes(database: JobLogDB = defaultDb): Promise<Resume[]> {
  const all = await database.resumes.filter((resume) => !resume.deletedAt).toArray();
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** A live resume, or undefined. */
export async function getResume(
  id: string,
  database: JobLogDB = defaultDb,
): Promise<Resume | undefined> {
  const resume = await database.resumes.get(id);
  return resume && !resume.deletedAt ? resume : undefined;
}

async function updateLive(
  id: string,
  changes: Partial<Resume>,
  database: JobLogDB,
  now: Date,
): Promise<Resume> {
  const updated = await database.transaction('rw', database.resumes, async () => {
    if (!(await getResume(id, database))) return undefined;
    await database.resumes.update(id, { ...changes, updatedAt: now.toISOString() });
    return database.resumes.get(id);
  });
  if (!updated) throw new NotFoundError(id);
  return updated;
}

/** Renames a resume and sets its note. Applications show the current name, so none change. */
export async function updateResume(
  id: string,
  fields: ResumeFields,
  database: JobLogDB = defaultDb,
  now: Date = new Date(),
): Promise<Resume> {
  const { values, errors } = checkFields(fields);
  if (!values) throw new ResumeValidationError(errors);
  return updateLive(id, { name: values.name, note: values.note }, database, now);
}

export function setResumeArchived(
  id: string,
  archived: boolean,
  database: JobLogDB = defaultDb,
  now: Date = new Date(),
): Promise<Resume> {
  return updateLive(id, { archived }, database, now);
}

/**
 * True if any application links to this resume, including soft-deleted ones: a deleted
 * application can come back with Undo, and its resume must still be there.
 */
export async function isResumeReferenced(
  id: string,
  database: JobLogDB = defaultDb,
): Promise<boolean> {
  return (await database.applications.where('resumeId').equals(id).count()) > 0;
}

/**
 * Spec §4.6: a resume that any application uses is archived, never deleted. Otherwise it's
 * soft-deleted (restorable with Undo; its bytes go after RESUME_UNDO_WINDOW_MS).
 */
export async function deleteResume(
  id: string,
  database: JobLogDB = defaultDb,
  now: Date = new Date(),
): Promise<{ outcome: 'archived' | 'deleted'; resume: Resume }> {
  const result = await database.transaction(
    'rw',
    database.resumes,
    database.applications,
    async () => {
      if (!(await getResume(id, database))) return undefined;
      const at = now.toISOString();
      if (await isResumeReferenced(id, database)) {
        await database.resumes.update(id, { archived: true, updatedAt: at });
        return { outcome: 'archived' as const, resume: (await database.resumes.get(id))! };
      }
      await database.resumes.update(id, { deletedAt: at, updatedAt: at });
      return { outcome: 'deleted' as const, resume: (await database.resumes.get(id))! };
    },
  );
  if (!result) throw new NotFoundError(id);
  return result;
}

/**
 * Undoes a delete. `updatedAt` moves forward, as with applications. Fails once the bytes are
 * gone (the Undo window passed), since a resume without its file can't come back.
 */
export async function restoreResume(
  id: string,
  database: JobLogDB = defaultDb,
  now: Date = new Date(),
): Promise<Resume> {
  const restored = await database.transaction('rw', database.resumes, async () => {
    const resume = await database.resumes.get(id);
    if (!resume?.deletedAt || !resume.data) return undefined;
    await database.resumes.update(id, { deletedAt: undefined, updatedAt: now.toISOString() });
    return database.resumes.get(id);
  });
  if (!restored) throw new NotFoundError(id);
  return restored;
}

/**
 * Removes the bytes of resumes deleted at least `olderThanMs` ago, reclaiming storage while the
 * small record stays for future sync. Runs when an Undo toast ends (olderThanMs 0 for that one)
 * and at startup, for deletes whose panel closed first. Returns how many were cleared.
 */
export async function purgeDeletedResumeData(
  { id, olderThanMs = RESUME_UNDO_WINDOW_MS }: { id?: string; olderThanMs?: number } = {},
  database: JobLogDB = defaultDb,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = now.getTime() - olderThanMs;
  return database.resumes
    .filter(
      (resume) =>
        (id === undefined || resume.id === id) &&
        resume.data !== undefined &&
        resume.deletedAt !== undefined &&
        Date.parse(resume.deletedAt) <= cutoff,
    )
    .modify((resume) => {
      delete resume.data;
    });
}

/** The stored file as a Blob, for viewing or downloading; undefined once its bytes are gone. */
export function resumeBlob(resume: Resume): Blob | undefined {
  return resume.data ? new Blob([resume.data], { type: resume.mimeType }) : undefined;
}

/** A file name that's safe on every OS, for downloads. */
export function safeFileName(fileName: string): string {
  // Control characters and the characters Windows or macOS reject in file names.
  const unsafe = new Set('<>:"/\\|?*');
  const cleaned = Array.from(fileName, (char) =>
    char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || unsafe.has(char) ? '_' : char,
  )
    .join('')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 150);
  return cleaned || 'resume';
}
