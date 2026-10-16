import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
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
  let nextId = 0;
  const call = <T>(method: string, params: object) =>
    new Promise<T>((resolve, reject) => {
      const id = ++nextId;
      ws.addEventListener('message', (event) => {
        const reply = JSON.parse(String(event.data));
        if (reply.id !== id) return;
        if (reply.error) reject(new Error(`${method}: ${reply.error.message}`));
        else resolve(reply.result as T);
      });
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
