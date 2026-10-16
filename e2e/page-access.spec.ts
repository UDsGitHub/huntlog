import type { Page, Worker } from '@playwright/test';
import { extractPage } from '../lib/extract';
import { clickToolbarIcon, expect, test } from './fixtures';

// The service worker has the raw `chrome` global; borrow WXT's typings for it.
declare const chrome: typeof browser;

// These verify the spec §8 page-access assumptions against real Chrome with the production build.
const JOB_URL = 'https://jobs.example.test/posting/1';
const JOB_HTML = '<title>  Senior Engineer at Acme  </title><h1>Senior Engineer</h1>';

test.beforeEach(async ({ session }) => {
  await session.context.route('https://jobs.example.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: JOB_HTML }),
  );
});

async function openTab(page: Page, url: string) {
  await page.goto(url);
  await page.bringToFront();
}

/** Runs the real, serialized `extractPage` in the active tab, as the background script does. */
function runExtractor(serviceWorker: Worker) {
  // A string expression: the extractor's source is spliced in, just as executeScript serializes it.
  return serviceWorker.evaluate(`(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: ${extractPage.toString()},
      });
      return { ok: true, value: result.result };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  })()`);
}

test('without a user gesture the extension has no page access', async ({ session }) => {
  const page = await session.context.newPage();
  await openTab(page, JOB_URL);
  expect(await runExtractor(session.serviceWorker)).toEqual({
    ok: false,
    error: expect.stringContaining('Cannot access contents of the page'),
  });
});

test('a click inside the side panel does not grant page access (spec §8 c)', async ({
  session,
}) => {
  const job = await session.context.newPage();
  await openTab(job, JOB_URL);
  const panel = await session.context.newPage();
  await panel.goto(`chrome-extension://${session.extensionId}/sidepanel.html`);

  // A button in the panel's own document, so the click is a real user activation there.
  // Without the `tabs` permission the panel can't see tab URLs, so it tries every other tab.
  await panel.evaluate(() => {
    const button = document.createElement('button');
    button.textContent = 'Read other tabs';
    button.onclick = async () => {
      const self = await chrome.tabs.getCurrent();
      const others = (await chrome.tabs.query({})).filter((t) => t.id !== self?.id);
      const results = await Promise.all(
        others.map((t) =>
          chrome.scripting
            .executeScript({ target: { tabId: t.id! }, func: () => document.title })
            .then(
              () => 'read',
              (error: unknown) => String(error),
            ),
        ),
      );
      button.dataset.result = JSON.stringify(results);
    };
    document.body.append(button);
  });
  const button = panel.getByRole('button', { name: 'Read other tabs' });
  await button.click();

  await expect(button).toHaveAttribute('data-result', /.+/);
  const results: string[] = JSON.parse((await button.getAttribute('data-result'))!);
  expect(results.length).toBeGreaterThanOrEqual(2); // the job tab and the initial blank tab
  expect(results).not.toContain('read');
  expect(results.some((r) => r.includes('Cannot access contents of the page'))).toBe(true);
});

test('the toolbar icon opens the panel but grants no page access', async ({
  session,
  userDataDir,
}) => {
  const page = await session.context.newPage();
  await openTab(page, JOB_URL);
  const tabWidth = () =>
    session.serviceWorker.evaluate(
      async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.width,
    );
  const widthBefore = await tabWidth();

  await clickToolbarIcon(userDataDir, session.extensionId, JOB_URL);

  // The side panel docks beside the tab and narrows it.
  await expect.poll(tabWidth).toBeLessThan(widthBefore!);
  expect(await runExtractor(session.serviceWorker)).toMatchObject({ ok: false });
});

test('after a gesture grants activeTab, the serialized extractor reads the page', async ({
  session,
  userDataDir,
}) => {
  const page = await session.context.newPage();
  await openTab(page, JOB_URL);
  // An action click grants activeTab only when it isn't consumed by opening the side panel.
  await session.serviceWorker.evaluate(() =>
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }),
  );

  await clickToolbarIcon(userDataDir, session.extensionId, JOB_URL);

  expect(await runExtractor(session.serviceWorker)).toEqual({
    ok: true,
    value: { url: JOB_URL, title: 'Senior Engineer at Acme' },
  });
});

test('restricted chrome:// pages stay unreadable even with activeTab (spec §8 d)', async ({
  session,
  userDataDir,
}) => {
  const page = await session.context.newPage();
  await openTab(page, 'chrome://version/');
  await session.serviceWorker.evaluate(() =>
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }),
  );

  await clickToolbarIcon(userDataDir, session.extensionId, 'chrome://version/');

  expect(await runExtractor(session.serviceWorker)).toEqual({
    ok: false,
    error: expect.stringContaining('chrome://'),
  });
});
