import type { Browser } from 'wxt/browser';
import {
  createDraft,
  draftKey,
  sanitizeTitle,
  sanitizeUrl,
  type CaptureDraft,
  type CaptureGesture,
} from '@/lib/captureDraft';
import { extractPage } from '@/lib/extract';

export const MENU_TITLE = 'Add job to Huntlog';
// Distinct from the page item: right-clicking a link inside selected text shows both.
export const LINK_MENU_TITLE = 'Add linked job to Huntlog';
export const PAGE_MENU_ID = 'add-job-page';
export const LINK_MENU_ID = 'add-job-link';
export const ADD_JOB_COMMAND = 'add-job';

type Tab = Browser.tabs.Tab;

/** Latest capture per window, so a slow page read can't overwrite a newer capture's draft. */
const latestCapture = new Map<number, number>();
let captureSeq = 0;

/**
 * Handles a capture gesture (context menu or keyboard command), which grants `activeTab`.
 *
 * `sidePanel.open()` is called synchronously, before any `await`: Chrome only accepts it while the
 * user gesture is still active. The panel may therefore mount before the draft is written, so it
 * both reads the draft on mount and listens for `storage.session` changes.
 */
export async function handleCapture(
  gesture: CaptureGesture,
  tab?: Tab,
  linkUrl?: string,
  /** Text selected when the context menu opened, in any frame: the title the user chose. */
  selectionText?: string,
) {
  const windowId = tab?.windowId;
  if (windowId === undefined || windowId < 0) {
    console.warn('Capture ignored: no window for this tab');
    return;
  }
  const opened = openPanel(windowId);
  const seq = ++captureSeq;
  latestCapture.set(windowId, seq);

  const draft =
    gesture === 'link'
      ? createDraft('link', { url: linkUrl })
      : await readPage(gesture, tab!, selectionText);
  if (latestCapture.get(windowId) !== seq) {
    await opened;
    return;
  }
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
async function readPage(
  gesture: CaptureGesture,
  tab: Tab,
  selectionText?: string,
): Promise<CaptureDraft> {
  if (tab.id !== undefined && tab.id >= 0) {
    try {
      const results = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPage,
      });
      const page: unknown = results?.[0]?.result;
      if (page && typeof page === 'object') {
        const { url, title, company, location, workMode, salary } = page as Record<string, unknown>;
        return createDraft(gesture, {
          url: sanitizeUrl(url) ?? tab.url,
          title: sanitizeTitle(selectionText) ?? title,
          company,
          location,
          workMode,
          salary,
        });
      }
    } catch (error) {
      console.warn("Couldn't read the page; opening a blank form", error);
    }
  }
  return createDraft(gesture, { url: tab.url, title: selectionText, readFailed: true });
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
    { id: LINK_MENU_ID, title: LINK_MENU_TITLE, contexts: ['link'] },
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
    if (info.menuItemId === PAGE_MENU_ID) {
      void handleCapture('page', tab, undefined, info.selectionText);
    } else if (info.menuItemId === LINK_MENU_ID) void handleCapture('link', tab, info.linkUrl);
  });

  browser.commands.onCommand.addListener((command, tab) => {
    if (command === ADD_JOB_COMMAND) void handleCapture('command', tab);
  });
});
