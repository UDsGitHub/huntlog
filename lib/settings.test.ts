import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  DEFAULT_SETTINGS,
  effectiveWeekStart,
  isWeeklyGoal,
  onSettingsChanged,
  parseSettings,
  readSettings,
  resetSettings,
  SETTINGS_KEY,
  updateSettings,
  type Settings,
} from './settings';

beforeEach(() => {
  fakeBrowser.reset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const stored = async () => (await fakeBrowser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];

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

  it('falls back to the defaults when storage fails', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValue(new Error('broken'));
    expect(await readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('merges a change with what is stored', async () => {
    await updateSettings({ weeklyGoal: 10 });
    await updateSettings({ theme: 'dark' });
    expect(await readSettings()).toEqual({ weeklyGoal: 10, theme: 'dark', schemaVersion: 1 });
    expect(await stored()).toEqual({ weeklyGoal: 10, theme: 'dark', schemaVersion: 1 });
  });

  it('clears a field given as undefined, and keeps one left out', async () => {
    await updateSettings({ weeklyGoal: 10, weekStartsOn: 1 });
    const settings = await updateSettings({ weeklyGoal: undefined });
    expect(settings).toEqual({ weekStartsOn: 1, theme: 'system', schemaVersion: 1 });
    expect(await stored()).not.toHaveProperty('weeklyGoal');
  });

  it("doesn't store an invalid value", async () => {
    await updateSettings({ weeklyGoal: 10 });
    await updateSettings({ weeklyGoal: 0 });
    expect((await readSettings()).weeklyGoal).toBeUndefined();
  });

  it('keeps both of two overlapping changes', async () => {
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

  it('rejects when storage fails, and later writes still work', async () => {
    const set = vi.spyOn(fakeBrowser.storage.local, 'set');
    set.mockRejectedValueOnce(new Error('quota'));
    await expect(updateSettings({ theme: 'dark' })).rejects.toThrow('quota');
    await updateSettings({ weeklyGoal: 4 });
    expect(await readSettings()).toEqual({ weeklyGoal: 4, theme: 'system', schemaVersion: 1 });
  });

  it('resets every setting to its default', async () => {
    await updateSettings({ weeklyGoal: 10, weekStartsOn: 6, theme: 'dark' });
    expect(await resetSettings()).toEqual(DEFAULT_SETTINGS);
    expect(await readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("doesn't touch other keys in storage", async () => {
    await fakeBrowser.storage.local.set({ formDefaults: { source: 'LinkedIn' } });
    await updateSettings({ theme: 'dark' });
    await resetSettings();
    expect((await fakeBrowser.storage.local.get('formDefaults')).formDefaults).toEqual({
      source: 'LinkedIn',
    });
  });
});

describe('onSettingsChanged', () => {
  it('reports each change with the parsed settings, until unsubscribed', async () => {
    const seen: Settings[] = [];
    const unsubscribe = onSettingsChanged((settings) => seen.push(settings));
    await updateSettings({ theme: 'dark' });
    // Another window writing something malformed still reports valid settings.
    await fakeBrowser.storage.local.set({ [SETTINGS_KEY]: { theme: 'neon', weeklyGoal: 7 } });
    unsubscribe();
    await updateSettings({ theme: 'light' });
    expect(seen).toEqual([
      { theme: 'dark', schemaVersion: 1 },
      { theme: 'system', weeklyGoal: 7, schemaVersion: 1 },
    ]);
  });

  it('ignores other keys and other storage areas', async () => {
    const listener = vi.fn();
    const unsubscribe = onSettingsChanged(listener);
    await fakeBrowser.storage.local.set({ formDefaults: {} });
    await fakeBrowser.storage.session.set({ [SETTINGS_KEY]: { theme: 'dark' } });
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });
});
