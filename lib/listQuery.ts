import { ACTIVE_STATUSES, CLOSED_STATUSES, isStatus } from './status';
import type { Application, Status } from './types';

/** Status filter (spec §4.4): everything, a group, or one status. */
export type StatusFilter = 'all' | 'active' | 'closed' | Status;
export type SortKey = 'activity' | 'applied' | 'company';

export interface ListQuery {
  filter: StatusFilter;
  search: string;
  sort: SortKey;
}

export const DEFAULT_QUERY: ListQuery = { filter: 'all', search: '', sort: 'activity' };

export function isStatusFilter(value: unknown): value is StatusFilter {
  return value === 'all' || value === 'active' || value === 'closed' || isStatus(value);
}

/** Lowercase, accents removed ("Société" → "societe"), whitespace collapsed. */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesFilter(app: Application, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return ACTIVE_STATUSES.includes(app.status);
  if (filter === 'closed') return CLOSED_STATUSES.includes(app.status);
  return app.status === filter;
}

/**
 * Search (spec §4.4) over company, title, location and notes: case- and accent-insensitive,
 * every word must appear somewhere. Plain substring matching, so `C++` or `.NET` are literal.
 */
function matchesSearch(app: Application, words: string[]): boolean {
  if (words.length === 0) return true;
  const haystack = foldText(
    [app.company, app.title, app.location, app.notes].filter(Boolean).join(' \n '),
  );
  return words.every((word) => haystack.includes(word));
}

const companyCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function compare(a: Application, b: Application, sort: SortKey): number {
  switch (sort) {
    case 'activity':
      // Newest first. ISO timestamps compare in time order.
      return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
    case 'applied':
      // Newest first; undated (e.g. Saved) last.
      if (!a.appliedAt || !b.appliedAt) return a.appliedAt ? -1 : b.appliedAt ? 1 : 0;
      return a.appliedAt < b.appliedAt ? 1 : a.appliedAt > b.appliedAt ? -1 : 0;
    case 'company':
      return companyCollator.compare(a.company, b.company);
  }
}

/**
 * Filters, searches and sorts (spec §4.4). Pure. Ties keep the input order.
 *
 * `frozen` keeps rows in place while the user works: a status change bumps `updatedAt`, and
 * under "Last activity" the row would jump to the top from under the pointer. Rows it ranks keep
 * their rank; rows it doesn't (new since) come first, newest first.
 */
export function queryApplications(
  apps: Application[],
  query: ListQuery,
  frozen?: ReadonlyMap<string, number>,
): Application[] {
  const words = foldText(query.search).split(' ').filter(Boolean);
  const kept = apps.filter(
    (app) => !app.deletedAt && matchesFilter(app, query.filter) && matchesSearch(app, words),
  );
  const rank = (app: Application) => frozen?.get(app.id);
  return kept
    .map((app, index) => ({ app, index }))
    .sort((x, y) => {
      if (frozen) {
        const [rx, ry] = [rank(x.app), rank(y.app)];
        if (rx === undefined && ry !== undefined) return -1;
        if (ry === undefined && rx !== undefined) return 1;
        if (rx !== undefined && ry !== undefined && rx !== ry) return rx - ry;
      }
      return compare(x.app, y.app, query.sort) || x.index - y.index;
    })
    .map(({ app }) => app);
}

/** Ranks for `queryApplications`'s `frozen`: each id's position in an already-sorted list. */
export function rankOf(sorted: Application[]): Map<string, number> {
  return new Map(sorted.map((app, index) => [app.id, index]));
}
