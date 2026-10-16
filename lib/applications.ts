import {
  validateApplication,
  type ApplicationInput,
  type ApplicationValues,
  type FieldErrors,
} from './applicationInput';
import { db as defaultDb, type JobLogDB } from './db';
import { companyTitleKey, derivedFields } from './dedupe';
import type { Application } from './types';

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
  const at = now.toISOString();
  const application: Application = {
    id: crypto.randomUUID(),
    ...values,
    // Also enforced by the db hooks; set here so the returned object matches what's stored.
    ...storedDerivedFields(values),
    status: 'applied',
    statusHistory: [{ status: 'applied', at }],
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
export async function updateApplication(
  id: string,
  input: ApplicationInput,
  database: JobLogDB = defaultDb,
  now: Date = new Date(),
): Promise<Application> {
  const { values, errors } = validateApplication(input, now);
  if (!values) throw new ValidationError(errors);
  // Dexie wraps errors thrown inside a transaction, so "not found" comes out as undefined.
  const updated = await database.transaction('rw', database.applications, async () => {
    if (!(await getApplication(id, database))) return undefined;
    // Dexie's update() deletes a key whose new value is undefined, so cleared fields go away.
    const cleared = Object.fromEntries(OPTIONAL_FIELDS.map((field) => [field, undefined]));
    await database.applications.update(id, {
      ...cleared,
      ...values,
      updatedAt: now.toISOString(),
    });
    return database.applications.get(id);
  });
  if (!updated) throw new NotFoundError(id);
  return updated;
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
