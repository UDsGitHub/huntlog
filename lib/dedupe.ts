import { normalizeUrl } from './normalizeUrl';

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
export function companyTitleKey(company: unknown, title?: unknown): string | undefined {
  const c = typeof company === 'string' ? normalizeText(company) : '';
  const t = typeof title === 'string' ? normalizeText(title) : '';
  if (!c || !t) return undefined;
  return `${c}${SEPARATOR}${t}`;
}

/**
 * The indexed fields derived from user input. `lib/db.ts` hooks recompute them on every write
 * that touches url, company or title. Tolerates malformed rows (non-string fields) so one bad
 * record can't break a migration.
 */
export function derivedFields(input: { url?: unknown; company?: unknown; title?: unknown }) {
  return {
    urlNormalized: normalizeUrl(input.url),
    companyTitleKey: companyTitleKey(input.company, input.title),
  };
}
