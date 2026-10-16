import { localeWeekStart, type WeekStart } from './locale';

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

type Field = 'weeklyGoal' | 'weekStartsOn' | 'theme';
const FIELDS: readonly Field[] = ['weeklyGoal', 'weekStartsOn', 'theme'];

/**
 * Each setting has its own `chrome.storage.local` key (spec §4.8, §6). A change writes only its
 * own keys and never reads first, so two windows changing different settings at once can't undo
 * each other, and a failed read can't turn into a write of defaults.
 */
export const SETTINGS_KEYS: Readonly<Record<Field, string>> = {
  weeklyGoal: 'settings.weeklyGoal',
  weekStartsOn: 'settings.weekStartsOn',
  theme: 'settings.theme',
};
const ALL_KEYS = FIELDS.map((field) => SETTINGS_KEYS[field]);

/**
 * A change to the settings. A field present with `undefined` clears it back to its default (e.g.
 * turns the goal off); a field left out is kept.
 */
export type SettingsPatch = Partial<Pick<Settings, Field>>;

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
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

const VALID: Record<Field, (value: unknown) => boolean> = {
  weeklyGoal: isWeeklyGoal,
  weekStartsOn: isWeekStart,
  theme: isTheme,
};

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

async function readStored(): Promise<Settings> {
  const stored = await browser.storage.local.get(ALL_KEYS);
  return parseSettings(
    Object.fromEntries(FIELDS.map((field) => [field, stored[SETTINGS_KEYS[field]]])),
  );
}

/** Never throws: without storage, everything is at its default. */
export async function readSettings(): Promise<Settings> {
  try {
    return await readStored();
  } catch (error) {
    console.error('Reading settings failed', error);
    return { ...DEFAULT_SETTINGS };
  }
}

let writes: Promise<unknown> = Promise.resolve();

/** Runs this window's writes in order, so the last change made is the one that's kept. */
function enqueue(write: () => Promise<void>): Promise<void> {
  const next = writes.then(write);
  // A failed write mustn't block the ones after it.
  writes = next.catch(() => undefined);
  return next;
}

/**
 * Applies a change. Rejects if storage fails, so the UI can say so, and throws on an invalid
 * value: callers validate input first (e.g. with `isWeeklyGoal`).
 */
export function updateSettings(patch: SettingsPatch): Promise<void> {
  const set: Record<string, unknown> = {};
  const remove: string[] = [];
  for (const [field, value] of Object.entries(patch) as [Field, unknown][]) {
    if (!FIELDS.includes(field)) continue;
    if (value === undefined) remove.push(SETTINGS_KEYS[field]);
    else if (VALID[field](value)) set[SETTINGS_KEYS[field]] = value;
    else throw new TypeError(`Invalid ${field}: ${String(value)}`);
  }
  return enqueue(async () => {
    if (Object.keys(set).length) await browser.storage.local.set(set);
    if (remove.length) await browser.storage.local.remove(remove);
  });
}

/** Puts every setting back to its default (spec §4.8 Reset settings). Rejects if storage fails. */
export function resetSettings(): Promise<void> {
  return enqueue(() => browser.storage.local.remove(ALL_KEYS));
}

/**
 * Calls `listener` with the full, current settings whenever any of them changes, in this window
 * or another one (spec §4.8: changes apply in every open window). Each change re-reads them all,
 * and only the latest read is reported, so a slow read can't report older settings last. A read
 * that fails reports nothing.
 * Returns the unsubscribe function.
 */
export function onSettingsChanged(listener: (settings: Settings) => void): () => void {
  let latest = 0;
  let active = true;
  const handle = (changes: Record<string, unknown>, area: string) => {
    if (area !== 'local' || !ALL_KEYS.some((key) => key in changes)) return;
    const read = ++latest;
    // A failed read reports nothing, rather than defaults that were never chosen.
    readStored().then(
      (settings) => {
        if (active && read === latest) listener(settings);
      },
      (error: unknown) => console.error('Reading settings failed', error),
    );
  };
  browser.storage.onChanged.addListener(handle);
  return () => {
    active = false;
    browser.storage.onChanged.removeListener(handle);
  };
}
