/** Today's local calendar date as YYYY-MM-DD. Not derived from UTC, which can be a day off. */
export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** True for a real calendar date written as YYYY-MM-DD (rejects 2026-02-30). */
export function isValidLocalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
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
