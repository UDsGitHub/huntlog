import fs from 'node:fs';
import path from 'node:path';
import { createDraft, draftKey } from '../lib/captureDraft';
import { extractPage } from '../lib/extract';
import { clickToolbarIcon, expect, expectNoHorizontalScroll, panelUrl, test } from './fixtures';

// The service worker has the raw `chrome` global; borrow WXT's typings for it.
declare const chrome: typeof browser;

// M8 slice: right-click a posting with JSON-LD → title, company, location, work mode and salary
// arrive prefilled. Playwright can't click the context menu, so this runs its two halves for
// real: the serialized extractor in the tab after a gesture grants activeTab (as the background
// script does), then the draft the background script writes, read by the panel's form.
const JOB_URL = 'https://careers.acme.test/jobs/4012?utm_source=feed';
const PAGE = fs.readFileSync(
  path.resolve(import.meta.dirname, '../tests/fixtures/pages/jsonld-full.html'),
  'utf8',
);
const HINT = 'Auto-filled, please check';

test('a posting with JSON-LD prefills title, company, location and salary', async ({
  session,
  userDataDir,
}) => {
  await session.context.route('https://careers.acme.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: PAGE }),
  );
  const job = await session.context.newPage();
  await job.goto(JOB_URL);
  await job.bringToFront();
  // An action click grants activeTab only when it isn't consumed by opening the side panel.
  await session.serviceWorker.evaluate(() =>
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }),
  );
  await clickToolbarIcon(userDataDir, session.extensionId, JOB_URL);

  const result = (await session.serviceWorker.evaluate(`(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: ${extractPage.toString()},
    });
    return frame.result;
  })()`)) as Record<string, unknown>;
  expect(result).toEqual({
    url: 'https://careers.acme.test/jobs/4012?gh_jid=4012',
    title: 'Platform Engineer & Tech Lead',
    company: 'Acme Robotics',
    location: 'Berlin, Germany',
    salary: { min: 85000, max: 95000, currency: 'EUR', period: 'year' },
  });

  const panel = await session.context.newPage();
  await panel.setViewportSize({ width: 320, height: 700 });
  await panel.goto(panelUrl(session.extensionId));
  const windowId = await panel.evaluate(async () => (await chrome.windows.getCurrent()).id!);
  await session.serviceWorker.evaluate(
    ([key, value]) => chrome.storage.session.set({ [key]: value }),
    [draftKey(windowId), createDraft('page', result)] as const,
  );

  await expect(panel.getByLabel('Job posting URL')).toHaveValue(
    'https://careers.acme.test/jobs/4012?gh_jid=4012',
  );
  await expect(panel.getByLabel('Job title')).toHaveValue('Platform Engineer & Tech Lead');
  await expect(panel.getByLabel('Company')).toHaveValue('Acme Robotics');
  await expect(panel.getByLabel('Company')).toHaveAccessibleDescription(HINT);
  await expect(panel.getByLabel('Location')).toHaveValue('Berlin, Germany');
  await expect(panel.getByLabel('Location')).toBeVisible();
  await expect(panel.getByLabel('Minimum')).toHaveValue('85,000');
  await expect(panel.getByLabel('Maximum')).toHaveValue('95,000');
  await expect(panel.getByRole('combobox', { name: 'Currency' })).toHaveValue(/EUR/);
  await expectNoHorizontalScroll(panel);

  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  const row = panel.getByRole('listitem').filter({ hasText: 'Acme Robotics' });
  await expect(row).toContainText('Platform Engineer & Tech Lead');
  await expect(row).toContainText('Berlin, Germany');
});

test('a Greenhouse posting without JSON-LD names its title and company', async ({
  session,
  userDataDir,
}) => {
  const url = 'https://boards.greenhouse.io/acmerobotics/jobs/4012';
  const page = fs.readFileSync(
    path.resolve(import.meta.dirname, '../tests/fixtures/pages/greenhouse.html'),
    'utf8',
  );
  await session.context.route('https://boards.greenhouse.io/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: page }),
  );
  const job = await session.context.newPage();
  await job.goto(url);
  await job.bringToFront();
  await session.serviceWorker.evaluate(() =>
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }),
  );
  await clickToolbarIcon(userDataDir, session.extensionId, url);
  const result = await session.serviceWorker.evaluate(`(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: ${extractPage.toString()},
    });
    return frame.result;
  })()`);
  expect(result).toEqual({ url, title: 'Robotics Engineer', company: 'Acme Robotics' });
});
