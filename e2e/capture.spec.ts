import type { Page } from '@playwright/test';
import { createDraft, draftKey, type CaptureDraft } from '../lib/captureDraft';
import {
  expect,
  expectNoHorizontalScroll,
  type ExtensionSession,
  panelUrl,
  test,
} from './fixtures';

// The service worker and extension pages have the raw `chrome` global; borrow WXT's typings.
declare const chrome: typeof browser;

// M1 slice, panel half: a capture draft in storage.session prefills the Add form in the
// production build. Playwright can't click native context menus or send extension shortcuts,
// so the draft is written the way the background script writes it (see tests/background.test.ts
// for the gesture handlers and e2e/page-access.spec.ts for the real page read).
const JOB_URL = 'https://jobs.example.test/posting/1';
const HINT = 'Auto-filled, please check';

async function openPanel(session: ExtensionSession, width = 360) {
  const panel = await session.context.newPage();
  await panel.setViewportSize({ width, height: 700 });
  await panel.goto(panelUrl(session.extensionId));
  await expect(panel.getByRole('heading', { level: 1, name: 'Job Log' })).toBeVisible();
  const windowId = await panel.evaluate(async () => (await chrome.windows.getCurrent()).id!);
  return { panel, windowId };
}

function writeDraft(session: ExtensionSession, windowId: number, draft: CaptureDraft) {
  return session.serviceWorker.evaluate(
    ([key, value]) => chrome.storage.session.set({ [key]: value }),
    [draftKey(windowId), draft] as const,
  );
}

function readDraft(session: ExtensionSession, windowId: number) {
  return session.serviceWorker.evaluate(
    async (key) => (await chrome.storage.session.get(key))[key],
    draftKey(windowId),
  );
}

const pageDraft = () => createDraft('page', { url: JOB_URL, title: 'Senior Engineer at Acme' });

function form(panel: Page) {
  return {
    url: panel.getByLabel('Job posting URL'),
    company: panel.getByLabel('Company'),
    title: panel.getByLabel(/Job title/),
  };
}

test('a captured page prefills the form, and saving lists it with its title', async ({
  session,
}) => {
  const { panel, windowId } = await openPanel(session);
  await writeDraft(session, windowId, pageDraft());

  const { url, company, title } = form(panel);
  await expect(url).toHaveValue(JOB_URL);
  await expect(title).toHaveValue('Senior Engineer at Acme');
  await expect(url).toHaveAccessibleDescription(HINT);
  await expect(title).toHaveAccessibleDescription(HINT);
  await expect(company).toBeFocused();
  await expect.poll(() => readDraft(session, windowId)).toBeUndefined();

  await panel.keyboard.type('Acme');
  await panel.keyboard.press('Enter');

  const list = panel.getByRole('list', { name: 'Applications' });
  await expect(list).toContainText('Acme');
  await expect(list).toContainText('Senior Engineer at Acme');
  await expect(list.getByRole('link', { name: 'Open job posting for Acme' })).toHaveAttribute(
    'href',
    JOB_URL,
  );
  await expect(panel.getByText(HINT)).toHaveCount(0);
});

test('a capture leaves More details collapsed when it filled nothing in there', async ({
  session,
}) => {
  const { panel, windowId } = await openPanel(session);
  for (const draft of [
    pageDraft(),
    createDraft('link', { url: JOB_URL }),
    createDraft('command', { url: JOB_URL }),
  ]) {
    await writeDraft(session, windowId, draft);
    await expect(panel.getByRole('heading', { name: 'Add application' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'More details' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    // A capture's prefill isn't typing: Back leaves without asking.
    await panel.getByRole('button', { name: 'Back' }).click();
    await expect(panel.getByRole('dialog', { name: 'Add application' })).toBeHidden();
  }
});

test('a draft written before the panel opens is picked up on load', async ({ session }) => {
  const probe = await session.context.newPage();
  await probe.goto(panelUrl(session.extensionId));
  const windowId = await probe.evaluate(async () => (await chrome.windows.getCurrent()).id!);
  await probe.close();
  await writeDraft(session, windowId, pageDraft());

  const { panel } = await openPanel(session);
  await expect(form(panel).title).toHaveValue('Senior Engineer at Acme');
});

test('a link capture fills only the URL', async ({ session }) => {
  const { panel, windowId } = await openPanel(session);
  await writeDraft(
    session,
    windowId,
    createDraft('link', { url: 'https://jobs.example.test/posting/9' }),
  );

  const { url, title } = form(panel);
  await expect(url).toHaveValue('https://jobs.example.test/posting/9');
  await expect(title).toHaveValue('');
  await expect(panel.getByText(HINT)).toHaveCount(1);
});

test('a restricted page opens a blank form with an explanation', async ({ session }) => {
  const { panel, windowId } = await openPanel(session);
  await writeDraft(
    session,
    windowId,
    createDraft('command', { url: 'chrome://settings', readFailed: true }),
  );

  await expect(panel.getByRole('status')).toHaveText(/Couldn't read this page/);
  await expect(form(panel).url).toHaveValue('');
});

test("a capture in another window doesn't prefill this panel", async ({ session }) => {
  const { panel, windowId } = await openPanel(session);
  const otherWindowId = await session.serviceWorker.evaluate(
    async () => (await chrome.windows.create({ url: 'about:blank' }))?.id ?? -1,
  );
  expect(otherWindowId).not.toBe(windowId);

  await writeDraft(session, otherWindowId, pageDraft());
  // Give the panel time to (wrongly) react before asserting nothing changed.
  await panel.waitForTimeout(300);

  await expect(panel.getByRole('form')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Add application' })).toBeVisible();
  expect(await readDraft(session, otherWindowId)).toBeDefined();
});

test('the prefilled form fits a 320px panel with no horizontal scroll', async ({ session }) => {
  const { panel, windowId } = await openPanel(session, 320);
  await writeDraft(
    session,
    windowId,
    createDraft('page', {
      url: `https://jobs.example.test/${'a'.repeat(400)}`,
      title: `Principal ${'Engineer '.repeat(30)}`,
    }),
  );
  await expect(panel.getByText(HINT)).toHaveCount(2);

  await expectNoHorizontalScroll(panel);
});

test("a capture closes another tab's open sheet, so it can't block the panel afterwards", async ({
  session,
}) => {
  const { panel, windowId } = await openPanel(session);
  for (const [tab, opener, sheet] of [
    ['Resumes', 'Upload resume', 'Upload a resume'],
    ['Stats', 'Custom…', 'Custom range'],
  ] as const) {
    await panel.getByRole('tab', { name: tab }).click();
    await panel.getByRole(tab === 'Stats' ? 'radio' : 'button', { name: opener }).click();
    await expect(panel.getByRole('dialog', { name: sheet })).toBeVisible();
    await writeDraft(session, windowId, pageDraft());
    await expect(form(panel).url).toHaveValue(JOB_URL);
    await expect(panel.getByRole('dialog', { name: sheet })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Back' }).click();
    await expect(panel.locator('dialog[open]')).toHaveCount(0);
    // The panel is usable again: nothing modal is left behind.
    await panel.getByRole('tab', { name: tab }).click();
    const reopen = panel.getByRole(tab === 'Stats' ? 'radio' : 'button', { name: opener });
    await expect(reopen).toBeEnabled();
    await reopen.click();
    await expect(panel.getByRole('dialog', { name: sheet })).toBeVisible();
    await panel.keyboard.press('Escape');
    await expect(panel.locator('dialog[open]')).toHaveCount(0);
  }
});

test('a capture closes Settings and a confirmation open on top of it', async ({ session }) => {
  const { panel, windowId } = await openPanel(session);
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = panel.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('button', { name: 'Delete all data' }).click();
  await expect(panel.getByRole('dialog', { name: 'Delete all data?' })).toBeVisible();
  await writeDraft(session, windowId, pageDraft());
  await expect(form(panel).url).toHaveValue(JOB_URL);
  // Both sheets go: only the capture's form is left.
  await expect(panel.locator('dialog[open]')).toHaveCount(1);
  await expect(settings).toHaveCount(0);
  await panel.getByRole('button', { name: 'Back' }).click();
  await expect(panel.locator('dialog[open]')).toHaveCount(0);
  // Focus lands on the floating + Add, not lost with the control Settings had focused.
  await expect(panel.getByRole('button', { name: 'Add application', exact: true })).toBeFocused();
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(settings).toBeVisible();
});
