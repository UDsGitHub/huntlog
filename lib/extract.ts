export interface ExtractedPage {
  url: string;
  title?: string;
}

/**
 * Injected into the tab with `scripting.executeScript({ func })`, which serializes this function.
 * It must stay fully self-contained (no imports, no outer-scope references) and must never throw.
 *
 * M1 stub: only the tab URL and document title. M8 replaces it with the full extractor (spec §7).
 */
export function extractPage(): ExtractedPage | null {
  try {
    let title: string | undefined;
    try {
      const raw = document.title;
      title = typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
    } catch {
      title = undefined;
    }
    return { url: String(location.href), title };
  } catch {
    return null;
  }
}
