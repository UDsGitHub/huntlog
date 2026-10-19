// A cycle (applicationInput uses sanitizeTitle), safe because these are read only inside
// functions, never while the modules load.
import { MAX_LOCATION_LENGTH, MAX_SALARY, SALARY_PERIODS, WORK_MODES } from './applicationInput';
import { isKnownCurrency } from './locale';
import type { SalaryPeriod, WorkMode } from './types';

/**
 * The capture draft hands page data from the background script to the side panel through
 * `storage.session` (spec §4.1). Each window has its own side panel, so drafts are keyed by window.
 */

/** Which gesture made the capture. Not called `source`: that's an application field. */
export type CaptureGesture = 'page' | 'link' | 'command';

export interface CaptureDraft {
  /** v2 renamed `source` to `gesture`. A v1 draft left over from an update is just dropped. */
  v: 2;
  gesture: CaptureGesture;
  url?: string;
  title?: string;
  /** What the page says about the job (spec §7, M8). Each is left out when it doesn't say. */
  company?: string;
  location?: string;
  workMode?: WorkMode;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryPeriod?: SalaryPeriod;
  capturedAt: string; // ISO 8601 UTC
  /** The page couldn't be read (restricted page, tab navigated away), so only the tab URL is known. */
  readFailed?: true;
}

export const DRAFT_KEY_PREFIX = 'captureDraft:';
/** A draft older than this was never picked up (e.g. `sidePanel.open` failed) and must not prefill. */
export const DRAFT_MAX_AGE_MS = 5 * 60 * 1000;
export const MAX_URL_LENGTH = 2048;
export const MAX_TITLE_LENGTH = 300;
export const MAX_COMPANY_LENGTH = 200;

const GESTURES: readonly CaptureGesture[] = ['page', 'link', 'command'];

export function draftKey(windowId: number): string {
  return `${DRAFT_KEY_PREFIX}${windowId}`;
}

/** Only absolute http(s) URLs survive; page and link data are untrusted. */
export function sanitizeUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  // Cheap pre-check before parsing; the real limit applies to the percent-encoded href below.
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    if (!parsed.hostname || parsed.href.length > MAX_URL_LENGTH) return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
}

/** Collapses whitespace and caps length; a page can set `document.title` to anything. */
export function sanitizeTitle(raw: unknown, max = MAX_TITLE_LENGTH): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (!collapsed) return undefined;
  // Cut by code point so an emoji at the boundary isn't split into a lone surrogate.
  const codePoints = Array.from(collapsed);
  return codePoints.length > max ? codePoints.slice(0, max).join('').trimEnd() : collapsed;
}

/** An amount a page gave: a finite, positive number within the form's limit, to 2 decimals. */
function sanitizeAmount(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return undefined;
  if (raw > MAX_SALARY) return undefined;
  return Math.round(raw * 100) / 100;
}

/** What the page said about the job, as untrusted as the rest of it. */
export interface CapturedDetails {
  company?: unknown;
  location?: unknown;
  workMode?: unknown;
  salary?: unknown;
}

function sanitizeDetails(fields: CapturedDetails): Partial<CaptureDraft> {
  const details: Partial<CaptureDraft> = {};
  const company = sanitizeTitle(fields.company, MAX_COMPANY_LENGTH);
  const location = sanitizeTitle(fields.location, MAX_LOCATION_LENGTH);
  if (company) details.company = company;
  if (location) details.location = location;
  if (typeof fields.workMode === 'string' && (WORK_MODES as string[]).includes(fields.workMode)) {
    details.workMode = fields.workMode as WorkMode;
  }
  const salary =
    fields.salary && typeof fields.salary === 'object'
      ? (fields.salary as Record<string, unknown>)
      : {};
  const min = sanitizeAmount(salary.min);
  const max = sanitizeAmount(salary.max);
  // An inverted range is dropped rather than guessed at.
  if (
    (min !== undefined || max !== undefined) &&
    !(min !== undefined && max !== undefined && min > max)
  ) {
    if (min !== undefined) details.salaryMin = min;
    if (max !== undefined) details.salaryMax = max;
    const currency = typeof salary.currency === 'string' ? salary.currency.toUpperCase() : '';
    if (/^[A-Z]{3}$/.test(currency) && isKnownCurrency(currency)) details.salaryCurrency = currency;
    if (typeof salary.period === 'string' && (SALARY_PERIODS as string[]).includes(salary.period)) {
      details.salaryPeriod = salary.period as SalaryPeriod;
    }
  }
  return details;
}

export function createDraft(
  gesture: CaptureGesture,
  fields: { url?: unknown; title?: unknown; readFailed?: boolean } & CapturedDetails,
  now: Date = new Date(),
): CaptureDraft {
  const draft: CaptureDraft = {
    v: 2,
    gesture,
    capturedAt: now.toISOString(),
    ...sanitizeDetails(fields),
  };
  const url = sanitizeUrl(fields.url);
  const title = sanitizeTitle(fields.title);
  if (url) draft.url = url;
  if (title) draft.title = title;
  if (fields.readFailed) draft.readFailed = true;
  return draft;
}

/** Validates a draft read back from storage. Returns null for anything malformed. */
export function parseDraft(raw: unknown): CaptureDraft | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 2) return null;
  if (typeof r.gesture !== 'string' || !GESTURES.includes(r.gesture as CaptureGesture)) {
    return null;
  }
  if (typeof r.capturedAt !== 'string' || Number.isNaN(Date.parse(r.capturedAt))) return null;
  return {
    ...createDraft(r.gesture as CaptureGesture, {
      url: r.url,
      title: r.title,
      readFailed: r.readFailed === true,
      company: r.company,
      location: r.location,
      workMode: r.workMode,
      salary: {
        min: r.salaryMin,
        max: r.salaryMax,
        currency: r.salaryCurrency,
        period: r.salaryPeriod,
      },
    }),
    capturedAt: r.capturedAt,
  };
}

/** Fresh means captured within the last 5 minutes. A future timestamp (clock skew) counts as fresh. */
export function isFresh(draft: CaptureDraft, now: Date = new Date()): boolean {
  return now.getTime() - Date.parse(draft.capturedAt) < DRAFT_MAX_AGE_MS;
}
