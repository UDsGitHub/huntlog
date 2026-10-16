import { fakeBrowser } from 'wxt/testing/fake-browser';
import background from '../entrypoints/background';

describe('background', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fakeBrowser.reset();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (fakeBrowser as { sidePanel?: unknown }).sidePanel;
  });

  it('makes the toolbar icon open the side panel', () => {
    const setPanelBehavior = vi.fn().mockResolvedValue(undefined);
    Object.assign(fakeBrowser, { sidePanel: { setPanelBehavior } });

    background.main();

    expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
  });

  it('logs instead of throwing when setPanelBehavior rejects', async () => {
    const error = new Error('boom');
    Object.assign(fakeBrowser, {
      sidePanel: { setPanelBehavior: vi.fn().mockRejectedValue(error) },
    });

    expect(() => background.main()).not.toThrow();
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith('setPanelBehavior failed', error),
    );
  });

  it('logs instead of throwing when the sidePanel API is missing', async () => {
    expect(() => background.main()).not.toThrow();
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith('setPanelBehavior failed', expect.any(TypeError)),
    );
  });
});
