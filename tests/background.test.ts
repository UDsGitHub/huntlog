import type { Browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import background, {
  ADD_JOB_COMMAND,
  handleCapture,
  LINK_MENU_ID,
  MENU_TITLE,
  PAGE_MENU_ID,
} from '../entrypoints/background';
import { draftKey } from '@/lib/captureDraft';
import { extractPage } from '@/lib/extract';

type Listener = (...args: never[]) => unknown;

function fakeEvent<L extends Listener>() {
  const listeners: L[] = [];
  return {
    listeners,
    addListener: vi.fn((l: L) => void listeners.push(l)),
    fire: (...args: Parameters<L>) => listeners.forEach((l) => l(...args)),
  };
}

const tab = (overrides: Partial<Browser.tabs.Tab> = {}) =>
  ({
    id: 7,
    windowId: 3,
    url: 'https://jobs.example.test/posting/1',
    ...overrides,
  }) as Browser.tabs.Tab;

const mocked = ['sidePanel', 'contextMenus', 'commands', 'scripting'] as const;
const originals = Object.fromEntries(mocked.map((k) => [k, fakeBrowser[k]]));

let api: ReturnType<typeof installMocks>;

function installMocks() {
  const sidePanel = {
    setPanelBehavior: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue(undefined),
  };
  const contextMenus = {
    create: vi.fn(),
    removeAll: vi.fn().mockResolvedValue(undefined),
    onClicked:
      fakeEvent<
        (info: Partial<Browser.contextMenus.OnClickData>, tab?: Browser.tabs.Tab) => void
      >(),
  };
  const commands = {
    onCommand: fakeEvent<(command: string, tab?: Browser.tabs.Tab) => void>(),
  };
  const scripting = {
    executeScript: vi.fn().mockResolvedValue([
      {
        frameId: 0,
        result: { url: 'https://jobs.example.test/posting/1', title: 'Engineer at Acme' },
      },
    ]),
  };
  Object.assign(fakeBrowser, { sidePanel, contextMenus, commands, scripting });
  return { sidePanel, contextMenus, commands, scripting };
}

async function storedDraft(windowId = 3) {
  return (await fakeBrowser.storage.session.get(draftKey(windowId)))[draftKey(windowId)];
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fakeBrowser.reset();
  api = installMocks();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(fakeBrowser, originals);
});

describe('background startup', () => {
  it('makes the toolbar icon open the side panel', () => {
    background.main();
    expect(api.sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
  });

  it('logs instead of throwing when setPanelBehavior rejects', async () => {
    const error = new Error('boom');
    api.sidePanel.setPanelBehavior.mockRejectedValue(error);
    expect(() => background.main()).not.toThrow();
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith('setPanelBehavior failed', error),
    );
  });

  it('logs instead of throwing when the sidePanel API is missing', async () => {
    Object.assign(fakeBrowser, { sidePanel: undefined });
    expect(() => background.main()).not.toThrow();
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith('setPanelBehavior failed', expect.any(TypeError)),
    );
  });

  it('registers click and command listeners synchronously, so they survive a worker restart', () => {
    background.main();
    expect(api.contextMenus.onClicked.listeners).toHaveLength(1);
    expect(api.commands.onCommand.listeners).toHaveLength(1);
  });

  it('creates the page and link menus on install, clearing old ones first', async () => {
    background.main();
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update' } as never);
    await vi.waitFor(() => expect(api.contextMenus.create).toHaveBeenCalledTimes(2));

    expect(api.contextMenus.removeAll.mock.invocationCallOrder[0]).toBeLessThan(
      api.contextMenus.create.mock.invocationCallOrder[0]!,
    );
    expect(api.contextMenus.create).toHaveBeenCalledWith(
      { id: PAGE_MENU_ID, title: MENU_TITLE, contexts: ['page', 'frame', 'selection'] },
      expect.any(Function),
    );
    expect(api.contextMenus.create).toHaveBeenCalledWith(
      { id: LINK_MENU_ID, title: 'Add linked job to Job Log', contexts: ['link'] },
      expect.any(Function),
    );
  });

  it('does not create menus on a plain worker restart', () => {
    background.main();
    expect(api.contextMenus.create).not.toHaveBeenCalled();
  });
});

describe('capture gestures', () => {
  beforeEach(() => background.main());

  it('opens the panel synchronously inside the menu click, before reading the page', () => {
    api.contextMenus.onClicked.fire({ menuItemId: PAGE_MENU_ID }, tab());

    // Nothing has been awaited yet: open() must already have run (Chrome rejects it otherwise).
    expect(api.sidePanel.open).toHaveBeenCalledWith({ windowId: 3 });
    expect(api.sidePanel.open.mock.invocationCallOrder[0]).toBeLessThan(
      api.scripting.executeScript.mock.invocationCallOrder[0]!,
    );
  });

  it('runs the extractor in the clicked tab and stores the draft for that window', async () => {
    api.contextMenus.onClicked.fire({ menuItemId: PAGE_MENU_ID }, tab());

    await vi.waitFor(async () =>
      expect(await storedDraft()).toEqual({
        v: 2,
        gesture: 'page',
        url: 'https://jobs.example.test/posting/1',
        title: 'Engineer at Acme',
        capturedAt: expect.any(String),
      }),
    );
    expect(api.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      func: extractPage,
    });
    expect(await storedDraft(4)).toBeUndefined();
  });

  it('treats the keyboard command like a page click', async () => {
    api.commands.onCommand.fire(ADD_JOB_COMMAND, tab());
    expect(api.sidePanel.open).toHaveBeenCalledWith({ windowId: 3 });
    await vi.waitFor(async () =>
      expect(await storedDraft()).toMatchObject({ gesture: 'command', title: 'Engineer at Acme' }),
    );
  });

  it('ignores unknown commands and menu ids', () => {
    api.commands.onCommand.fire('something-else', tab());
    api.contextMenus.onClicked.fire({ menuItemId: 'other' }, tab());
    expect(api.sidePanel.open).not.toHaveBeenCalled();
    expect(api.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('captures only the link URL from the link menu, without reading the page', async () => {
    api.contextMenus.onClicked.fire(
      { menuItemId: LINK_MENU_ID, linkUrl: 'https://jobs.example.test/posting/99' },
      tab(),
    );
    expect(api.sidePanel.open).toHaveBeenCalledWith({ windowId: 3 });
    await vi.waitFor(async () =>
      expect(await storedDraft()).toEqual({
        v: 2,
        gesture: 'link',
        url: 'https://jobs.example.test/posting/99',
        capturedAt: expect.any(String),
      }),
    );
    expect(api.scripting.executeScript).not.toHaveBeenCalled();
  });

  it.each([['javascript:alert(1)'], ['mailto:jobs@acme.com'], [undefined]])(
    'drops a non-web link URL %j',
    async (linkUrl) => {
      await handleCapture('link', tab(), linkUrl);
      expect(await storedDraft()).toEqual({
        v: 2,
        gesture: 'link',
        capturedAt: expect.any(String),
      });
    },
  );
});

describe('handleCapture fallbacks', () => {
  it('falls back to the tab URL when the page cannot be read', async () => {
    api.scripting.executeScript.mockRejectedValue(new Error('Cannot access contents of the page'));
    await expect(handleCapture('page', tab())).resolves.toBeUndefined();
    expect(await storedDraft()).toEqual({
      v: 2,
      gesture: 'page',
      url: 'https://jobs.example.test/posting/1',
      readFailed: true,
      capturedAt: expect.any(String),
    });
  });

  it('leaves the URL blank on a restricted chrome:// page', async () => {
    api.scripting.executeScript.mockRejectedValue(new Error('Cannot access a chrome:// URL'));
    await handleCapture('command', tab({ url: 'chrome://settings' }));
    expect(await storedDraft()).toEqual({
      v: 2,
      gesture: 'command',
      readFailed: true,
      capturedAt: expect.any(String),
    });
  });

  it.each([
    ['no results', []],
    ['undefined', undefined],
    ['a null result', [{ frameId: 0, result: null }]],
    ['a non-object result', [{ frameId: 0, result: 'oops' }]],
  ])('falls back when executeScript returns %s', async (_label, results) => {
    api.scripting.executeScript.mockResolvedValue(results);
    await handleCapture('page', tab());
    expect(await storedDraft()).toMatchObject({ readFailed: true, url: tab().url });
  });

  it.each([['about:srcdoc'], ['blob:https://jobs.example.test/abc'], [42]])(
    'uses the tab URL when the extractor returns the non-web URL %j',
    async (url) => {
      api.scripting.executeScript.mockResolvedValue([
        { frameId: 0, result: { url, title: 'Job' } },
      ]);
      await handleCapture('page', tab());
      expect(await storedDraft()).toMatchObject({ url: tab().url, title: 'Job' });
    },
  );

  it('keeps the newer draft when an older capture in the same window finishes last', async () => {
    let finishSlow!: (value: unknown) => void;
    api.scripting.executeScript
      .mockImplementationOnce(() => new Promise((resolve) => (finishSlow = resolve)))
      .mockResolvedValueOnce([
        { frameId: 0, result: { url: 'https://jobs.example.test/posting/2', title: 'Newer' } },
      ]);

    const slow = handleCapture('command', tab());
    await handleCapture('page', tab({ id: 8, url: 'https://jobs.example.test/posting/2' }));
    finishSlow([{ frameId: 0, result: { url: tab().url, title: 'Older' } }]);
    await slow;

    expect(await storedDraft()).toMatchObject({ title: 'Newer' });
  });

  it('does not let a capture in one window cancel a capture in another', async () => {
    await Promise.all([
      handleCapture('page', tab({ windowId: 3 })),
      handleCapture('page', tab({ windowId: 4 })),
    ]);
    expect(await storedDraft(3)).toBeDefined();
    expect(await storedDraft(4)).toBeDefined();
  });

  it('uses the tab URL when the extractor returns a title but no URL', async () => {
    api.scripting.executeScript.mockResolvedValue([{ frameId: 0, result: { title: 'Job' } }]);
    await handleCapture('page', tab());
    expect(await storedDraft()).toMatchObject({ url: tab().url, title: 'Job' });
  });

  it('skips extraction when the tab has no id', async () => {
    await handleCapture('page', tab({ id: undefined }));
    expect(api.scripting.executeScript).not.toHaveBeenCalled();
    expect(await storedDraft()).toMatchObject({ readFailed: true });
  });

  it('still writes the draft when sidePanel.open rejects', async () => {
    const error = new Error('may only be called in response to a user gesture');
    api.sidePanel.open.mockRejectedValue(error);
    await handleCapture('page', tab());
    expect(consoleError).toHaveBeenCalledWith('sidePanel.open failed', error);
    expect(await storedDraft()).toMatchObject({ title: 'Engineer at Acme' });
  });

  it('still writes the draft when sidePanel.open throws synchronously', async () => {
    api.sidePanel.open.mockImplementation(() => {
      throw new TypeError('no sidePanel');
    });
    await handleCapture('page', tab());
    expect(await storedDraft()).toMatchObject({ title: 'Engineer at Acme' });
  });

  it.each([
    ['no tab', undefined],
    ['no window', tab({ windowId: undefined })],
    ['a sentinel window id', tab({ windowId: -1 })],
  ])('does nothing for %s', async (_label, t) => {
    await expect(handleCapture('page', t)).resolves.toBeUndefined();
    expect(api.sidePanel.open).not.toHaveBeenCalled();
    expect(api.scripting.executeScript).not.toHaveBeenCalled();
    expect(await fakeBrowser.storage.session.get(null)).toEqual({});
  });

  it('logs instead of throwing when storage.session fails', async () => {
    vi.spyOn(fakeBrowser.storage.session, 'set').mockRejectedValue(new Error('quota'));
    await expect(handleCapture('page', tab())).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith('Saving the capture draft failed', expect.any(Error));
  });
});
