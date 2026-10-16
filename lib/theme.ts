import { onSettingsChanged, readStoredSettings, THEMES, type Theme } from './settings';

/**
 * Applying the theme (spec §4.8, §9). Every extension page sets `data-theme` on <html> to the
 * resolved theme, 'light' or 'dark', which `assets/theme.css` keys its tokens on.
 *
 * Settings load asynchronously, so the theme is also mirrored to `localStorage` (same origin for
 * every extension page): `entrypoints/theme-init.ts` reads it synchronously in <head>, before the
 * first paint, so a stored Dark never flashes light. `chrome.storage.local` stays the source of
 * truth; the mirror only avoids the flash.
 */
export type ResolvedTheme = 'light' | 'dark';

/** `localStorage` key of the mirror. */
export const THEME_MIRROR_KEY = 'theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  return theme;
}

/** The mirrored theme, or System when there's none or storage is blocked. Never throws. */
export function readMirroredTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_MIRROR_KEY);
    return (THEMES as readonly (string | null)[]).includes(value) ? (value as Theme) : 'system';
  } catch {
    return 'system';
  }
}

/** Never throws: without `localStorage`, the page just may flash on its next load. */
export function mirrorTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_MIRROR_KEY, theme);
  } catch {
    // Blocked storage: nothing to do.
  }
}

function prefersDark(win: Window): boolean {
  try {
    return win.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

/** Set on the window once its System listener is in place (one per page, whichever bundle). */
const LISTENING = '__jobLogThemeListener';

/**
 * Shows `theme` on the page: `data-theme` gets the resolved theme, and `data-theme-setting` the
 * choice. While the choice is System, the page follows the OS as it changes. The OS listener is
 * added once per page and reads the current choice from the element when it fires, so the head
 * script and the app (separate bundles) never fight over it.
 */
export function applyTheme(theme: Theme, doc: Document = document): void {
  const win = doc.defaultView;
  const root = doc.documentElement;
  root.dataset.themeSetting = theme;
  root.dataset.theme = resolveTheme(theme, win ? prefersDark(win) : false);
  if (!win || (win as unknown as Record<string, unknown>)[LISTENING]) return;
  try {
    win.matchMedia(DARK_QUERY).addEventListener('change', (event) => {
      if (root.dataset.themeSetting === 'system') {
        root.dataset.theme = event.matches ? 'dark' : 'light';
      }
    });
    (win as unknown as Record<string, unknown>)[LISTENING] = true;
  } catch {
    // No matchMedia: System stays light.
  }
}

/**
 * Keeps a page in step with the stored theme: applies and mirrors it now, and again whenever it
 * changes in any window. For pages without React; the side panel uses `useTheme`.
 */
export function followThemeSetting(doc: Document = document): () => void {
  const show = (theme: Theme) => {
    mirrorTheme(theme);
    applyTheme(theme, doc);
  };
  let changed = false;
  const stop = onSettingsChanged((settings) => {
    changed = true;
    show(settings.theme);
  });
  // A failed read keeps what the mirror showed, rather than overwriting it with the default.
  readStoredSettings().then(
    (settings) => !changed && show(settings.theme),
    (error: unknown) => console.error('Reading settings failed', error),
  );
  return stop;
}
