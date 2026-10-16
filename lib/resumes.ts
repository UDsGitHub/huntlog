import { isResumeInUse, NotFoundError } from './applications';
import { db as defaultDb, type JobLogDB } from './db';
import type { Resume } from './types';

/** Spec §4.6: PDF, DOCX, DOC, TXT or RTF, up to 10 MB. */
export const MAX_RESUME_BYTES = 10 * 1024 * 1024;
export const MAX_RESUME_NAME_LENGTH = 100;
export const MAX_RESUME_NOTE_LENGTH = 500;
/** How long a deleted resume can be restored (the Undo toast) before its file goes. */
export const RESUME_UNDO_WINDOW_MS = 60 * 1000;
/**
 * The startup cleanup waits much longer: another window's Undo toast pauses while hovered or
 * focused, so a delete can stay undoable well past a minute. Normally the file goes when its
 * toast closes; this only catches panels that closed first.
 */
export const RESUME_STARTUP_PURGE_MS = 24 * 60 * 60 * 1000;

/**
 * Accepted formats: the stored type, and the bytes every file of that format starts with. The
 * type a browser reports varies by system (a .docx can arrive as application/zip, a .doc with
 * none at all), so it's ignored: the extension picks the format and the contents confirm it.
 */
const FORMATS: Record<string, { label: string; mimeType: string; signature?: number[] }> = {
  pdf: { label: 'PDF', mimeType: 'application/pdf', signature: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  docx: {
    label: 'DOCX',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    signature: [0x50, 0x4b], // PK: a zip archive
  },
  doc: {
    label: 'DOC',
    mimeType: 'application/msword',
    signature: [0xd0, 0xcf, 0x11, 0xe0], // OLE compound file
  },
  rtf: { label: 'RTF', mimeType: 'application/rtf', signature: [0x7b, 0x5c, 0x72, 0x74, 0x66] }, // {\rtf
  txt: { label: 'TXT', mimeType: 'text/plain' },
};

/** For the file picker's `accept`. */
export const RESUME_ACCEPT = Object.keys(FORMATS)
  .map((extension) => `.${extension}`)
  .join(',');

/** The minimal File surface used here, so tests can pass plain objects. */
export interface PickedFile {
  name: string;
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

function splitExtension(fileName: string): { base: string; extension: string } {
  const dot = fileName.lastIndexOf('.');
  return dot > 0
    ? { base: fileName.slice(0, dot), extension: fileName.slice(dot + 1) }
    : { base: fileName, extension: '' };
}

/** "PDF", "DOCX", …: the format label shown next to a resume's name. */
export function formatLabel(fileName: string): string {
  const extension = splitExtension(fileName).extension.toLowerCase();
  return FORMATS[extension]?.label ?? (extension.toUpperCase() || 'File');
}

const TOO_BIG = 'Choose a file of 10 MB or less.';

/**
 * Checks a picked file before reading it: an accepted extension and a reported size of 1 byte to
 * 10 MB. Returns the type to store. The contents are checked after reading (`checkContents`).
 */
export function checkResumeFile(
  file: Pick<PickedFile, 'name' | 'size'>,
): { mimeType: string } | { error: string } {
  const format = FORMATS[splitExtension(file.name).extension.toLowerCase()];
  if (!format) return { error: 'Choose a PDF, DOCX, DOC, TXT or RTF file.' };
  if (file.size <= 0) return { error: 'This file is empty.' };
  if (file.size > MAX_RESUME_BYTES) return { error: TOO_BIG };
  return { mimeType: format.mimeType };
}

/** The bytes actually read: within the size limits, and starting like their format should. */
export function checkContents(fileName: string, data: ArrayBuffer): string | undefined {
  if (data.byteLength <= 0) return 'This file is empty.';
  if (data.byteLength > MAX_RESUME_BYTES) return TOO_BIG;
  const format = FORMATS[splitExtension(fileName).extension.toLowerCase()];
  const head = new Uint8Array(data, 0, Math.min(data.byteLength, 8));
  if (format?.signature && !format.signature.every((byte, i) => head[i] === byte)) {
    return `This file doesn't look like a ${format.label}. Check that it opens, then try again.`;
  }
  return undefined;
}

/** "Backend v3.pdf" → "Backend v3": the suggested display name. */
export function defaultResumeName(fileName: string): string {
  const base = splitExtension(fileName).base.replace(/\s+/g, ' ').trim();
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
  file: PickedFile,
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
  // The reported size can differ from what's read (the file changed after picking): limits and
  // the stored size use the bytes actually read.
  const data = await file.arrayBuffer();
  const contentError = checkContents(file.name, data);
  if (contentError) throw new ResumeValidationError({ file: contentError });

  const at = now.toISOString();
  const resume: Resume = {
    id: crypto.randomUUID(),
    ...values,
    fileName: file.name,
    mimeType: checked.mimeType,
    size: data.byteLength,
    archived: false,
    createdAt: at,
    updatedAt: at,
  };
  await database.transaction('rw', database.resumes, database.resumeFiles, async () => {
    await database.resumes.add(resume);
    await database.resumeFiles.add({ id: resume.id, data });
  });
  return resume;
}

/**
 * Live (not soft-deleted) resumes, newest first, without their files. Every resume read goes
 * through this module, so the soft-delete filter lives in one place (as `lib/applications.ts`
 * does for applications).
 */
export function listResumes(database: JobLogDB = defaultDb): Promise<Resume[]> {
  return database.resumes
    .orderBy('createdAt')
    .reverse()
    .filter((resume) => !resume.deletedAt)
    .toArray();
}

/** A live resume's metadata, or undefined. */
export async function getResume(
  id: string,
  database: JobLogDB = defaultDb,
): Promise<Resume | undefined> {
  const resume = await database.resumes.get(id);
  return resume && !resume.deletedAt ? resume : undefined;
}

/** Whether a live resume still has its file, checked by key without loading it. */
export async function resumeFileExists(
  id: string,
  database: JobLogDB = defaultDb,
): Promise<boolean> {
  if (!(await getResume(id, database))) return false;
  return (await database.resumeFiles.where(':id').equals(id).count()) > 0;
}

/** A live resume's file as a Blob, to view or download; undefined if it's gone. */
export async function getResumeBlob(
  id: string,
  database: JobLogDB = defaultDb,
): Promise<{ resume: Resume; blob: Blob } | undefined> {
  const [resume, file] = await Promise.all([getResume(id, database), database.resumeFiles.get(id)]);
  if (!resume || !file) return undefined;
  return { resume, blob: new Blob([file.data], { type: resume.mimeType }) };
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

/**
 * Renames a resume, and sets its note when `note` is given (an empty note clears it; leaving it
 * out keeps it). Applications show the current name, so none of them change.
 */
export async function updateResume(
  id: string,
  fields: ResumeFields,
  database: JobLogDB = defaultDb,
  now: Date = new Date(),
): Promise<Resume> {
  const { values, errors } = checkFields(fields);
  if (!values) throw new ResumeValidationError(errors);
  const changes: Partial<Resume> = { name: values.name };
  if ('note' in fields) changes.note = values.note;
  return updateLive(id, changes, database, now);
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
 * Spec §4.6: a resume that an application uses (see `isResumeInUse`) is archived, never deleted.
 * Otherwise it's soft-deleted: restorable with Undo, its file removed after RESUME_UNDO_WINDOW_MS.
 */
export async function deleteResume(
  id: string,
  database: JobLogDB = defaultDb,
  now: Date = new Date(),
): Promise<{ outcome: 'archived' | 'deleted'; resume: Resume; wasArchived: boolean }> {
  const result = await database.transaction(
    'rw',
    database.resumes,
    database.applications,
    async () => {
      const before = await getResume(id, database);
      if (!before) return undefined;
      const at = now.toISOString();
      const inUse = await isResumeInUse(id, database, now);
      await database.resumes.update(
        id,
        inUse ? { archived: true, updatedAt: at } : { deletedAt: at, updatedAt: at },
      );
      return {
        outcome: inUse ? ('archived' as const) : ('deleted' as const),
        resume: (await database.resumes.get(id))!,
        // An Undo of "archived instead" must not unarchive one that was archived already.
        wasArchived: before.archived,
      };
    },
  );
  if (!result) throw new NotFoundError(id);
  return result;
}

/**
 * Undoes a delete. `updatedAt` moves forward, as with applications. Fails once the file is gone
 * (the Undo window passed): a resume without its file can't come back.
 */
export async function restoreResume(
  id: string,
  database: JobLogDB = defaultDb,
  now: Date = new Date(),
): Promise<Resume> {
  const restored = await database.transaction(
    'rw',
    database.resumes,
    database.resumeFiles,
    async () => {
      const resume = await database.resumes.get(id);
      if (!resume?.deletedAt || !(await database.resumeFiles.get(id))) return undefined;
      await database.resumes.update(id, { deletedAt: undefined, updatedAt: now.toISOString() });
      return database.resumes.get(id);
    },
  );
  if (!restored) throw new NotFoundError(id);
  return restored;
}

/**
 * Removes the files of resumes deleted at least `olderThanMs` ago, reclaiming storage while the
 * small record stays for future sync. Runs when an Undo toast ends (for that resume, olderThanMs
 * 0) and at startup, for deletes whose panel closed first. Returns how many files went. Reads
 * metadata only; files are deleted by key, never loaded.
 */
export async function purgeDeletedResumeData(
  { id, olderThanMs = RESUME_UNDO_WINDOW_MS }: { id?: string; olderThanMs?: number } = {},
  database: JobLogDB = defaultDb,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = now.getTime() - olderThanMs;
  const isDue = (resume: Resume) =>
    resume.deletedAt !== undefined && Date.parse(resume.deletedAt) <= cutoff;
  return database.transaction('rw', database.resumes, database.resumeFiles, async () => {
    const due =
      id === undefined
        ? await database.resumes.filter(isDue).primaryKeys()
        : await database.resumes.get(id).then((resume) => (resume && isDue(resume) ? [id] : []));
    const present = (await database.resumeFiles.bulkGet(due)).flatMap((file) =>
      file ? [file.id] : [],
    );
    await database.resumeFiles.bulkDelete(present);
    return present.length;
  });
}

/**
 * A file name that's safe on every OS, for downloads: control characters and the characters
 * Windows or macOS reject become "_", it can't start or end with dots or spaces, and a long name
 * is shortened (by characters, keeping the extension).
 */
export function safeFileName(fileName: string, maxLength = 150): string {
  const unsafe = new Set('<>:"/\\|?*');
  const clean = (text: string) =>
    Array.from(text, (char) =>
      char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || unsafe.has(char) ? '_' : char,
    )
      .join('')
      .replace(/^[.\s]+|[.\s]+$/g, '');
  const { base, extension } = splitExtension(fileName);
  const ext = clean(extension);
  const room = Math.max(1, maxLength - (ext ? Array.from(ext).length + 1 : 0));
  const name = clean(Array.from(clean(base)).slice(0, room).join(''));
  if (!name) return ext ? `resume.${ext}` : 'resume';
  return ext ? `${name}.${ext}` : name;
}
