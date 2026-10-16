import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  DEFAULT_SETTINGS,
  effectiveWeekStart,
  isWeeklyGoal,
  onSettingsChanged,
  parseSettings,
  readSettings,
  resetSettings,
  SETTINGS_KEYS,
  updateSettings,
  type Settings,
} from './settings';

beforeEach(() => {
  fakeBrowser.reset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const everything = () => fakeBrowser.storage.local.get(null);

/** Resolves once every pending change event's re-read has finished. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('parseSettings', () => {
  it('keeps every valid value', () => {
    expect(parseSettings({ weeklyGoal: 10, weekStartsOn: 0, theme: 'dark' })).toEqual({
      weeklyGoal: 10,
      weekStartsOn: 0,
      theme: 'dark',
      schemaVersion: 1,
    });
  });

  it.each([[null], [undefined], ['dark'], [42], [[]], [{}]])(
    'falls back to the defaults for %j',
    (raw) => {
      expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS);
    },
  );

  it.each([[0], [-1], [2.5], [201], [Number.NaN], [Number.POSITIVE_INFINITY], ['10'], [null]])(
    'drops a weekly goal of %j',
    (weeklyGoal) => {
      expect(parseSettings({ weeklyGoal }).weeklyGoal).toBeUndefined();
    },
  );

  it.each([[1], [200]])('keeps the goal bound %i', (weeklyGoal) => {
    expect(parseSettings({ weeklyGoal }).weeklyGoal).toBe(weeklyGoal);
  });

  it.each([[2], [7], ['1'], [-1]])('drops a week start of %j', (weekStartsOn) => {
    expect(parseSettings({ weekStartsOn }).weekStartsOn).toBeUndefined();
  });

  it('drops an unknown theme, and keeps the rest', () => {
    expect(parseSettings({ theme: 'sepia', weeklyGoal: 5 })).toEqual({
      theme: 'system',
      weeklyGoal: 5,
      schemaVersion: 1,
    });
  });

  it('ignores unknown fields and a stored schema version', () => {
    expect(parseSettings({ theme: 'light', extra: true, schemaVersion: 99 })).toEqual({
      theme: 'light',
      schemaVersion: 1,
    });
  });
});

describe('isWeeklyGoal', () => {
  it('accepts whole numbers from 1 to 200 only', () => {
    expect([1, 10, 200].every(isWeeklyGoal)).toBe(true);
    expect([0, 201, 1.5, Number.NaN, '5'].some(isWeeklyGoal)).toBe(false);
  });
});

describe('effectiveWeekStart', () => {
  it("uses the locale's first day when none is set", () => {
    expect(effectiveWeekStart({}, 'en-US')).toBe(0);
    expect(effectiveWeekStart({}, 'de-DE')).toBe(1);
  });

  it('uses the setting over the locale', () => {
    expect(effectiveWeekStart({ weekStartsOn: 6 }, 'en-US')).toBe(6);
    expect(effectiveWeekStart({ weekStartsOn: 0 }, 'de-DE')).toBe(0);
  });
});

describe('reading and writing', () => {
  it('starts at the defaults when nothing is stored', async () => {
    expect(await readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to the defaults when reading fails', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValue(new Error('broken'));
    expect(await readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('stores each setting under its own key', async () => {
    await updateSettings({ weeklyGoal: 10 });
    await updateSettings({ theme: 'dark' });
    expect(await readSettings()).toEqual({ weeklyGoal: 10, theme: 'dark', schemaVersion: 1 });
    expect(await everything()).toEqual({
      [SETTINGS_KEYS.weeklyGoal]: 10,
      [SETTINGS_KEYS.theme]: 'dark',
    });
  });

  it('drops a malformed stored value, keeping the others', async () => {
    await fakeBrowser.storage.local.set({
      [SETTINGS_KEYS.weeklyGoal]: 'ten',
      [SETTINGS_KEYS.theme]: 'light',
    });
    expect(await readSettings()).toEqual({ theme: 'light', schemaVersion: 1 });
  });

  it('clears a field given as undefined, and keeps one left out', async () => {
    await updateSettings({ weeklyGoal: 10, weekStartsOn: 1 });
    await updateSettings({ weeklyGoal: undefined });
    expect(await readSettings()).toEqual({ weekStartsOn: 1, theme: 'system', schemaVersion: 1 });
    expect(await everything()).not.toHaveProperty(SETTINGS_KEYS.weeklyGoal);
  });

  it('throws on an invalid value and stores nothing', async () => {
    await updateSettings({ weeklyGoal: 10 });
    expect(() => updateSettings({ weeklyGoal: 0, theme: 'dark' })).toThrow(TypeError);
    expect(() => updateSettings({ theme: 'neon' as never })).toThrow(TypeError);
    expect(await readSettings()).toEqual({ weeklyGoal: 10, theme: 'system', schemaVersion: 1 });
  });

  it('keeps every one of several overlapping changes', async () => {
    await Promise.all([
      updateSettings({ weeklyGoal: 3 }),
      updateSettings({ theme: 'light' }),
      updateSettings({ weekStartsOn: 6 }),
    ]);
    expect(await readSettings()).toEqual({
      weeklyGoal: 3,
      theme: 'light',
      weekStartsOn: 6,
      schemaVersion: 1,
    });
  });

  it('keeps the last of two changes to the same setting', async () => {
    await Promise.all([updateSettings({ theme: 'light' }), updateSettings({ theme: 'dark' })]);
    expect((await readSettings()).theme).toBe('dark');
  });

  it("never reads before writing, so a failing read can't wipe other settings", async () => {
    await updateSettings({ weeklyGoal: 10, weekStartsOn: 1, theme: 'dark' });
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValue(new Error('hiccup'));
    await updateSettings({ theme: 'light' });
    vi.restoreAllMocks();
    expect(await readSettings()).toEqual({
      weeklyGoal: 10,
      weekStartsOn: 1,
      theme: 'light',
      schemaVersion: 1,
    });
  });

  it('rejects when storage fails, and later writes still work', async () => {
    const set = vi.spyOn(fakeBrowser.storage.local, 'set');
    set.mockRejectedValueOnce(new Error('quota'));
    await expect(updateSettings({ theme: 'dark' })).rejects.toThrow('quota');
    await updateSettings({ weeklyGoal: 4 });
    expect(await readSettings()).toEqual({ weeklyGoal: 4, theme: 'system', schemaVersion: 1 });
  });

  it('resets every setting to its default', async () => {
    await updateSettings({ weeklyGoal: 10, weekStartsOn: 6, theme: 'dark' });
    await resetSettings();
    expect(await readSettings()).toEqual(DEFAULT_SETTINGS);
    expect(await everything()).toEqual({});
  });

  it("doesn't touch other keys in storage", async () => {
    await fakeBrowser.storage.local.set({ formDefaults: { source: 'LinkedIn' } });
    await updateSettings({ theme: 'dark' });
    await resetSettings();
    expect(await everything()).toEqual({ formDefaults: { source: 'LinkedIn' } });
  });
});

describe('onSettingsChanged', () => {
  it('reports the full settings after each change, until unsubscribed', async () => {
    const seen: Settings[] = [];
    const unsubscribe = onSettingsChanged((settings) => seen.push(settings));
    await updateSettings({ weeklyGoal: 7 });
    await settle();
    // Another window writing something malformed still reports valid settings.
    await fakeBrowser.storage.local.set({ [SETTINGS_KEYS.theme]: 'neon' });
    await settle();
    await updateSettings({ theme: 'dark' });
    await settle();
    unsubscribe();
    await updateSettings({ theme: 'light' });
    await settle();
    expect(seen).toEqual([
      { weeklyGoal: 7, theme: 'system', schemaVersion: 1 },
      { weeklyGoal: 7, theme: 'system', schemaVersion: 1 },
      { weeklyGoal: 7, theme: 'dark', schemaVersion: 1 },
    ]);
  });

  it('reports a reset', async () => {
    await updateSettings({ theme: 'dark', weeklyGoal: 3 });
    const listener = vi.fn();
    const unsubscribe = onSettingsChanged(listener);
    await resetSettings();
    await settle();
    unsubscribe();
    expect(listener).toHaveBeenLastCalledWith(DEFAULT_SETTINGS);
  });

  it('reports nothing, rather than defaults, when the re-read fails', async () => {
    await updateSettings({ theme: 'dark' });
    const listener = vi.fn();
    const unsubscribe = onSettingsChanged(listener);
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValue(new Error('hiccup'));
    await updateSettings({ weeklyGoal: 5 });
    await settle();
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });

  it('ignores other keys and other storage areas', async () => {
    const listener = vi.fn();
    const unsubscribe = onSettingsChanged(listener);
    await fakeBrowser.storage.local.set({ formDefaults: {} });
    await fakeBrowser.storage.session.set({ [SETTINGS_KEYS.theme]: 'dark' });
    await settle();
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });
});
