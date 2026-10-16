import type { Browser } from 'wxt/browser';
import { createDraft, draftKey, type CaptureDraft, type CaptureSource } from '@/lib/captureDraft';
import { extractPage } from '@/lib/extract';

export const MENU_TITLE = 'Add job to Job Log';
export const PAGE_MENU_ID = 'add-job-page';
export const LINK_MENU_ID = 'add-job-link';
export const ADD_JOB_COMMAND = 'add-job';

type Tab = Browser.tabs.Tab;

/**
 * Handles a capture gesture (context menu or keyboard command), which grants `activeTab`.
 *
 * `sidePanel.open()` is called synchronously, before any `await`: Chrome only accepts it while the
 * user gesture is still active. The panel may therefore mount before the draft is written, so it
 * both reads the draft on mount and listens for `storage.session` changes.
 */
export async function handleCapture(source: CaptureSource, tab?: Tab, linkUrl?: string) {
  const windowId = tab?.windowId;
  if (windowId === undefined || windowId < 0) {
    console.warn('Capture ignored: no window for this tab');
    return;
  }
  const opened = openPanel(windowId);

  const draft =
    source === 'link' ? createDraft('link', { url: linkUrl }) : await readPage(source, tab!);
  try {
    await browser.storage.session.set({ [draftKey(windowId)]: draft });
  } catch (error) {
    console.error('Saving the capture draft failed', error);
  }
  await opened;
}

function openPanel(windowId: number): Promise<void> {
  try {
    return browser.sidePanel.open({ windowId }).catch((error: unknown) => {
      console.error('sidePanel.open failed', error);
    });
  } catch (error) {
    console.error('sidePanel.open failed', error);
    return Promise.resolve();
  }
}

/** Runs the extractor in the tab. Restricted pages (chrome://, the Web Store) reject; fall back. */
async function readPage(source: CaptureSource, tab: Tab): Promise<CaptureDraft> {
  if (tab.id !== undefined && tab.id >= 0) {
    try {
      const results = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPage,
      });
      const page: unknown = results?.[0]?.result;
      if (page && typeof page === 'object') {
        const { url, title } = page as Record<string, unknown>;
        return createDraft(source, { url: url ?? tab.url, title });
      }
    } catch (error) {
      console.warn("Couldn't read the page; opening a blank form", error);
    }
  }
  return createDraft(source, { url: tab.url, readFailed: true });
}

function createMenus() {
  const reportError = () => {
    if (browser.runtime.lastError) {
      console.error('contextMenus.create failed', browser.runtime.lastError);
    }
  };
  // `frame` covers job boards embedded in an iframe; extraction still reads the top frame.
  browser.contextMenus.create(
    { id: PAGE_MENU_ID, title: MENU_TITLE, contexts: ['page', 'frame', 'selection'] },
    reportError,
  );
  browser.contextMenus.create(
    { id: LINK_MENU_ID, title: MENU_TITLE, contexts: ['link'] },
    reportError,
  );
}

export default defineBackground(() => {
  // Runs on every service-worker start, so the toolbar icon always opens the side panel.
  void (async () => {
    try {
      await browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (error) {
      console.error('setPanelBehavior failed', error);
    }
  })();

  // Menus persist across service-worker restarts, so create them only on install or update.
  // removeAll first: an update would otherwise fail with a duplicate-id error.
  browser.runtime.onInstalled.addListener(() => {
    void (async () => {
      try {
        await browser.contextMenus.removeAll();
        createMenus();
      } catch (error) {
        console.error('Creating context menus failed', error);
      }
    })();
  });

  // Listeners are registered synchronously at top level so they fire after the worker wakes.
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === PAGE_MENU_ID) void handleCapture('page', tab);
    else if (info.menuItemId === LINK_MENU_ID) void handleCapture('link', tab, info.linkUrl);
  });

  browser.commands.onCommand.addListener((command, tab) => {
    if (command === ADD_JOB_COMMAND) void handleCapture('command', tab);
  });
});
