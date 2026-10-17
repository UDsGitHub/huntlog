import {
  checkPastLocalDate,
  isValidLocalDate,
  MIN_YEAR,
  parseLocalDate,
  todayLocal,
} from './dates';
import type { WeekStart } from './locale';
import { localDateOf, STATUSES } from './status';
import type { Application, Status } from './types';

/**
 * Stats (spec §4.7), pure: applications, a range and the week start in, numbers out; "today"
 * comes in as `now`. Every date is a local calendar date (YYYY-MM-DD), which compares correctly
 * as a string.
 */

export const RANGE_KINDS = [
  'this-week',
  'last-7-days',
  'this-month',
  'last-30-days',
  'this-year',
  'all-time',
  'custom',
] as const;

export type RangeKind = (typeof RANGE_KINDS)[number];

export const RANGE_LABELS: Record<RangeKind, string> = {
  'this-week': 'This week',
  'last-7-days': 'Last 7 days',
  'this-month': 'This month',
  'last-30-days': 'Last 30 days',
  'this-year': 'This year',
  'all-time': 'All time',
  custom: 'Custom',
};

/** Both days included. Build one with `resolveRange`, which only returns valid dates. */
export interface DateRange {
  from: string;
  to: string;
}

function parse(date: string): Date {
  const d = parseLocalDate(date);
  if (!d) throw new RangeError(`Not a date: ${date}`);
  return d;
}

/** The date `days` after (or before) a YYYY-MM-DD date. Calendar days, so DST can't shift it. */
export function addDays(date: string, days: number): string {
  const d = parse(date);
  return todayLocal(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
}

/** The first day of the week containing `date`. */
export function startOfWeek(date: string, weekStartsOn: WeekStart): string {
  return addDays(date, -((parse(date).getDay() - weekStartsOn + 7) % 7));
}

/** Days from `from` to `to`, both included (1 for the same day). */
export function daysBetween(from: string, to: string): number {
  // Date.UTC: whole days, whatever DST does in between.
  const utc = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((utc(parse(to)) - utc(parse(from))) / 86_400_000) + 1;
}

/** A stored date stats can use: a real date, not before MIN_YEAR (old or imported data). */
const usable = (date: string | undefined): date is string =>
  date !== undefined && isValidLocalDate(date) && Number(date.slice(0, 4)) >= MIN_YEAR;

/** The local dates of an application's status entries, skipping unreadable timestamps. */
function entryDates(app: Application, statuses?: readonly Status[]): string[] {
  return (app.statusHistory ?? [])
    .filter((entry) => !statuses || statuses.includes(entry.status))
    .map((entry) => localDateOf(entry.at))
    .filter(usable);
}

/** The earliest date anything happened on a live application: a Date applied or a status entry. */
function earliestDate(apps: readonly Application[]): string | undefined {
  let earliest: string | undefined;
  for (const app of apps) {
    if (app.deletedAt) continue;
    const dates = entryDates(app);
    if (usable(app.appliedAt)) dates.push(app.appliedAt);
    for (const date of dates) if (earliest === undefined || date < earliest) earliest = date;
  }
  return earliest;
}

/**
 * The dates a range covers. This week, month and year are whole calendar periods (the chart
 * shows the days still ahead); Last 7 and Last 30 days end today. All time runs from the first
 * thing logged to today. Custom is the dates given, in order; undefined unless both are valid
 * dates from MIN_YEAR to today.
 */
export function resolveRange(
  kind: RangeKind,
  {
    now,
    weekStartsOn,
    apps = [],
    custom,
  }: {
    now: Date;
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
      // Bounded like every date the user enters, which also keeps the chart a sensible size.
      if (!from || !to || checkPastLocalDate(from, now) || checkPastLocalDate(to, now)) {
        return undefined;
      }
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

/** A usable date (not missing or malformed) within the range, both days included. */
export const inRange = (date: string | undefined, range: DateRange) =>
  usable(date) && date >= range.from && date <= range.to;

/** A Custom date's error: empty, or outside what any entered date allows (1970 to today). */
export function customDateError(value: string | undefined, now: Date): string | undefined {
  if (!value) return 'Enter a date.';
  return checkPastLocalDate(value, now);
}

/**
 * Where a Custom range starts when it's first picked: the last 30 days, so both dates have a
 * sensible value to edit (and nothing shows as an error before anything was typed).
 */
export function customStart(
  current: Partial<DateRange>,
  today: string,
): { from: string; to: string } {
  return { from: current.from || addDays(today, -29), to: current.to || today };
}

/** Statuses that mean the employer answered (spec §4.7 response rate). */
export const RESPONSE_STATUSES: readonly Status[] = [
  'screening',
  'interviewing',
  'offer',
  'accepted',
  'rejected',
];

/**
 * A stage and the later statuses that can only come after it. Interviews and the interview
 * rate both use the interview stage, so a job moved straight to Offer counts in both or
 * neither; likewise Offers and Accepted.
 */
const INTERVIEW_STAGE: readonly Status[] = ['interviewing', 'offer', 'accepted'];
const OFFER_STAGE: readonly Status[] = ['offer', 'accepted'];

/** Whether the application has ever been in any of `statuses` (its history, or now). */
function everIn(app: Application, statuses: readonly Status[]): boolean {
  return (
    statuses.includes(app.status) ||
    (app.statusHistory ?? []).some((entry) => statuses.includes(entry.status))
  );
}

/**
 * Whether the application first reached a stage within the range: the earliest entry into any
 * of its statuses, by date rather than stored order (dates can be backfilled).
 */
function reachedIn(app: Application, stage: readonly Status[], range: DateRange): boolean {
  const dates = entryDates(app, stage);
  if (dates.length === 0) return false;
  return inRange(
    dates.reduce((a, b) => (b < a ? b : a)),
    range,
  );
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
  unit: 'day' | 'week' | 'month' | 'year';
  buckets: ActivityBucket[];
}

export interface Stats {
  range: DateRange;
  /** Applications whose Date applied falls in the range. */
  applied: number;
  /** Applications that first reached the interview stage in the range. */
  interviews: number;
  /** Applications that first reached the offer stage in the range. */
  offers: number;
  /** Of those applied in the range, the ones that got past Applied (ever, not only in range). */
  responseRate: Rate;
  /** Of those applied in the range, the ones that reached the interview stage (ever). */
  interviewRate: Rate;
  /** Where the applications applied in the range stand now, in pipeline order; no zero rows. */
  outcomes: { status: Status; count: number }[];
  activity: Activity;
}

/**
 * The chart's unit (spec §4.7): per day up to 31 days, per week up to a year (53 weeks), then
 * per month up to 5 years, then per year. Each step keeps the bars few enough to see at
 * panel width, however long a Custom or All time range is.
 */
export const MAX_DAILY_DAYS = 31;
export const MAX_WEEKLY_DAYS = 53 * 7;
export const MAX_MONTHLY_MONTHS = 60;

export type ActivityUnit = Activity['unit'];

const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const monthStart = (index: number) =>
  `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}-01`;

function activityUnit(range: DateRange): ActivityUnit {
  const days = daysBetween(range.from, range.to);
  if (days <= MAX_DAILY_DAYS) return 'day';
  if (days <= MAX_WEEKLY_DAYS) return 'week';
  return monthIndex(range.to) - monthIndex(range.from) + 1 <= MAX_MONTHLY_MONTHS ? 'month' : 'year';
}

/** Applications per day, week, month or year across the range, by Date applied. */
export function activity(
  apps: readonly Application[],
  range: DateRange,
  weekStartsOn: WeekStart,
): Activity {
  const unit = activityUnit(range);
  // Bucket starts, unclamped: whole days, weeks, months or years from the one holding `from`.
  const starts: string[] = [];
  if (unit === 'day' || unit === 'week') {
    const step = unit === 'day' ? 1 : 7;
    const first = unit === 'day' ? range.from : startOfWeek(range.from, weekStartsOn);
    for (let start = first; start <= range.to; start = addDays(start, step)) starts.push(start);
  } else {
    const months = unit === 'month' ? 1 : 12;
    let index = unit === 'month' ? monthIndex(range.from) : Number(range.from.slice(0, 4)) * 12;
    for (; monthStart(index) <= range.to; index += months) starts.push(monthStart(index));
  }
  const buckets: ActivityBucket[] = starts.map((start, i) => {
    const last = i + 1 < starts.length ? addDays(starts[i + 1]!, -1) : range.to;
    return {
      from: start < range.from ? range.from : start,
      to: last > range.to ? range.to : last,
      count: 0,
    };
  });
  const indexOf = (date: string): number => {
    switch (unit) {
      case 'day':
        return daysBetween(starts[0]!, date) - 1;
      case 'week':
        return Math.floor((daysBetween(starts[0]!, date) - 1) / 7);
      case 'month':
        return monthIndex(date) - monthIndex(starts[0]!);
      case 'year':
        return Number(date.slice(0, 4)) - Number(starts[0]!.slice(0, 4));
    }
  };
  for (const app of apps) {
    // Buckets are contiguous from the first start, so index directly.
    if (inRange(app.appliedAt, range)) buckets[indexOf(app.appliedAt!)]!.count++;
  }
  return { unit, buckets };
}

/**
 * The Applied rule (spec §4.7), shared by the Applied card and the weekly goal so they always
 * agree: a live application whose Date applied falls in the range. Without a Date applied
 * (Saved, or Skip), a job isn't counted as applied.
 */
function appliedIn(app: Application, range: DateRange): boolean {
  return !app.deletedAt && inRange(app.appliedAt, range);
}

export function computeStats(
  apps: readonly Application[],
  range: DateRange,
  weekStartsOn: WeekStart,
): Stats {
  const live = apps.filter((app) => !app.deletedAt);
  let [applied, responded, interviewed, interviews, offers] = [0, 0, 0, 0, 0];
  const counts = new Map<Status, number>();
  for (const app of live) {
    if (reachedIn(app, INTERVIEW_STAGE, range)) interviews++;
    if (reachedIn(app, OFFER_STAGE, range)) offers++;
    if (!appliedIn(app, range)) continue;
    applied++;
    if (everIn(app, RESPONSE_STATUSES)) responded++;
    if (everIn(app, INTERVIEW_STAGE)) interviewed++;
    counts.set(app.status, (counts.get(app.status) ?? 0) + 1);
  }
  return {
    range,
    applied,
    interviews,
    offers,
    responseRate: rate(responded, applied),
    interviewRate: rate(interviewed, applied),
    outcomes: STATUSES.filter((status) => counts.has(status)).map((status) => ({
      status,
      count: counts.get(status)!,
    })),
    activity: activity(live, range, weekStartsOn),
  };
}

/** This week against the weekly goal (spec §4.7). */
export interface GoalProgress {
  goal: number;
  /** Applications applied this week. Can pass the goal. */
  count: number;
  /** How full the ring is: 0 to 1, full once the goal is reached. */
  fraction: number;
  /** How many more reach the goal; 0 once reached. */
  remaining: number;
  /** The calendar week counted (whole week, whatever range Stats shows). */
  week: DateRange;
}

/**
 * This week's Applied count against the goal (spec §4.7): applications whose Date applied falls
 * in the calendar week containing `now`, whatever range the Stats tab shows. Like Applied, a job
 * without a Date applied (Saved, or Skip) doesn't count, nor does a deleted one.
 */
export function weeklyGoalProgress(
  apps: readonly Application[],
  now: Date,
  weekStartsOn: WeekStart,
  goal: number,
): GoalProgress {
  // The same week as the This week range, by definition.
  const week = resolveRange('this-week', { now, weekStartsOn })!;
  const count = apps.filter((app) => appliedIn(app, week)).length;
  return {
    goal,
    count,
    fraction: Math.min(1, count / goal),
    remaining: Math.max(0, goal - count),
    week,
  };
}
