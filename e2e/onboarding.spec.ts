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

test("with no shortcut set, the tip opens Chrome's shortcuts page", async ({ session }) => {
  // Tests can't unset a shortcut, so the panel is told none is set, as Chrome reports it.
  const page = await session.context.newPage();
  await page.addInitScript(() => {
    chrome.commands.getAll = async () => [{ name: 'add-job', shortcut: '' }];
  });
  await page.goto(panelUrl(session.extensionId));
  await expect(page.getByText(/^Tip: right-click any job posting/)).toBeVisible();
  const opened = session.context.waitForEvent('page');
  await page.getByRole('button', { name: 'Set a keyboard shortcut' }).click();
  await expect(await opened).toHaveURL('chrome://extensions/shortcuts');
});
