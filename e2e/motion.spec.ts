import type { Locator, Page } from '@playwright/test';
import { expect, panelUrl, resumeAction, test, uploadResume } from './fixtures';

interface Sample {
  height: number;
  opacity: number;
  overflow: string;
}

/**
 * Clicks `trigger`, then samples `target` every frame for `ms`, all inside the page, so the
 * first sample is taken in the click's own frame however slow the machine is.
 */
async function clickAndSample(page: Page, trigger: Locator, target: Locator, ms: number) {
  const [button, element] = [await trigger.elementHandle(), await target.elementHandle()];
  return page.evaluate(
    ([button, element, duration]) =>
      new Promise<Sample[]>((resolve) => {
        const out: Sample[] = [];
        const take = () => {
          const style = getComputedStyle(element as HTMLElement);
          out.push({
            height: (element as HTMLElement).getBoundingClientRect().height,
            opacity: Number(style.opacity),
            overflow: style.overflowY,
          });
        };
        (button as HTMLElement).click();
        const start = performance.now();
        const tick = () => {
          take();
          if (performance.now() - start < duration) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
    [button, element, ms] as const,
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

  const opening = await clickAndSample(page, toggle, panel, 350);
  const full = opening.at(-1)!.height;
  expect(full).toBeGreaterThan(200);
  // It starts short and grows (not shown at full height and faded in)...
  expect(opening[0]!.height).toBeLessThan(full / 2);
  expect(opening.some((s) => s.height > 0 && s.height < full - 1)).toBe(true);
  expect(opening.every((s) => s.opacity === 1)).toBe(true);
  // ...clipping only while it moves, so nothing inside is cut off once open.
  expect(opening[0]!.overflow).toBe('clip');
  expect(opening.at(-1)!.overflow).toBe('visible');
  await expect(sheet.getByLabel('Location')).toBeVisible();

  const closing = await clickAndSample(page, toggle, panel, 350);
  expect(closing.some((s) => s.height > 1 && s.height < full - 1)).toBe(true);
  expect(closing.every((s) => s.opacity === 1)).toBe(true);
  // Hidden once shut, so its fields are out of reach.
  await expect(sheet.getByLabel('Location')).toBeHidden();
});

test('an error inside More details opens it at once, its field in view', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('button', { name: 'Add application', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add application' });
  await sheet.getByLabel('Company').fill('Acme');
  await sheet.getByLabel('Job posting URL').fill('acme.com/1');
  await sheet.getByRole('button', { name: /More details/ }).click();
  await sheet.getByLabel('Minimum').fill('lots');
  await sheet.getByRole('button', { name: /More details/ }).click();
  await expect(sheet.getByLabel('Minimum')).toBeHidden();
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  const minimum = sheet.getByLabel('Minimum');
  await expect(minimum).toBeFocused();
  // Opened without the height animation: the focused field stays where focus scrolled it.
  expect(await page.locator('.details-panel').getAttribute('data-instant')).not.toBeNull();
  await expect(minimum).toBeInViewport();
});

test('notes past about twelve lines fade at the cut-off edge', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('button', { name: 'Add application', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add application' });
  await sheet.getByRole('button', { name: /More details/ }).click();
  const notes = sheet.getByLabel('Notes');
  await notes.fill('a\nb\nc');
  await expect(notes).not.toHaveAttribute('data-fade-end');
  const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
  await notes.fill(long);
  // Regression: the fade's state must never reset the field's typed value.
  await expect(notes).toHaveValue(long);
  await notes.evaluate((el) => (el.scrollTop = 0));
  await expect(notes).toHaveAttribute('data-fade-end', 'true');
  await expect(notes).not.toHaveAttribute('data-fade-start');
  await notes.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(notes).toHaveAttribute('data-fade-start', 'true');
  await expect(notes).not.toHaveAttribute('data-fade-end');
});

test("an archived row's menu isn't cut off by the accordion", async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('tab', { name: 'Resumes' }).click();
  const pdf = Buffer.from('%PDF-1.7\n' + ' '.repeat(200));
  await uploadResume(page, { name: 'Old cv.pdf', mimeType: 'application/pdf', buffer: pdf });
  await resumeAction(page, 'Old cv', 'Archive');
  await page.getByRole('button', { name: /^Archived/ }).click();
  // Open (it clips only while it grows).
  await expect(page.locator('.details-panel')).toHaveCSS('overflow-y', 'visible');
  await page.getByRole('button', { name: 'More actions for Old cv' }).click();
  // The last item is visible and takes the click, not clipped by the accordion's list.
  const remove = page.getByRole('menuitem', { name: 'Delete' });
  await expect(remove).toBeVisible();
  const box = (await remove.boundingBox())!;
  const top = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('[role="menuitem"]')?.textContent,
    [box.x + box.width / 2, box.y + box.height / 2] as const,
  );
  expect(top).toContain('Delete');
});

test('a sheet never scrolls while it slides in, so no scrollbar flashes', async ({ session }) => {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(panelUrl(session.extensionId));
  await page.getByRole('button', { name: 'Add application', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add application' });
  // The panel starts below the edge: a dialog that could scroll would show a scrollbar.
  expect(await dialog.evaluate((el) => getComputedStyle(el).overflowY)).toBe('hidden');
  // Scrollbars are hidden everywhere in any case.
  expect(await page.evaluate(() => getComputedStyle(document.body).scrollbarWidth)).toBe('none');
});
