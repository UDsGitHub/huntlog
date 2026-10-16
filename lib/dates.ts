/** Today's local calendar date as YYYY-MM-DD. Not derived from UTC, which can be a day off. */
export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Milliseconds from `now` to the next local midnight (a DST day is 23 or 25 hours long). */
export function msUntilNextDay(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

/**
 * A YYYY-MM-DD string as a local Date (midnight), or undefined unless it's a real calendar date
 * (rejects 2026-02-30). Never `new Date('YYYY-MM-DD')`: that parses as UTC.
 */
export function parseLocalDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(y, m - 1, d);
  const real = date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
  return real ? date : undefined;
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isValidLocalDate(value: string): boolean {
  return parseLocalDate(value) !== undefined;
}

/** No job-search date is older than this; also catches half-typed years like 0202. */
export const MIN_YEAR = 1970;

/**
 * Error message for a past-or-today local date, or undefined when it's fine. Shared by Date
 * applied and status history dates, so the rules can't drift apart.
 */
export function checkPastLocalDate(
  value: string,
  now: Date = new Date(),
  futureMessage = "This date can't be in the future.",
): string | undefined {
  if (!isValidLocalDate(value) || Number(value.slice(0, 4)) < MIN_YEAR)
    return 'Enter a valid date.';
  // YYYY-MM-DD strings compare in date order.
  if (value > todayLocal(now)) return futureMessage;
  return undefined;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Date styles shown in the app: "Oct 1, 2026", and "Oct 1" or "Oct 2026" for chart axes. */
type DateStyle = 'medium' | 'day-month' | 'month-year';
const STYLE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  medium: { dateStyle: 'medium' },
  'day-month': { month: 'short', day: 'numeric' },
  'month-year': { month: 'short', year: 'numeric' },
};

/**
 * One date formatter per locale and style, reused (a list formats a date on every row). It
 * formats in UTC, and callers pass the calendar date as UTC midnight: the cached formatter then
 * never depends on the time zone in force when it was made (the user may travel).
 */
function dateFormatter(locale?: string, style: DateStyle = 'medium'): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${style}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...STYLE_OPTIONS[style], timeZone: 'UTC' });
    formatters.set(key, formatter);
  }
  return formatter;
}

const asUtcDay = (date: Date) =>
  new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));

/**
 * A stored local date (YYYY-MM-DD) for display in the user's locale, e.g. "Oct 1, 2026" in
 * en-US or "1 Oct 2026" in en-GB. It never shifts a day. Anything that isn't a valid date (old
 * or imported data) is shown as stored.
 */
export function formatLocalDate(value: string, locale?: string): string {
  const date = parseLocalDate(value);
  return date ? dateFormatter(locale).format(asUtcDay(date)) : value;
}

/**
 * A stored local date in a shorter style, for chart labels: "Oct 1" (`day-month`) or "Oct 2026"
 * (`month-year`). Like formatLocalDate, it never shifts a day and shows invalid values as stored.
 */
export function formatShortLocalDate(
  value: string,
  style: Exclude<DateStyle, 'medium'>,
  locale?: string,
): string {
  const date = parseLocalDate(value);
  return date ? dateFormatter(locale, style).format(asUtcDay(date)) : value;
}

/** An ISO timestamp's local calendar date, formatted like formatLocalDate. */
export function formatTimestampDate(iso: string, locale?: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateFormatter(locale).format(asUtcDay(date));
}
