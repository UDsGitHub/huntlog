import { expect, test } from './fixtures';

// The service worker has the raw `chrome` global; borrow WXT's typings for it.
declare const chrome: typeof browser;

test('toolbar icon is set to open the side panel', async ({ session }) => {
  // Playwright cannot click the toolbar, so check the behavior the background script registered.
  const behavior = await session.serviceWorker.evaluate(() => chrome.sidePanel.getPanelBehavior());
  expect(behavior.openPanelOnActionClick).toBe(true);
});
