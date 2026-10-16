import { sanitizeTitle } from './captureDraft';
import { todayLocal } from './dates';
import { defaultCurrency, knownCurrencies } from './locale';
import type { SalaryPeriod, WorkMode } from './types';

export const WORK_MODES: readonly WorkMode[] = ['remote', 'hybrid', 'onsite'];
export const SALARY_PERIODS: readonly SalaryPeriod[] = ['year', 'month', 'hour'];
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
  /** YYYY-MM-DD local date. Defaults to today when omitted; an empty string is an error. */
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
  appliedAt: string;
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

/** Accepts `120000`, `120,000`, `120 000` and decimals. Returns NaN for anything else. */
export function parseSalary(raw: string | number | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  const compact = raw.replace(/[\s,\u00a0\u202f]/g, '');
  if (!compact) return undefined;
  return /^\d+(\.\d+)?$/.test(compact) ? Number(compact) : NaN;
}

function isValidLocalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function optionalText(
  raw: string | undefined,
  max: number,
  label: string,
): { value?: string; error?: string } {
  const value = raw?.trim();
  if (!value) return {};
  if (value.length > max)
    return { error: `${label} must be ${max.toLocaleString()} characters or fewer.` };
  return { value };
}

export function validateApplication(
  input: ApplicationInput,
  now: Date = new Date(),
  locale?: string,
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

  const min = parseSalary(input.salaryMin);
  const max = parseSalary(input.salaryMax);
  for (const [field, value] of [
    ['salaryMin', min],
    ['salaryMax', max],
  ] as const) {
    if (value === undefined) continue;
    if (Number.isNaN(value) || value < 0) errors[field] = 'Enter a number, like 85,000.';
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
    if (!/^[A-Z]{3}$/.test(currency) || !knownCurrencies().includes(currency)) {
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

  const appliedAt = input.appliedAt === undefined ? todayLocal(now) : input.appliedAt.trim();
  if (!appliedAt) errors.appliedAt = 'Enter the date you applied.';
  else if (!isValidLocalDate(appliedAt)) errors.appliedAt = 'Enter a valid date.';
  // YYYY-MM-DD strings compare in date order.
  else if (appliedAt > todayLocal(now))
    errors.appliedAt = "The date applied can't be in the future.";
  else out.appliedAt = appliedAt;

  if (Object.keys(errors).length > 0) return { values: null, errors };
  return { values: out as ApplicationValues, errors };
}
