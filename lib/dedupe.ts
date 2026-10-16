import type { JobLogDB } from './db';
import { normalizeUrl } from './normalizeUrl';
import type { Application } from './types';

/** Separates company from title inside the key; it can't appear in normalized user text. */
const SEPARATOR = '\u001f';

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .split(SEPARATOR)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Case-, whitespace- and Unicode-form-insensitive key for the company + title duplicate check
 * (spec §4.5). Undefined without a title: matching on company alone would flag every second role
 * at the same employer. Dexie leaves undefined values out of the index.
 */
export function companyTitleKey(company: string, title?: string): string | undefined {
  const c = normalizeText(company);
  const t = title === undefined ? '' : normalizeText(title);
  if (!c || !t) return undefined;
  return `${c}${SEPARATOR}${t}`;
}

/** The indexed fields derived from user input. Recompute whenever url, company or title change. */
export function derivedFields(input: { url: string; company: string; title?: string }) {
  return {
    urlNormalized: normalizeUrl(input.url),
    companyTitleKey: companyTitleKey(input.company, input.title),
  };
}

/**
 * Live applications that look like the same job: same normalized URL, or same company + title.
 * Excludes soft-deleted rows and `excludeId` (the record being edited). Newest first.
 */
export async function findDuplicates(
  database: JobLogDB,
  input: { url: string; company: string; title?: string },
  { excludeId }: { excludeId?: string } = {},
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
