/**
 * Query parameters that only track how the user arrived, compared case-insensitively.
 * `utm_*` is matched by prefix. Everything else is kept: an unknown parameter may identify the job
 * (`currentJobId`, `jk`, `gh_jid`, …).
 */
const TRACKING_PARAMS = new Set(['ref', 'refid', 'trk', 'trackingid', 'gh_src']);

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('utm_') || TRACKING_PARAMS.has(lower);
}

/**
 * Normalizes a job posting URL for duplicate detection (spec §4.5). Pure and idempotent; never
 * throws. Input that isn't an http(s) URL comes back trimmed, so it can never match a valid one.
 *
 * Changing these rules changes stored `urlNormalized` values: add a Dexie migration that
 * re-normalizes existing rows, or old and new values stop matching.
 */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return trimmed;

  // The same posting is often reachable over both schemes. Switching to https also drops a port
  // that is now the default (http://host:443 → https://host). The URL parser lowercases the host.
  url.protocol = 'https:';
  url.hash = '';

  const kept = [...url.searchParams]
    .filter(([name]) => !isTrackingParam(name))
    .sort(([a, av], [b, bv]) => (a === b ? compare(av, bv) : compare(a, b)));
  url.search = new URLSearchParams(kept).toString();

  let path = url.pathname;
  while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  url.pathname = path;

  return url.href;
}

/** Code-unit order, so the result doesn't depend on the runtime's locale. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
