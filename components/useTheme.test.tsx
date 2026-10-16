import { act, render } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { updateSettings } from '@/lib/settings';
import { applyTheme, mirrorTheme, readMirroredTheme } from '@/lib/theme';
import { useTheme } from './useTheme';

function Themed() {
  useTheme();
  return null;
}

const theme = () => document.documentElement.dataset.theme;

beforeEach(() => {
  fakeBrowser.reset();
  localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('useTheme', () => {
  it('shows and mirrors the stored theme, and follows changes', async () => {
    await updateSettings({ theme: 'dark' });
    const { unmount } = render(<Themed />);
    await vi.waitFor(() => expect(theme()).toBe('dark'));
    expect(readMirroredTheme()).toBe('dark');
    await act(() => updateSettings({ theme: 'light' }));
    await vi.waitFor(() => expect(theme()).toBe('light'));
    expect(readMirroredTheme()).toBe('light');
    unmount();
  });

  it('keeps the mirrored theme when reading settings fails', async () => {
    mirrorTheme('dark');
    applyTheme('dark');
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValue(new Error('hiccup'));
    const { unmount } = render(<Themed />);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(console.error).toHaveBeenCalled();
    expect(theme()).toBe('dark');
    expect(readMirroredTheme()).toBe('dark');
    unmount();
  });
});
