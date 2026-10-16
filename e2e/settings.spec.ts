import { expect, panelUrl, test } from './fixtures';

// Settings live in chrome.storage.local and apply in every open window (spec §4.8). Until the
// Settings tab exists (M6), the service worker writes them, as another window would.
test('the first day of the week from Settings moves Stats live', async ({ session }) => {
  const page = await session.context.newPage();
  // Friday Oct 16 2026; en-US weeks start on Sunday Oct 11.
  await page.clock.setFixedTime(new Date(2026, 9, 16, 15));
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('tab', { name: 'Stats' }).click();
  const stats = page.getByRole('tabpanel', { name: 'Stats' });
  await expect(stats).toContainText('Oct 11, 2026 – Oct 17, 2026');

  const setWeekStart = (weekStartsOn?: 0 | 1 | 6) =>
    session.serviceWorker.evaluate(async (value) => {
      const api = (globalThis as unknown as { chrome: typeof browser }).chrome;
      if (value === undefined) await api.storage.local.remove('settings.weekStartsOn');
      else await api.storage.local.set({ 'settings.weekStartsOn': value });
    }, weekStartsOn);

  await setWeekStart(1);
  await expect(stats).toContainText('Oct 12, 2026 – Oct 18, 2026');

  // Kept across a reload: it's read from storage, not just from the change event.
  await page.reload();
  await page.getByRole('tab', { name: 'Stats' }).click();
  await expect(stats).toContainText('Oct 12, 2026 – Oct 18, 2026');

  await setWeekStart(6);
  await expect(stats).toContainText('Oct 10, 2026 – Oct 16, 2026');
});
