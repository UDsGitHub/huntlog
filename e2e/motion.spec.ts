import type { Locator, Page } from '@playwright/test';
import { expect, panelUrl, test } from './fixtures';

/** Samples an element's height and opacity every frame for `ms`. */
async function sample(page: Page, target: Locator, ms: number) {
  const handle = await target.elementHandle();
  return page.evaluate(
    ([element, duration]) =>
      new Promise<{ height: number; opacity: number }[]>((resolve) => {
        const out: { height: number; opacity: number }[] = [];
        const start = performance.now();
        const tick = () => {
          const el = element as HTMLElement;
          out.push({
            height: el.getBoundingClientRect().height,
            opacity: Number(getComputedStyle(el).opacity),
          });
          if (performance.now() - start < duration) requestAnimationFrame(tick);
          else resolve(out);
        };
        tick();
      }),
    [handle, ms] as const,
  );
}

test('More details grows and shrinks in height, with no fade (spec §3)', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('button', { name: 'Add application', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add application' });
  const toggle = sheet.getByRole('button', { name: /More details/ });
  const panel = page.locator('.details-panel');

  await toggle.click();
  const opening = await sample(page, panel, 300);
  const full = opening.at(-1)!.height;
  expect(full).toBeGreaterThan(200);
  // It starts short and grows (not shown at full height and faded in).
  expect(opening[0]!.height).toBeLessThan(full / 2);
  expect(opening.some((s) => s.height > 0 && s.height < full - 1)).toBe(true);
  expect(opening.every((s) => s.opacity === 1)).toBe(true);
  await expect(sheet.getByLabel('Location')).toBeVisible();

  await toggle.click();
  const closing = await sample(page, panel, 300);
  expect(closing.some((s) => s.height > 1 && s.height < full - 1)).toBe(true);
  expect(closing.every((s) => s.opacity === 1)).toBe(true);
  // Hidden once shut, so its fields are out of reach.
  await expect(sheet.getByLabel('Location')).toBeHidden();
});

test('a sheet never scrolls while it slides in, so no scrollbar flashes', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('button', { name: 'Add application', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add application' });
  // The panel starts below the edge: a dialog that could scroll would show a scrollbar.
  const overflow = await dialog.evaluate((el) => getComputedStyle(el).overflowY);
  expect(overflow).toBe('hidden');
  // Scrollbars are hidden everywhere in any case.
  expect(await page.evaluate(() => getComputedStyle(document.body).scrollbarWidth)).toBe('none');
});
