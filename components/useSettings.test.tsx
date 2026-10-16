import { act, render, screen } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, updateSettings } from '@/lib/settings';
import { isFallbackSettings, useSettings } from './useSettings';

beforeEach(() => fakeBrowser.reset());
afterEach(() => vi.restoreAllMocks());

function Theme({ label }: { label: string }) {
  const settings = useSettings();
  return <p>{`${label}: ${settings?.theme ?? 'loading'}`}</p>;
}

describe('useSettings', () => {
  it('reads once for every component, and updates them together', async () => {
    await updateSettings({ theme: 'dark' });
    const get = vi.spyOn(fakeBrowser.storage.local, 'get');
    const { unmount } = render(
      <>
        <Theme label="a" />
        <Theme label="b" />
        <Theme label="c" />
      </>,
    );
    expect(screen.getByText('a: loading')).toBeInTheDocument();
    expect(await screen.findByText('a: dark')).toBeInTheDocument();
    expect(screen.getByText('b: dark')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(1);

    await act(() => updateSettings({ theme: 'light' }));
    expect(await screen.findByText('a: light')).toBeInTheDocument();
    expect(screen.getByText('c: light')).toBeInTheDocument();
    unmount();
  });

  it('reads again for a component that mounts after everyone left', async () => {
    const first = render(<Theme label="a" />);
    expect(await screen.findByText('a: system')).toBeInTheDocument();
    first.unmount();
    // Changed while nobody was listening.
    await updateSettings({ theme: 'dark' });
    render(<Theme label="b" />);
    expect(await screen.findByText('b: dark')).toBeInTheDocument();
  });
});

describe('useSettings after a failed read', () => {
  it('shows the defaults, marked as a fallback', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValue(new Error('hiccup'));
    const seen: ReturnType<typeof useSettings>[] = [];
    function Probe() {
      seen.push(useSettings());
      return null;
    }
    const { unmount } = render(<Probe />);
    await vi.waitFor(() => expect(seen.at(-1)).toEqual(DEFAULT_SETTINGS));
    expect(isFallbackSettings(seen.at(-1)!)).toBe(true);
    unmount();
  });
});
