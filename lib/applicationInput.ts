import { sanitizeTitle } from './captureDraft';
import { checkPastLocalDate, todayLocal } from './dates';
import { defaultCurrency, isKnownCurrency, numberSeparators } from './locale';
import { appliedAtOptional, isStatus } from './status';
import type { SalaryPeriod, Status, WorkMode } from './types';

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
};
export const SALARY_PERIOD_LABELS: Record<SalaryPeriod, string> = {
  year: 'Year',
  month: 'Month',
  hour: 'Hour',
};
export const WORK_MODES = Object.keys(WORK_MODE_LABELS) as WorkMode[];
export const SALARY_PERIODS = Object.keys(SALARY_PERIOD_LABELS) as SalaryPeriod[];
export const SOURCE_SUGGESTIONS = [
  'LinkedIn',
  'Indeed',
  'Company site',
  'Referral',
  'Recruiter',
  'Other',
] as const;

export const MAX_LOCATION_LENGTH = 200;
export const MAX_SOURCE_LENGTH = 100;
export const MAX_NOTES_LENGTH = 10_000;
export const MAX_SALARY = 1_000_000_000;

/** Raw user input, as a form or capture provides it. Everything but url and company is optional. */
export interface ApplicationInput {
  url: string;
  company: string;
  title?: string;
  location?: string;
  workMode?: string;
  salaryMin?: string | number;
  salaryMax?: string | number;
  salaryCurrency?: string;
  salaryPeriod?: string;
  source?: string;
  notes?: string;
  /** One of the 9 statuses. Omitted: Applied for a new application, unchanged for an edit. */
  status?: string;
  /**
   * The resume sent (spec §4.6), checked against storage on save. Empty: none. Omitted: none for
   * a new application, unchanged for an edit.
   */
  resumeId?: string;
  /**
   * YYYY-MM-DD local date. Omitted: today, unless the status doesn't need one. An empty string
   * means none, which is an error unless the status is Saved or Withdrawn.
   */
  appliedAt?: string;
}

/** Validated, normalized fields ready to store. Optional fields are absent, never undefined. */
export interface ApplicationValues {
  url: string;
  company: string;
  title?: string;
  location?: string;
  workMode?: WorkMode;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryPeriod?: SalaryPeriod;
  source?: string;
  notes?: string;
  status?: Status;
  resumeId?: string;
  appliedAt?: string;
}

export type InputField = Exclude<keyof ApplicationInput, 'title'>;
export type FieldErrors = Partial<Record<InputField, string>>;

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

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Parses a salary typed in the user's locale: `85,000` (en), `85.000` (de), `85 000` (fr) and
 * plain `85000`, with up to 2 decimals. A separator followed by exactly 3 digits is grouping,
 * never decimals, so `85.000` can't silently become 85 in any locale: where the input is
 * ambiguous it's rejected (NaN) instead. Returns undefined for blank input.
 */
export function parseSalary(raw: string | number | undefined, locale?: string): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : NaN;
  const text = raw.replace(/[\s\u00a0\u202f]+/g, ' ').trim();
  if (!text) return undefined;
  const { group, decimal, indianGrouping } = numberSeparators(locale);
  // Spaces always group digits; so does the locale's own separator (a no-break space in fr).
  const groupClass = `[ ${escapeRegExp(group.replace(/[\u00a0\u202f]/g, ' '))}]`;
  const groupedWhole = indianGrouping
    ? `\\d{1,2}(?:${groupClass}\\d{2})*${groupClass}\\d{3}`
    : `\\d{1,3}(?:${groupClass}\\d{3})+`;
  const pattern = new RegExp(`^(${groupedWhole}|\\d+)(?:${escapeRegExp(decimal)}(\\d{1,2}))?$`);
  const match = pattern.exec(text);
  if (!match) return NaN;
  const whole = match[1]!.replace(/\D/g, '');
  return Number(match[2] ? `${whole}.${match[2]}` : whole);
}

function optionalText(
  raw: string | undefined,
  max: number,
  label: string,
): { value?: string; error?: string } {
  const value = raw?.trim();
  if (!value) return {};
  // Count characters (code points), not UTF-16 units, so an emoji counts as one.
  if (Array.from(value).length > max)
    return { error: `${label} must be ${max.toLocaleString()} characters or fewer.` };
  return { value };
}

export interface ValidateOptions {
  /**
   * The stored application when editing. Its status is used when the input has none (new
   * applications: Applied). And a job that has no Date applied (the user chose Skip when asked)
   * isn't made to get one by an unrelated edit.
   */
  current?: { status: Status; appliedAt?: string };
}

/** Error message for a Date applied, or undefined if it's a real local date not in the future. */
export function checkAppliedAt(value: string, now: Date = new Date()): string | undefined {
  return checkPastLocalDate(value, now, "The date applied can't be in the future.");
}

export function validateApplication(
  input: ApplicationInput,
  now: Date = new Date(),
  locale?: string,
  { current }: ValidateOptions = {},
): { values: ApplicationValues | null; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const out: Partial<ApplicationValues> = {};

  const url = normalizeInputUrl(input.url);
  if (!input.url.trim()) errors.url = 'Enter the job posting URL.';
  else if (!url) errors.url = 'Enter a valid web address (http or https).';
  else out.url = url;

  const company = input.company.trim();
  if (!company) errors.company = 'Enter the company name.';
  else out.company = company;

  // Same normalization as a captured title, so typed and captured titles compare alike.
  const title = sanitizeTitle(input.title);
  if (title) out.title = title;

  const location = optionalText(input.location, MAX_LOCATION_LENGTH, 'Location');
  if (location.error) errors.location = location.error;
  else if (location.value) out.location = location.value;

  const source = optionalText(input.source, MAX_SOURCE_LENGTH, 'Source');
  if (source.error) errors.source = source.error;
  else if (source.value) out.source = source.value;

  // Notes keep their inner line breaks; only the ends are trimmed.
  const notes = optionalText(input.notes, MAX_NOTES_LENGTH, 'Notes');
  if (notes.error) errors.notes = notes.error;
  else if (notes.value) out.notes = notes.value;

  if (input.workMode) {
    if ((WORK_MODES as readonly string[]).includes(input.workMode)) {
      out.workMode = input.workMode as WorkMode;
    } else {
      errors.workMode = 'Choose remote, hybrid or on-site.';
    }
  }

  const min = parseSalary(input.salaryMin, locale);
  const max = parseSalary(input.salaryMax, locale);
  const example = new Intl.NumberFormat(locale).format(85000);
  for (const [field, value] of [
    ['salaryMin', min],
    ['salaryMax', max],
  ] as const) {
    if (value === undefined) continue;
    if (Number.isNaN(value)) errors[field] = `Enter a number, like ${example}.`;
    else if (value > MAX_SALARY) errors[field] = 'That number is too large.';
  }
  if (
    !errors.salaryMin &&
    !errors.salaryMax &&
    min !== undefined &&
    max !== undefined &&
    min > max
  ) {
    errors.salaryMax = 'Maximum must be at least the minimum.';
  }
  const hasSalary = min !== undefined || max !== undefined;
  if (hasSalary) {
    const currency = (input.salaryCurrency?.trim() || defaultCurrency(locale)).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency) || !isKnownCurrency(currency)) {
      errors.salaryCurrency = 'Choose a currency code, like USD or EUR.';
    }
    const period = input.salaryPeriod || 'year';
    if (!(SALARY_PERIODS as readonly string[]).includes(period)) {
      errors.salaryPeriod = 'Choose per year, month or hour.';
    }
    if (!errors.salaryMin && !errors.salaryMax && !errors.salaryCurrency && !errors.salaryPeriod) {
      if (min !== undefined) out.salaryMin = min;
      if (max !== undefined) out.salaryMax = max;
      out.salaryCurrency = currency;
      out.salaryPeriod = period as SalaryPeriod;
    }
  }

  const resumeId = input.resumeId?.trim();
  if (resumeId) out.resumeId = resumeId;

  let status: Status = current?.status ?? 'applied';
  if (input.status !== undefined && input.status !== '') {
    if (isStatus(input.status)) status = out.status = input.status;
    else errors.status = 'Choose a status.';
  }

  // Date applied is required once an application was sent (spec §5): not for Saved or Withdrawn,
  // and not in an edit of a job stored without one.
  const optional = appliedAtOptional(status) || (current !== undefined && !current.appliedAt);
  const appliedAt =
    input.appliedAt === undefined ? (optional ? '' : todayLocal(now)) : input.appliedAt.trim();
  if (!appliedAt) {
    if (!optional) errors.appliedAt = 'Enter the date you applied.';
  } else {
    const error = checkAppliedAt(appliedAt, now);
    if (error) errors.appliedAt = error;
    else out.appliedAt = appliedAt;
  }

  if (Object.keys(errors).length > 0) return { values: null, errors };
  return { values: out as ApplicationValues, errors };
}
