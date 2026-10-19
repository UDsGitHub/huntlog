import { expect, panelUrl, test } from './fixtures';

declare const chrome: typeof browser;

// Spec §4.2: the empty list's tip names the capture shortcut Chrome really has, read with
// commands.getAll (no permission), and Chrome's shortcuts page can be opened from the panel.

test('the empty list names the real capture shortcut', async ({ session }) => {
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  const shortcut = await page.evaluate(async () => {
    const commands = await chrome.commands.getAll();
    return commands.find((command) => command.name === 'add-job')?.shortcut;
  });
  // The suggested Alt+Shift+J, as Chrome writes it on this platform.
  expect(shortcut).toMatch(/^(Alt\+Shift\+J|⌥⇧J)$/);
  const tip = page.getByText(/^Tip: on any job posting, press/);
  await expect(tip).toBeVisible();
  await expect(tip.locator('kbd')).toHaveText(shortcut!);
});

test("the panel can open Chrome's shortcuts page", async ({ session }) => {
  // Shown only when no shortcut is set, which tests can't arrange: check the call it makes.
  const page = await session.context.newPage();
  await page.goto(panelUrl(session.extensionId));
  const opened = session.context.waitForEvent('page');
  await page.evaluate(() => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
  await expect(await opened).toHaveURL('chrome://extensions/shortcuts');
});
