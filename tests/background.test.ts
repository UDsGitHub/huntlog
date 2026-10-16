import { fakeBrowser } from 'wxt/testing/fake-browser';
import background from '../entrypoints/background';

describe('background', () => {
  beforeEach(() => {
    fakeBrowser.reset();
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
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => background.main()).not.toThrow();
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith('setPanelBehavior failed', error),
    );
    consoleError.mockRestore();
  });
});
