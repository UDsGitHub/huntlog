import { localeWeekStart, type WeekStart } from './locale';

/** `chrome.storage.local` key for the user's settings (spec §4.8, §6). */
export const SETTINGS_KEY = 'settings';
export const SETTINGS_SCHEMA_VERSION = 1;

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const WEEK_STARTS: readonly WeekStart[] = [0, 1, 6];

/** The weekly goal's bounds (spec §4.7): a whole number of applications per week. */
export const MIN_WEEKLY_GOAL = 1;
export const MAX_WEEKLY_GOAL = 200;

/** Spec §5. An absent field means its default: no goal, and the locale's first day of the week. */
export interface Settings {
  weeklyGoal?: number;
  /** Absent: follow the locale, so a later change of browser language is followed too. */
  weekStartsOn?: WeekStart;
  theme: Theme;
  schemaVersion: number;
}

/**
 * A change to the settings. A field present with `undefined` clears it (e.g. turns the goal
 * off); a field left out is kept.
 */
export type SettingsPatch = Partial<Pick<Settings, 'weeklyGoal' | 'weekStartsOn' | 'theme'>>;

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  theme: 'system',
  schemaVersion: SETTINGS_SCHEMA_VERSION,
});

export function isWeeklyGoal(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_WEEKLY_GOAL &&
    value <= MAX_WEEKLY_GOAL
  );
}

function isWeekStart(value: unknown): value is WeekStart {
  return (WEEK_STARTS as readonly unknown[]).includes(value);
}

function isTheme(value: unknown): value is Theme {
  return (THEMES as readonly unknown[]).includes(value);
}

/** Keeps only well-formed values; anything else (old shapes, hand edits) falls back to defaults. */
export function parseSettings(raw: unknown): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return settings;
  const { weeklyGoal, weekStartsOn, theme } = raw as Record<string, unknown>;
  if (isWeeklyGoal(weeklyGoal)) settings.weeklyGoal = weeklyGoal;
  if (isWeekStart(weekStartsOn)) settings.weekStartsOn = weekStartsOn;
  if (isTheme(theme)) settings.theme = theme;
  return settings;
}

/** The first day of the week to use: the user's choice, else the locale's (spec §4.7). */
export function effectiveWeekStart(
  settings: Pick<Settings, 'weekStartsOn'>,
  locale?: string,
): WeekStart {
  return settings.weekStartsOn ?? localeWeekStart(locale);
}

/** Never throws: without storage, everything is at its default. */
export async function readSettings(): Promise<Settings> {
  try {
    const stored = await browser.storage.local.get(SETTINGS_KEY);
    return parseSettings(stored[SETTINGS_KEY]);
  } catch (error) {
    console.error('Reading settings failed', error);
    return { ...DEFAULT_SETTINGS };
  }
}

let writes: Promise<unknown> = Promise.resolve();

/** Runs read-modify-write steps one at a time, so overlapping changes can't undo each other. */
function enqueue(next: (current: Settings) => Settings): Promise<Settings> {
  const write = writes.then(async () => {
    const settings = parseSettings(next(await readSettings()));
    await browser.storage.local.set({ [SETTINGS_KEY]: settings });
    return settings;
  });
  // A failed write mustn't block the ones after it.
  writes = write.catch(() => undefined);
  return write;
}

/**
 * Applies a change and returns the saved settings. Invalid values are dropped rather than
 * stored (callers validate input first). Rejects if storage fails, so the UI can say so.
 */
export function updateSettings(patch: SettingsPatch): Promise<Settings> {
  return enqueue((current) => {
    const next: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
    return next as unknown as Settings;
  });
}

/** Puts every setting back to its default (spec §4.8 Reset settings). Rejects if storage fails. */
export function resetSettings(): Promise<Settings> {
  return enqueue(() => ({ ...DEFAULT_SETTINGS }));
}

/**
 * Calls `listener` with the new settings whenever they change, in this window or another one
 * (spec §4.8: changes apply in every open window). Returns the unsubscribe function.
 */
export function onSettingsChanged(listener: (settings: Settings) => void): () => void {
  const handle = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && SETTINGS_KEY in changes) {
      listener(parseSettings(changes[SETTINGS_KEY]!.newValue));
    }
  };
  browser.storage.onChanged.addListener(handle);
  return () => browser.storage.onChanged.removeListener(handle);
}
