import {
  checkAppliedAt,
  validateApplication,
  type ApplicationInput,
  type ApplicationValues,
  type FieldErrors,
} from './applicationInput';
import { db as defaultDb, type JobLogDB } from './db';
import { companyTitleKey, derivedFields } from './dedupe';
import { applyStatusChange, appliedAtAction, editHistoryDate } from './status';
import type { Application, Status } from './types';

export class ValidationError extends Error {
  constructor(readonly fields: FieldErrors) {
    super('Invalid application');
    this.name = 'ValidationError';
  }
}

/** Href that is safe to render, or undefined. Rows can arrive from paths other than the add form. */
export function safeHref(url: string): string | undefined {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

export async function addApplication(
  input: ApplicationInput,
  database: JobLogDB = defaultDb,
  now: Date = new Date(),
): Promise<Application> {
  const { values, errors } = validateApplication(input, now);
  if (!values) throw new ValidationError(errors);
  return insertValidated(values, database, now);
}

async function insertValidated(
  values: ApplicationValues,
  database: JobLogDB,
  now: Date,
): Promise<Application> {
  const at = now.toISOString();
  const application: Application = {
    id: crypto.randomUUID(),
    ...values,
    // Also enforced by the db hooks; set here so the returned object matches what's stored.
    ...storedDerivedFields(values),
    status: values.status ?? 'applied',
    statusHistory: [{ status: values.status ?? 'applied', at }],
    createdAt: at,
    updatedAt: at,
  };
  await database.applications.add(application);
  return application;
}

function storedDerivedFields(values: ApplicationValues) {
  const key = companyTitleKey(values.company, values.title);
  return {
    urlNormalized: derivedFields(values).urlNormalized,
    ...(key && { companyTitleKey: key }),
  };
}

/** Live (not soft-deleted) applications, most recently updated first. */
export function listApplications(database: JobLogDB = defaultDb): Promise<Application[]> {
  return database.applications
    .orderBy('updatedAt')
    .reverse()
    .filter((a) => !a.deletedAt)
    .toArray();
}

/**
 * Live applications that look like the same job: same normalized URL, or same company + title.
 * Pass validated values (what would be stored, e.g. with https:// already added), not raw input.
 * Excludes soft-deleted rows and `excludeId` (the record being edited). Newest first.
 */
export async function findDuplicates(
  input: { url: string; company: string; title?: string },
  { excludeId }: { excludeId?: string } = {},
  database: JobLogDB = defaultDb,
): Promise<Application[]> {
  const { urlNormalized, companyTitleKey: key } = derivedFields(input);
  const [byUrl, byTitle] = await Promise.all([
    database.applications.where('urlNormalized').equals(urlNormalized).toArray(),
    key ? database.applications.where('companyTitleKey').equals(key).toArray() : [],
  ]);
  const unique = new Map<string, Application>();
  for (const app of [...byUrl, ...byTitle]) {
    if (!app.deletedAt && app.id !== excludeId) unique.set(app.id, app);
  }
  return [...unique.values()].sort((a, b) =>
    a.updatedAt === b.updatedAt ? 0 : a.updatedAt < b.updatedAt ? 1 : -1,
  );
}

export class NotFoundError extends Error {
  constructor(id: string) {
    super(`No application ${id}`);
    this.name = 'NotFoundError';
  }
}

/** Optional fields an edit can clear; anything not in the new values is removed. */
const OPTIONAL_FIELDS = [
  'title',
  'location',
  'workMode',
  'salaryMin',
  'salaryMax',
  'salaryCurrency',
  'salaryPeriod',
  'source',
  'notes',
  'appliedAt',
] as const;

/** A live (not soft-deleted) application, or undefined. */
export async function getApplication(
  id: string,
  database: JobLogDB = defaultDb,
): Promise<Application | undefined> {
  const app = await database.applications.get(id);
  return app && !app.deletedAt ? app : undefined;
}

/**
 * Replaces the user-editable fields. Status, history, `createdAt` and `id` are kept; derived
 * fields are recomputed by the db hooks. Fails for missing or soft-deleted rows.
 */
/**
 * Replaces the user-editable fields, skipping the duplicate check. Status changes are recorded
 * like a chip change (see saveApplication); `createdAt` and `id` are kept. Fails for missing or
 * soft-deleted rows.
 */
export async function updateApplication(
  id: string,
  input: ApplicationInput,
  database: JobLogDB = defaultDb,
  now: Date = new Date(),
): Promise<Application> {
  const result = await saveApplication(input, { id, allowDuplicate: true }, database, now);
  if (!('saved' in result)) throw new Error('unreachable: duplicates were allowed');
  return result.saved;
}

export interface DuplicateMatch {
  application: Application;
  /** Why it matched, for the warning's wording. */
  reason: 'url' | 'companyTitle';
}

export type SaveResult = { saved: Application } | { duplicates: DuplicateMatch[] };

type Outcome =
  | { kind: 'saved'; application: Application }
  | { kind: 'duplicates'; matches: DuplicateMatch[] }
  | { kind: 'invalid'; errors: FieldErrors }
  | { kind: 'notFound' };

/**
 * The form's single save path (spec §4.5): validates once, checks for duplicates unless
 * `allowDuplicate` ("Save anyway"), then adds, or updates `id`. Returns the matches instead of
 * saving when there are any. An edit that leaves url, company and title as they were isn't
 * re-checked, so a job kept with "Save anyway" doesn't warn on every later edit.
 *
 * An edit reads, validates and writes in one transaction, so a status change made elsewhere
 * meanwhile (the chip, another window) can't slip between validation and the write. A status
 * changed in the form follows the chip's rules (spec §4.3): one history entry, and moving to
 * Applied with no date sets today.
 *
 * Throws ValidationError or NotFoundError.
 */
export async function saveApplication(
  input: ApplicationInput,
  { id, allowDuplicate = false }: { id?: string; allowDuplicate?: boolean } = {},
  database: JobLogDB = defaultDb,
  now: Date = new Date(),
): Promise<SaveResult> {
  // Dexie wraps errors thrown inside a transaction, so outcomes come back as values.
  const outcome = await database.transaction(
    'rw',
    database.applications,
    async (): Promise<Outcome> => {
      const current = id === undefined ? undefined : await getApplication(id, database);
      if (id !== undefined && !current) return { kind: 'notFound' };
      const { values, errors } = validateApplication(input, now, undefined, { current });
      if (!values) return { kind: 'invalid', errors };

      const derived = derivedFields(values);
      const unchanged =
        current !== undefined &&
        derived.urlNormalized === current.urlNormalized &&
        derived.companyTitleKey === current.companyTitleKey;
      if (!allowDuplicate && !unchanged) {
        const matches = await findDuplicates(values, { excludeId: id }, database);
        if (matches.length > 0) {
          return {
            kind: 'duplicates',
            matches: matches.map((application) => ({
              application,
              reason: application.urlNormalized === derived.urlNormalized ? 'url' : 'companyTitle',
            })),
          };
        }
      }
      const application = current
        ? await writeUpdate(current, values, database, now)
        : await insertValidated(values, database, now);
      return { kind: 'saved', application };
    },
  );
  switch (outcome.kind) {
    case 'saved':
      return { saved: outcome.application };
    case 'duplicates':
      return { duplicates: outcome.matches };
    case 'invalid':
      throw new ValidationError(outcome.errors);
    case 'notFound':
      throw new NotFoundError(id!);
  }
}

/** Writes an edit inside saveApplication's transaction. */
async function writeUpdate(
  current: Application,
  values: ApplicationValues,
  database: JobLogDB,
  now: Date,
): Promise<Application> {
  // Dexie's update() deletes a key whose new value is undefined, so cleared fields go away.
  const cleared = Object.fromEntries(OPTIONAL_FIELDS.map((field) => [field, undefined]));
  let statusChange: Partial<Application> = {};
  if (values.status && values.status !== current.status) {
    // Same rules as the chip. The form's own Date applied wins; with none, Applied sets today.
    const changed = applyStatusChange(current, values.status, { now });
    statusChange = {
      statusHistory: changed.statusHistory,
      ...(values.appliedAt === undefined &&
        appliedAtAction(current, values.status) === 'set-today' && {
          appliedAt: changed.appliedAt,
        }),
    };
  }
  await database.applications.update(current.id, {
    ...cleared,
    ...values,
    ...statusChange,
    updatedAt: now.toISOString(),
  });
  return (await database.applications.get(current.id))!;
}

/** Soft delete (spec §5): sets `deletedAt`, so every read hides it and it can be restored. */
export async function softDeleteApplication(
  id: string,
  database: JobLogDB = defaultDb,
  now: Date = new Date(),
): Promise<Application> {
  const deleted = await database.transaction('rw', database.applications, async () => {
    if (!(await getApplication(id, database))) return undefined;
    const at = now.toISOString();
    await database.applications.update(id, { deletedAt: at, updatedAt: at });
    return database.applications.get(id);
  });
  if (!deleted) throw new NotFoundError(id);
  return deleted;
}

/**
 * Undoes a soft delete. `updatedAt` moves forward rather than back: with future sync
 * (last write wins on `updatedAt`), the restore has to be the newest write.
 */
export async function restoreApplication(
  id: string,
  database: JobLogDB = defaultDb,
  now: Date = new Date(),
): Promise<Application> {
  const restored = await database.transaction('rw', database.applications, async () => {
    const app = await database.applications.get(id);
    if (!app?.deletedAt) return undefined;
    await database.applications.update(id, { deletedAt: undefined, updatedAt: now.toISOString() });
    return database.applications.get(id);
  });
  if (!restored) throw new NotFoundError(id);
  return restored;
}

export interface StatusChange {
  before: Application;
  after: Application;
}

/**
 * Changes the status (spec §4.3): appends a history entry and applies the Date applied rule.
 * `appliedAt` answers the "When did you apply?" prompt; omit it for Skip. Picking the current
 * status changes nothing and returns `after === before`.
 */
export async function setStatus(
  id: string,
  next: Status,
  { appliedAt }: { appliedAt?: string } = {},
  database: JobLogDB = defaultDb,
  now: Date = new Date(),
): Promise<StatusChange> {
  if (appliedAt !== undefined) {
    const error = checkAppliedAt(appliedAt, now);
    if (error) throw new ValidationError({ appliedAt: error });
  }
  const change = await database.transaction('rw', database.applications, async () => {
    const before = await getApplication(id, database);
    if (!before) return undefined;
    const after = applyStatusChange(before, next, { now, appliedAt });
    if (after !== before) await database.applications.put(after);
    return { before, after };
  });
  if (!change) throw new NotFoundError(id);
  return change;
}

/**
 * Undoes a status change by restoring the record as it was: the history entry the change
 * appended is removed (the one exception to append-only history, since a mis-tap must not count
 * in stats) and a Date applied the change set is cleared. Only if nothing changed it since (`updatedAt` still matches); returns false
 * otherwise. `updatedAt` moves forward, so with last-write-wins sync the undo is the newest.
 */
export async function undoStatusChange(
  { before, after }: StatusChange,
  database: JobLogDB = defaultDb,
  now: Date = new Date(),
): Promise<boolean> {
  if (after === before) return false;
  return database.transaction('rw', database.applications, async () => {
    const current = await database.applications.get(before.id);
    // Unchanged since the tap: same timestamp, status and history length. The extra checks
    // tell apart two changes made within the same millisecond.
    const untouched =
      current &&
      !current.deletedAt &&
      current.updatedAt === after.updatedAt &&
      current.status === after.status &&
      (current.statusHistory?.length ?? 0) === after.statusHistory.length;
    if (!untouched) return false;
    await database.applications.put({ ...before, updatedAt: now.toISOString() });
    return true;
  });
}

/**
 * Changes the date of one status history entry (spec §4.3). The entry is identified by its
 * index and its current timestamp, so an entry that changed meanwhile (another window, an
 * Undo) isn't edited by mistake. Returns the updated application, or the reason it can't.
 */
export async function updateHistoryDate(
  id: string,
  entry: { index: number; at: string },
  date: string,
  database: JobLogDB = defaultDb,
  now: Date = new Date(),
): Promise<{ application: Application } | { error: string }> {
  const result = await database.transaction('rw', database.applications, async () => {
    const current = await getApplication(id, database);
    if (!current) return undefined;
    if (current.statusHistory?.[entry.index]?.at !== entry.at) {
      return { error: 'This entry changed meanwhile. Check the date and try again.' };
    }
    const edited = editHistoryDate(current, entry.index, date, now);
    if ('application' in edited) await database.applications.put(edited.application);
    return edited;
  });
  if (!result) throw new NotFoundError(id);
  return result;
}
