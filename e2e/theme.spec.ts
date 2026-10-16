import type { Page, Worker } from '@playwright/test';
import { expect, expectNoHorizontalScroll, panelUrl, test } from './fixtures';

// Theme (spec §4.8, §9). Until the Settings tab exists (M6), the service worker writes the
// setting, as another window would.
const setTheme = (worker: Worker, theme: 'system' | 'light' | 'dark') =>
  worker.evaluate(async (value) => {
    const api = (globalThis as unknown as { chrome: typeof browser }).chrome;
    await api.storage.local.set({ 'settings.theme': value });
  }, theme);

const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

const LIGHT_BG = 'rgb(255, 255, 255)';
const DARK_BG = 'rgb(9, 9, 11)';

test('Dark applies live, survives a reload, and never flashes light', async ({ session }) => {
  const page = await session.context.newPage();
  // Records the theme the moment <body> starts, before any app code could have run.
  await page.addInitScript(() => {
    new MutationObserver((_, observer) => {
      if (!document.body) return;
      (window as unknown as { themeAtBody?: string }).themeAtBody =
        document.documentElement.dataset.theme;
      observer.disconnect();
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(panelUrl(session.extensionId));
  await expect(page.getByRole('tab', { name: 'Stats' })).toBeVisible();
  expect(await background(page)).toBe(LIGHT_BG);

  await setTheme(session.serviceWorker, 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await background(page)).toBe(DARK_BG);
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');

  await page.reload();
  expect(await page.evaluate(() => (window as { themeAtBody?: string }).themeAtBody)).toBe('dark');
  await expect(page.getByRole('tab', { name: 'Stats' })).toBeVisible();
  expect(await background(page)).toBe(DARK_BG);
  await expectNoHorizontalScroll(page);

  await setTheme(session.serviceWorker, 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await background(page)).toBe(LIGHT_BG);
});

test('System follows the OS, live', async ({ session }) => {
  const page = await session.context.newPage();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(panelUrl(session.extensionId));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // A fixed choice ignores the OS.
  await setTheme(session.serviceWorker, 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await setTheme(session.serviceWorker, 'system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('the resume viewer and the notices page follow the theme', async ({ session }) => {
  await setTheme(session.serviceWorker, 'dark');
  const page = await session.context.newPage();
  await page.goto(`chrome-extension://${session.extensionId}/resume-viewer.html?id=missing`);
  await expect(page.getByText("This resume isn't available.")).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await background(page)).toBe(DARK_BG);

  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`chrome-extension://${session.extensionId}/notices.html`);
  await expect(page.getByRole('heading', { name: 'Third-party notices' })).toBeVisible();
  await expect(page.getByText('SIL OPEN FONT LICENSE Version 1.1')).toBeVisible();
  await expect(page.locator('pre').filter({ hasText: 'ISC License' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectNoHorizontalScroll(page);
});
