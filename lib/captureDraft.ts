/**
 * The capture draft hands page data from the background script to the side panel through
 * `storage.session` (spec §4.1). Each window has its own side panel, so drafts are keyed by window.
 */

export type CaptureSource = 'page' | 'link' | 'command';

export interface CaptureDraft {
  v: 1;
  source: CaptureSource;
  url?: string;
  title?: string;
  capturedAt: string; // ISO 8601 UTC
  /** The page couldn't be read (restricted page, tab navigated away), so only the tab URL is known. */
  readFailed?: true;
}

export const DRAFT_KEY_PREFIX = 'captureDraft:';
/** A draft older than this was never picked up (e.g. `sidePanel.open` failed) and must not prefill. */
export const DRAFT_MAX_AGE_MS = 5 * 60 * 1000;
export const MAX_URL_LENGTH = 2048;
export const MAX_TITLE_LENGTH = 300;

const SOURCES: readonly CaptureSource[] = ['page', 'link', 'command'];

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
export function sanitizeTitle(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (!collapsed) return undefined;
  // Cut by code point so an emoji at the boundary isn't split into a lone surrogate.
  const codePoints = Array.from(collapsed);
  return codePoints.length > MAX_TITLE_LENGTH
    ? codePoints.slice(0, MAX_TITLE_LENGTH).join('').trimEnd()
    : collapsed;
}

export function createDraft(
  source: CaptureSource,
  fields: { url?: unknown; title?: unknown; readFailed?: boolean },
  now: Date = new Date(),
): CaptureDraft {
  const draft: CaptureDraft = { v: 1, source, capturedAt: now.toISOString() };
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
  if (r.v !== 1) return null;
  if (typeof r.source !== 'string' || !SOURCES.includes(r.source as CaptureSource)) return null;
  if (typeof r.capturedAt !== 'string' || Number.isNaN(Date.parse(r.capturedAt))) return null;
  return {
    ...createDraft(r.source as CaptureSource, {
      url: r.url,
      title: r.title,
      readFailed: r.readFailed === true,
    }),
    capturedAt: r.capturedAt,
  };
}

/** Fresh means captured within the last 5 minutes. A future timestamp (clock skew) counts as fresh. */
export function isFresh(draft: CaptureDraft, now: Date = new Date()): boolean {
  return now.getTime() - Date.parse(draft.capturedAt) < DRAFT_MAX_AGE_MS;
}

/**
 * The application fields under the form's More details that a capture filled. Listed
 * explicitly, never by matching property names: the draft's own `source` records which gesture
 * made it (page, link or command), not the application's Source field.
 *
 * None yet: captures fill only the URL and title. M8's extractor adds location, work mode and
 * salary here, and More details then opens for them so their "Auto-filled" hints are seen.
 */
export function capturedDetailFields(draft: CaptureDraft): string[] {
  void draft;
  return [];
}
