import { SOURCE_SUGGESTIONS } from './applicationInput';
import type { WeekStart } from './locale';
import { inRange, resolveRange, type DateRange } from './stats';
import { ACTIVE_STATUSES, CLOSED_STATUSES, STATUSES } from './status';
import type { Application, Status } from './types';

export type SortKey = 'activity' | 'applied' | 'company';

/** Date applied filter (spec §4.4): presets with the Stats ranges' boundaries, or Custom. */
export const DATE_FILTERS = ['any', 'this-week', 'this-month', 'last-30-days', 'custom'] as const;
export type DateFilterKind = (typeof DATE_FILTERS)[number];
export interface DateFilter {
  kind: DateFilterKind;
  /**
   * The Custom range, both days included, in either order. Kept while a preset is picked, so
   * going back to Custom finds it again; only Custom uses it.
   */
  from?: string;
  to?: string;
}

export interface ListQuery {
  search: string;
  sort: SortKey;
  /** The statuses to show; none means every status (spec §4.4). */
  statuses: readonly Status[];
  /**
   * The sources to show, as their chips name them (`NO_SOURCE` for applications without one);
   * none means every source. Compared by `sourceKey`, so case and accents don't matter.
   */
  sources: readonly string[];
  dates: DateFilter;
}

export const DEFAULT_QUERY: ListQuery = {
  search: '',
  sort: 'activity',
  statuses: [],
  sources: [],
  dates: { kind: 'any' },
};

/** "Today" for the date filter: the presets are relative to it. */
export interface QueryContext {
  now: Date;
  weekStartsOn: WeekStart;
}

/** The status groups (spec §4.4): a chip that turns on all of its statuses. */
export const STATUS_GROUPS = { active: ACTIVE_STATUSES, closed: CLOSED_STATUSES } as const;
export type StatusGroup = keyof typeof STATUS_GROUPS;

/** Kept in the fixed status order, so the same choice always compares equal. */
function ordered(statuses: Iterable<Status>): Status[] {
  const chosen = new Set(statuses);
  return STATUSES.filter((status) => chosen.has(status));
}

/**
 * Whether two queries' filters and sort have the same effect (search aside): the same sort,
 * statuses and date filter, where the Custom dates count only while Custom is the filter (they
 * are kept for later otherwise). The filter sheet's Apply skips an equivalent draft, so it never
 * refreshes a frozen list for nothing.
 */
export function sameFiltersAndSort(a: ListQuery, b: ListQuery): boolean {
  return (
    a.sort === b.sort &&
    a.statuses.length === b.statuses.length &&
    a.statuses.every((status, index) => status === b.statuses[index]) &&
    sameSources(a.sources, b.sources) &&
    a.dates.kind === b.dates.kind &&
    (a.dates.kind !== 'custom' || (a.dates.from === b.dates.from && a.dates.to === b.dates.to))
  );
}

/** The source filter's "Not set" choice: applications without a source. */
export const NO_SOURCE = '';

/**
 * A source as the filter compares it: case, accents and spaces folded, so "glassdoor" and
 * "Glassdoor " are one choice. Empty for no source.
 */
export function sourceKey(source: string | undefined): string {
  return foldText(source ?? '');
}

function sameSources(a: readonly string[], b: readonly string[]): boolean {
  const keys = (sources: readonly string[]) => [...new Set(sources.map(sourceKey))].sort();
  const [x, y] = [keys(a), keys(b)];
  // By length too: "Not set" alone is the key '', which joins like no choice at all.
  return x.length === y.length && x.join('\n') === y.join('\n');
}

/** The source chips the form offers (spec §4.2), "Other" aside: they come first, in its order. */
const BUILT_IN_SOURCES = SOURCE_SUGGESTIONS.filter((source) => source !== 'Other');

/**
 * The source filter's chips (spec §4.4): only sources that applications use, so the row stays
 * short. The form's built-in sources first in the form's order, then the others A–Z, then
 * `NO_SOURCE` when an application has none. A chosen source no one uses any more stays, so it
 * can be turned off. Each is named as first written (a built-in by its own name).
 */
export function sourceOptions(
  used: readonly (string | undefined)[],
  chosen: readonly string[] = [],
): string[] {
  const named = new Map<string, string>();
  let unset = false;
  for (const source of [...used, ...chosen]) {
    const key = sourceKey(source);
    if (!key) unset = true;
    else if (!named.has(key)) named.set(key, source!.replace(/\s+/g, ' ').trim());
  }
  const builtInKeys = new Set(BUILT_IN_SOURCES.map(sourceKey));
  const builtIns = BUILT_IN_SOURCES.filter((source) => named.has(sourceKey(source)));
  const others = [...named]
    .filter(([key]) => !builtInKeys.has(key))
    .map(([, label]) => label)
    .sort((a, b) => companyCollator.compare(a, b));
  return [...builtIns, ...others, ...(unset ? [NO_SOURCE] : [])];
}

/** One source chip pressed: on if it was off, off if it was on (by `sourceKey`). */
export function toggleSource(sources: readonly string[], source: string): string[] {
  const key = sourceKey(source);
  return sources.some((chosen) => sourceKey(chosen) === key)
    ? sources.filter((chosen) => sourceKey(chosen) !== key)
    : [...sources, source];
}

/** One status chip pressed: on if it was off, off if it was on. */
export function toggleStatus(statuses: readonly Status[], status: Status): Status[] {
  return statuses.includes(status)
    ? statuses.filter((s) => s !== status)
    : ordered([...statuses, status]);
}

/** Whether a group's statuses are all on, some on, or none (its chip shows "mixed"). */
export function groupState(
  statuses: readonly Status[],
  group: StatusGroup,
): 'all' | 'some' | 'none' {
  const members = STATUS_GROUPS[group];
  const on = members.filter((status) => statuses.includes(status)).length;
  return on === members.length ? 'all' : on > 0 ? 'some' : 'none';
}

/** A group chip pressed: all its statuses off when they were all on, otherwise all on. */
export function toggleGroup(statuses: readonly Status[], group: StatusGroup): Status[] {
  const members = STATUS_GROUPS[group];
  return groupState(statuses, group) === 'all'
    ? statuses.filter((status) => !members.includes(status))
    : ordered([...statuses, ...members]);
}

/**
 * The dates a date filter keeps, or undefined when it keeps everything: Any time, or a Custom
 * range that isn't valid yet (the sheet says what's wrong).
 */
export function dateFilterRange(dates: DateFilter, context: QueryContext): DateRange | undefined {
  if (dates.kind === 'any') return undefined;
  return resolveRange(dates.kind, {
    ...context,
    custom: { from: dates.from, to: dates.to },
  });
}

/**
 * How many filters are on, for the filter button's badge (spec §4.4): one for a date range that
 * filters (not Any time, nor a Custom range that isn't valid yet), one for a status filter, one
 * for a source filter. Sort is never counted.
 */
export function activeFilterCount(query: ListQuery, context: QueryContext): number {
  return (
    (dateFilterRange(query.dates, context) ? 1 : 0) +
    (query.statuses.length > 0 ? 1 : 0) +
    (query.sources.length > 0 ? 1 : 0)
  );
}

/** The query with its filters cleared; search and sort stay. */
export function withoutFilters(query: ListQuery): ListQuery {
  return { ...query, statuses: [], sources: [], dates: { kind: 'any' } };
}

/**
 * Lowercase, Latin accents removed ("Société" → "societe"), whitespace collapsed. Only the
 * combining accents block is stripped: other marks carry meaning (Japanese ハ and バ differ only
 * by a dakuten) and symbols like ^ stay literal.
 */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesStatuses(app: Application, statuses: readonly Status[]): boolean {
  return statuses.length === 0 || statuses.includes(app.status);
}

function matchesSources(app: Application, sources: ReadonlySet<string>): boolean {
  return sources.size === 0 || sources.has(sourceKey(app.source));
}

/**
 * In the range by Date applied, by the same rule as Stats: a job without a usable one (Saved, or
 * Skip) is left out.
 */
function matchesDates(app: Application, range: DateRange | undefined): boolean {
  return !range || inRange(app.appliedAt, range);
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
 * Filters, searches and sorts (spec §4.4). Pure. Takes live rows (`listApplications` already
 * leaves out soft-deleted ones). Ties keep the input order.
 *
 * While the user works, a status change shouldn't move or hide the row under the pointer:
 * - `frozen`: rows it ranks keep their rank; rows it doesn't (new since) come first, newest
 *   first.
 * - `keep`: ids shown even if they no longer match (their status changed under a filter).
 */
export function queryApplications(
  apps: Application[],
  query: ListQuery,
  context: QueryContext,
  frozen?: ReadonlyMap<string, number>,
  keep?: ReadonlySet<string>,
): Application[] {
  const words = foldText(query.search).split(' ').filter(Boolean);
  const range = dateFilterRange(query.dates, context);
  const sources = new Set(query.sources.map(sourceKey));
  const kept = apps.filter(
    (app) =>
      (matchesStatuses(app, query.statuses) &&
        matchesSources(app, sources) &&
        matchesDates(app, range) &&
        matchesSearch(app, words)) ||
      keep?.has(app.id),
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
        // Both new since the freeze: newest first, whatever the sort.
        if (rx === undefined && ry === undefined) {
          return compare(x.app, y.app, 'activity') || x.index - y.index;
        }
      }
      return compare(x.app, y.app, query.sort) || x.index - y.index;
    })
    .map(({ app }) => app);
}

/** Ranks for `queryApplications`'s `frozen`: each id's position in an already-sorted list. */
export function rankOf(sorted: Application[]): Map<string, number> {
  return new Map(sorted.map((app, index) => [app.id, index]));
}
