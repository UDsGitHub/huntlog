import { fakeBrowser } from 'wxt/testing/fake-browser';
import { SETTINGS_KEYS, updateSettings } from './settings';
import {
  applyTheme,
  followThemeSetting,
  mirrorTheme,
  readMirroredTheme,
  resolveTheme,
  THEME_MIRROR_KEY,
} from './theme';

/** A controllable `prefers-color-scheme: dark` query. */
function fakeOs(dark: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const query = {
    get matches() {
      return dark;
    },
    addEventListener: (_: string, listener: (event: { matches: boolean }) => void) =>
      listeners.add(listener),
  };
  vi.spyOn(window, 'matchMedia').mockReturnValue(query as unknown as MediaQueryList);
  return {
    listeners,
    set(next: boolean) {
      dark = next;
      listeners.forEach((listener) => listener({ matches: next }));
    },
  };
}

const root = () => document.documentElement;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  fakeBrowser.reset();
  localStorage.clear();
  delete (window as unknown as Record<string, unknown>).__jobLogThemeListener;
  delete root().dataset.theme;
  delete root().dataset.themeSetting;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('resolveTheme', () => {
  it('follows the OS for System, and the choice otherwise', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('the localStorage mirror', () => {
  it('round-trips a theme', () => {
    mirrorTheme('dark');
    expect(localStorage.getItem(THEME_MIRROR_KEY)).toBe('dark');
    expect(readMirroredTheme()).toBe('dark');
  });

  it('reads System when empty or malformed', () => {
    expect(readMirroredTheme()).toBe('system');
    localStorage.setItem(THEME_MIRROR_KEY, 'neon');
    expect(readMirroredTheme()).toBe('system');
  });

  it("doesn't throw when storage is blocked", () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readMirroredTheme()).toBe('system');
    expect(() => mirrorTheme('dark')).not.toThrow();
  });
});

describe('applyTheme', () => {
  it('sets the resolved theme and the choice on <html>', () => {
    fakeOs(true);
    applyTheme('light');
    expect(root().dataset).toMatchObject({ theme: 'light', themeSetting: 'light' });
    applyTheme('system');
    expect(root().dataset).toMatchObject({ theme: 'dark', themeSetting: 'system' });
  });

  it('follows the OS while the choice is System, and only then', () => {
    const os = fakeOs(false);
    applyTheme('system');
    expect(root().dataset.theme).toBe('light');
    os.set(true);
    expect(root().dataset.theme).toBe('dark');

    applyTheme('light');
    os.set(false);
    os.set(true);
    expect(root().dataset.theme).toBe('light');
  });

  it('listens to the OS once per page, however often it is applied', () => {
    const os = fakeOs(false);
    applyTheme('system');
    applyTheme('dark');
    applyTheme('system');
    expect(os.listeners.size).toBe(1);
  });
});

describe('followThemeSetting', () => {
  it('applies and mirrors the stored theme, then follows changes', async () => {
    fakeOs(false);
    await updateSettings({ theme: 'dark' });
    const stop = followThemeSetting();
    await settle();
    expect(root().dataset.theme).toBe('dark');
    expect(readMirroredTheme()).toBe('dark');

    await updateSettings({ theme: 'light' });
    await settle();
    expect(root().dataset.theme).toBe('light');
    expect(readMirroredTheme()).toBe('light');
    stop();
  });

  it('keeps the mirrored theme when reading the setting fails', async () => {
    fakeOs(false);
    mirrorTheme('dark');
    applyTheme(readMirroredTheme());
    await fakeBrowser.storage.local.set({ [SETTINGS_KEYS.theme]: 'light' });
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValue(new Error('hiccup'));
    const stop = followThemeSetting();
    await settle();
    expect(root().dataset.theme).toBe('dark');
    expect(readMirroredTheme()).toBe('dark');
    stop();
  });
});
