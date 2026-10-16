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
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });
  const serviceWorker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(serviceWorker.url()).host;
  return { context, serviceWorker, extensionId };
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
