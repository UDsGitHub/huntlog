import {
  test as base,
  chromium,
  type BrowserContext,
  type Locator,
  type Page,
  type Worker,
} from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const EXTENSION_PATH = path.resolve(import.meta.dirname, '../.output/chrome-mv3');

export interface ExtensionSession {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}

/** Launches Chromium with the unpacked build. Reusing `userDataDir` simulates a browser restart. */
export async function launchExtension(userDataDir: string): Promise<ExtensionSession> {
  if (!fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
    throw new Error(`No build at ${EXTENSION_PATH}. Run \`npm run build\` first.`);
  }
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    // Tests assert en-US date formats; don't depend on the machine's language.
    locale: 'en-US',
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      // Lets tests click the toolbar icon through CDP (Extensions.triggerAction), test-only.
      '--enable-unsafe-extension-debugging',
      '--remote-debugging-port=0',
    ],
  });
  const serviceWorker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(serviceWorker.url()).host;
  return { context, serviceWorker, extensionId };
}

/**
 * Clicks the extension's toolbar icon on the tab showing `tabUrl`, like a real user gesture.
 * Playwright can't click the toolbar or native context menus, and its key presses never reach
 * Chrome's extension shortcuts, so this is the only real gesture available to tests.
 */
export async function clickToolbarIcon(userDataDir: string, extensionId: string, tabUrl: string) {
  const [port, wsPath] = fs
    .readFileSync(path.join(userDataDir, 'DevToolsActivePort'), 'utf8')
    .trim()
    .split('\n');
  const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  // One listener settles calls by id; closing the socket rejects anything still pending.
  const pending = new Map<
    number,
    { method: string; resolve: (r: unknown) => void; reject: (e: Error) => void }
  >();
  ws.addEventListener('message', (event) => {
    const reply = JSON.parse(String(event.data));
    const call = pending.get(reply.id);
    if (!call) return;
    pending.delete(reply.id);
    if (reply.error) call.reject(new Error(`${call.method}: ${reply.error.message}`));
    else call.resolve(reply.result);
  });
  ws.addEventListener('close', () => {
    for (const call of pending.values())
      call.reject(new Error(`${call.method}: CDP socket closed`));
    pending.clear();
  });
  let nextId = 0;
  const call = <T>(method: string, params: object) =>
    new Promise<T>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { method, resolve: resolve as (r: unknown) => void, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  try {
    const { targetInfos } = await call<{ targetInfos: { targetId: string; url: string }[] }>(
      'Target.getTargets',
      { filter: [{ type: 'tab' }] },
    );
    const tab = targetInfos.find((t) => t.url === tabUrl);
    if (!tab) throw new Error(`No tab at ${tabUrl}`);
    await call('Extensions.triggerAction', { id: extensionId, targetId: tab.targetId });
  } finally {
    ws.close();
  }
}

export const test = base.extend<{ userDataDir: string; session: ExtensionSession }>({
  // eslint-disable-next-line no-empty-pattern
  userDataDir: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-log-e2e-'));
    await use(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  },
  session: async ({ userDataDir }, use) => {
    const session = await launchExtension(userDataDir);
    await use(session);
    await session.context.close();
  },
});

export const expect = test.expect;

export const panelUrl = (extensionId: string) => `chrome-extension://${extensionId}/sidepanel.html`;

/**
 * Waits until nothing visible is moving or fading, including animations that start meanwhile
 * (a slide a click just started; a color measured mid-fade is too faint). Capped at 2 s, and
 * animations in hidden sections are ignored: content-visibility stops them, so they never end.
 */
export async function animationsSettled(page: Page) {
  await page.waitForTimeout(100);
  await page.evaluate(async () => {
    const deadline = performance.now() + 2000;
    while (performance.now() < deadline) {
      const moving = document.getAnimations().filter((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        return (
          animation.playState === 'running' && target instanceof Element && target.checkVisibility()
        );
      });
      if (moving.length === 0) return;
      await Promise.race([
        Promise.allSettled(moving.map((animation) => animation.finished)),
        new Promise((resolve) => setTimeout(resolve, 200)),
      ]);
    }
  });
}

/** The 320px rule (CLAUDE.md DoD #6): the panel never scrolls sideways. */
export async function expectNoHorizontalScroll(page: Page) {
  // The settled layout: a page sliding in is briefly offset while it moves.
  await animationsSettled(page);
  // The page, each tab section that scrolls on its own, and open sheets: none may scroll sideways.
  const overflows = await page.evaluate(() =>
    [
      document.documentElement,
      ...document.querySelectorAll<HTMLElement>('[data-tab-panel]'),
      // Open sheets sit in the top layer, outside the page's own overflow.
      ...document.querySelectorAll<HTMLElement>('dialog[open], dialog[open] .sheet-panel > *'),
    ]
      .filter((element) => element.scrollWidth > element.clientWidth)
      .map((element) => element.id || element.tagName),
  );
  expect(overflows).toEqual([]);
}

/** The tab section on screen; each scrolls on its own (spec §3). */
export const activePanel = (page: Page) => page.locator('[data-tab-panel][data-active]');

/** Scrolls the section on screen to `top` (a number, or 'end'). */
export async function scrollPanel(page: Page, top: number | 'end') {
  await activePanel(page).evaluate(
    (element, to) => element.scrollTo(0, to === 'end' ? element.scrollHeight : to),
    top,
  );
}

/**
 * Waits until no sheet is open or sliding out. The page behind a sheet is inert meanwhile, so a
 * `.focus()` or key press right after a Save would be lost (clicks wait on their own).
 */
export async function sheetsClosed(page: Page) {
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

/**
 * Uploads a resume from the Resumes tab's + Upload sheet (the tab must be showing). Leaves the
 * sheet open when the upload is refused, so its error can be checked.
 */
export async function uploadResume(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
  { expectError = false } = {},
) {
  await page.getByRole('button', { name: 'Upload resume' }).click();
  const sheet = page.getByRole('dialog', { name: 'Upload a resume' });
  await sheet.getByLabel('Resume file').setInputFiles(file);
  await sheet.getByRole('button', { name: 'Upload', exact: true }).click();
  if (!expectError) await sheetsClosed(page);
  return sheet;
}

/** Adds an application through the + Add form and waits for its sheet to close. */
export async function addApplication(
  page: Page,
  {
    company,
    title,
    url,
    applied,
  }: { company: string; title?: string; url: string; applied?: string },
) {
  await page.getByRole('button', { name: 'Add application', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Add application' });
  await form.getByLabel('Company').fill(company);
  if (title) await form.getByLabel('Job title').fill(title);
  await form.getByLabel('Job posting URL').fill(url);
  if (applied) await form.getByLabel('Date applied').fill(applied);
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await sheetsClosed(page);
}

/** Picks a status from a list row's chip (the status sheet, or its "When did you apply?" step). */
export async function pickStatus(page: Page, company: string, status: string) {
  await page
    .getByRole('listitem')
    .filter({ hasText: company })
    .getByRole('button', { name: /^Status: / })
    .click();
  await page
    .getByRole('dialog', { name: /Change status|When did you apply/ })
    .getByRole('button', { name: status, exact: true })
    .click();
}

/** Picks an action from a resume row's ⋯ menu. */
export async function resumeAction(page: Page, name: string, action: string) {
  await page.getByRole('button', { name: `More actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: action }).click();
}

/** Picks an option of a `Select` (spec §3) by its label: opens it, then clicks the option. */
export async function chooseOption(scope: Page | Locator, label: string | RegExp, option: string) {
  const select = scope.getByRole('combobox', { name: label, exact: typeof label === 'string' });
  await select.click();
  const list = scope.locator(`[id="${await select.getAttribute('aria-controls')}"]`);
  await list.getByRole('option', { name: option, exact: true }).click();
}
