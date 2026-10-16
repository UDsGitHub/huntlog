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
