import { isValidLocalDate, parseLocalDate, todayLocal } from './dates';
import type { WeekStart } from './locale';
import { firstEnteredAt, localDateOf, STATUSES } from './status';
import type { Application, Status } from './types';

/**
 * Stats (spec §4.7), pure: applications, a range and the week start in, numbers out. Every date
 * is a local calendar date (YYYY-MM-DD), which compares correctly as a string.
 */

export type RangeKind =
  'this-week' | 'last-7-days' | 'this-month' | 'last-30-days' | 'this-year' | 'all-time' | 'custom';

export const RANGE_KINDS: readonly RangeKind[] = [
  'this-week',
  'last-7-days',
  'this-month',
  'last-30-days',
  'this-year',
  'all-time',
  'custom',
];

export const RANGE_LABELS: Record<RangeKind, string> = {
  'this-week': 'This week',
  'last-7-days': 'Last 7 days',
  'this-month': 'This month',
  'last-30-days': 'Last 30 days',
  'this-year': 'This year',
  'all-time': 'All time',
  custom: 'Custom',
};

/** Both days included. */
export interface DateRange {
  from: string;
  to: string;
}

/** The date `days` after (or before) a YYYY-MM-DD date. Calendar days, so DST can't shift it. */
export function addDays(date: string, days: number): string {
  const d = parseLocalDate(date);
  if (!d) throw new RangeError(`Not a date: ${date}`);
  return todayLocal(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
}

/** The first day of the week containing `date`. */
export function startOfWeek(date: string, weekStartsOn: WeekStart): string {
  const day = parseLocalDate(date)!.getDay();
  return addDays(date, -((day - weekStartsOn + 7) % 7));
}

/** Days from `from` to `to`, both included (1 for the same day). */
export function daysBetween(from: string, to: string): number {
  const a = parseLocalDate(from)!;
  const b = parseLocalDate(to)!;
  // Date.UTC: whole days, whatever DST does in between.
  const utc = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((utc(b) - utc(a)) / 86_400_000) + 1;
}

/** The earliest date anything happened: a Date applied or a status entry. */
function earliestDate(apps: readonly Application[]): string | undefined {
  let earliest: string | undefined;
  for (const app of apps) {
    const dates = (app.statusHistory ?? []).map((entry) => localDateOf(entry.at));
    if (app.appliedAt && isValidLocalDate(app.appliedAt)) dates.push(app.appliedAt);
    for (const date of dates) if (earliest === undefined || date < earliest) earliest = date;
  }
  return earliest;
}

/**
 * The dates a range covers. This week, month and year are whole calendar periods (the chart
 * shows the days still ahead); Last 7 and Last 30 days end today. All time runs from the first
 * thing logged to today. Custom is the dates given, in order; undefined if either is invalid.
 */
export function resolveRange(
  kind: RangeKind,
  {
    now = new Date(),
    weekStartsOn,
    apps = [],
    custom,
  }: {
    now?: Date;
    weekStartsOn: WeekStart;
    apps?: readonly Application[];
    custom?: Partial<DateRange>;
  },
): DateRange | undefined {
  const today = todayLocal(now);
  const [year, month] = [now.getFullYear(), now.getMonth()];
  switch (kind) {
    case 'this-week': {
      const from = startOfWeek(today, weekStartsOn);
      return { from, to: addDays(from, 6) };
    }
    case 'last-7-days':
      return { from: addDays(today, -6), to: today };
    case 'this-month':
      return {
        from: todayLocal(new Date(year, month, 1)),
        to: todayLocal(new Date(year, month + 1, 0)),
      };
    case 'last-30-days':
      return { from: addDays(today, -29), to: today };
    case 'this-year':
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    case 'all-time': {
      const earliest = earliestDate(apps);
      return { from: earliest && earliest < today ? earliest : today, to: today };
    }
    case 'custom': {
      const { from, to } = custom ?? {};
      if (!from || !to || !isValidLocalDate(from) || !isValidLocalDate(to)) return undefined;
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

// Validated first: an invalid stored date (old or imported data) must not compare into a range.
const inRange = (date: string | undefined, range: DateRange) =>
  date !== undefined && isValidLocalDate(date) && date >= range.from && date <= range.to;

/** Statuses that mean the employer answered (spec §4.7 response rate). */
export const RESPONSE_STATUSES: readonly Status[] = [
  'screening',
  'interviewing',
  'offer',
  'accepted',
  'rejected',
];

/** Interviewing, or a later stage that can only come after interviews. */
const INTERVIEW_STATUSES: readonly Status[] = ['interviewing', 'offer', 'accepted'];

/** Whether the application has ever been in any of `statuses` (its history, or now). */
function everIn(app: Application, statuses: readonly Status[]): boolean {
  return (
    statuses.includes(app.status) ||
    (app.statusHistory ?? []).some((entry) => statuses.includes(entry.status))
  );
}

/** Whether the application first entered `status` within the range. */
function firstEnteredIn(app: Application, status: Status, range: DateRange): boolean {
  const at = firstEnteredAt(app, status);
  return at !== undefined && inRange(localDateOf(at), range);
}

export interface Rate {
  count: number;
  total: number;
  /** 0–100, rounded; undefined when nothing was applied in the range. */
  percent?: number;
}

function rate(count: number, total: number): Rate {
  return total === 0
    ? { count, total }
    : { count, total, percent: Math.round((count / total) * 100) };
}

export interface ActivityBucket {
  /** First day of the bucket, clamped to the range. */
  from: string;
  /** Last day of the bucket, clamped to the range. */
  to: string;
  count: number;
}

export interface Activity {
  unit: 'day' | 'week';
  buckets: ActivityBucket[];
}

export interface Stats {
  range: DateRange;
  /** Applications whose Date applied falls in the range. */
  applied: number;
  /** Applications that first entered Interviewing in the range. */
  interviews: number;
  /** Applications that first entered Offer in the range. */
  offers: number;
  /** Of those applied in the range, the ones that got past Applied (ever, not only in range). */
  responseRate: Rate;
  /** Of those applied in the range, the ones that reached Interviewing or later. */
  interviewRate: Rate;
  /** Where the applications applied in the range stand now, in pipeline order; no zero rows. */
  outcomes: { status: Status; count: number }[];
  activity: Activity;
}

/** Ranges up to this many days chart per day; longer ones per week (spec §4.7). */
export const MAX_DAILY_DAYS = 31;

/** Applications per day or per week across the range, by Date applied. */
export function activity(
  applied: readonly Application[],
  range: DateRange,
  weekStartsOn: WeekStart,
): Activity {
  const unit = daysBetween(range.from, range.to) <= MAX_DAILY_DAYS ? 'day' : 'week';
  const buckets: ActivityBucket[] = [];
  let start = unit === 'day' ? range.from : startOfWeek(range.from, weekStartsOn);
  while (start <= range.to) {
    const next = addDays(start, unit === 'day' ? 1 : 7);
    const from = start < range.from ? range.from : start;
    const last = addDays(next, -1);
    buckets.push({ from, to: last > range.to ? range.to : last, count: 0 });
    start = next;
  }
  for (const app of applied) {
    // Buckets are in order and contiguous: the last one starting on or before the date.
    const bucket = buckets.findLast((b) => b.from <= app.appliedAt!);
    if (bucket) bucket.count++;
  }
  return { unit, buckets };
}

export function computeStats(
  apps: readonly Application[],
  range: DateRange,
  weekStartsOn: WeekStart,
): Stats {
  const live = apps.filter((app) => !app.deletedAt);
  // Without a Date applied (Skip), a job isn't counted as applied (spec §4.7).
  const applied = live.filter((app) => inRange(app.appliedAt, range));
  const counts = new Map<Status, number>();
  for (const app of applied) counts.set(app.status, (counts.get(app.status) ?? 0) + 1);
  return {
    range,
    applied: applied.length,
    interviews: live.filter((app) => firstEnteredIn(app, 'interviewing', range)).length,
    offers: live.filter((app) => firstEnteredIn(app, 'offer', range)).length,
    responseRate: rate(
      applied.filter((app) => everIn(app, RESPONSE_STATUSES)).length,
      applied.length,
    ),
    interviewRate: rate(
      applied.filter((app) => everIn(app, INTERVIEW_STATUSES)).length,
      applied.length,
    ),
    outcomes: STATUSES.filter((status) => counts.has(status)).map((status) => ({
      status,
      count: counts.get(status)!,
    })),
    activity: activity(applied, range, weekStartsOn),
  };
}
