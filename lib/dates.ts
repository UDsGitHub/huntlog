/** Today's local calendar date as YYYY-MM-DD. Not derived from UTC, which can be a day off. */
export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

/**
 * One medium-style date formatter per locale, reused (a list formats a date on every row). It
 * formats in UTC, and callers pass the calendar date as UTC midnight: the cached formatter then
 * never depends on the time zone in force when it was made (the user may travel).
 */
function dateFormatter(locale?: string): Intl.DateTimeFormat {
  const key = locale ?? '';
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
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

/** An ISO timestamp's local calendar date, formatted like formatLocalDate. */
export function formatTimestampDate(iso: string, locale?: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateFormatter(locale).format(asUtcDay(date));
}
