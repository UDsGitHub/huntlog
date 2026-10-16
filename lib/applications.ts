import { db as defaultDb, type JobLogDB } from './db';
import { todayLocal } from './dates';
import type { Application } from './types';

export interface NewApplicationInput {
  url: string;
  company: string;
  title?: string;
}

export type FieldErrors = Partial<Record<keyof NewApplicationInput, string>>;

export class ValidationError extends Error {
  constructor(readonly fields: FieldErrors) {
    super('Invalid application');
    this.name = 'ValidationError';
  }
}

/** Trims, adds https:// when no scheme is given, and accepts only http(s) URLs. */
export function normalizeInputUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // A colon followed by a digit is a port (`host:8443/…`), not a scheme.
  const withScheme = /^[a-z][a-z\d+.-]*:(?!\d)/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;
  return parsed.href;
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

export function validateNewApplication(input: NewApplicationInput): {
  values: NewApplicationInput | null;
  errors: FieldErrors;
} {
  const errors: FieldErrors = {};
  const company = input.company.trim();
  const url = normalizeInputUrl(input.url);
  if (!input.url.trim()) errors.url = 'Enter the job posting URL.';
  else if (!url) errors.url = 'Enter a valid web address (http or https).';
  if (!company) errors.company = 'Enter the company name.';
  const title = input.title?.trim() || undefined;
  if (url && company) return { values: { url, company, ...(title && { title }) }, errors };
  return { values: null, errors };
}

export async function addApplication(
  input: NewApplicationInput,
  database: JobLogDB = defaultDb,
  now: Date = new Date(),
): Promise<Application> {
  const { values, errors } = validateNewApplication(input);
  if (!values) throw new ValidationError(errors);
  const at = now.toISOString();
  const application: Application = {
    id: crypto.randomUUID(),
    url: values.url,
    company: values.company,
    ...(values.title && { title: values.title }),
    status: 'applied',
    statusHistory: [{ status: 'applied', at }],
    appliedAt: todayLocal(now),
    createdAt: at,
    updatedAt: at,
  };
  await database.applications.add(application);
  return application;
}

/** Live (not soft-deleted) applications, most recently updated first. */
export function listApplications(database: JobLogDB = defaultDb): Promise<Application[]> {
  return database.applications
    .orderBy('updatedAt')
    .reverse()
    .filter((a) => !a.deletedAt)
    .toArray();
}
