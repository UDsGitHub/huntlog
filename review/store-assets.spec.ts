import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createDraft, draftKey } from '../lib/captureDraft';
import {
  expect,
  panelUrl,
  pickStatus,
  sheetsClosed,
  test,
  uploadResume,
  type ExtensionSession,
} from '../e2e/fixtures';

// Chrome Web Store images (spec §8, docs/store/listing.md): five 1280×800 screenshots and the
// 440×280 promo tile, made from the real production build with sample data. Each screenshot is
// the side panel as captured, set beside a caption. `npm run build && npm run store-assets`.

declare const chrome: typeof browser;

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs/store');
const WORK = path.join(ROOT, 'test-results/store-assets');
const NOW = new Date(2026, 9, 16, 15);
const PANEL = { width: 400, height: 720 };
const PDF = Buffer.from('%PDF-1.7\n' + ' '.repeat(2400));
const ICON = fs.readFileSync(path.join(ROOT, 'assets/icon.svg'), 'utf8');
const FONT = path.join(ROOT, 'assets/fonts/geist-latin.woff2');

// Fictional companies. Dates lead up to Friday, October 16, 2026.
const CSV = [
  'Company,Job title,URL,Status,Date applied,Location,Work mode,Salary min,Salary max,Currency,Per,Source,Resume,Notes',
  'Acme,Frontend Engineer,https://jobs.example.com/acme/1,Applied,2026-10-12,Berlin,Hybrid,70000,85000,EUR,Year,LinkedIn,Frontend 2026,Panel interview with the design team on Thursday. Ask about the design system.',
  'Globex,Software Engineer II,https://jobs.example.com/globex/2,Screening,2026-10-13,,Remote,,,,,Indeed,Frontend 2026',
  'Initech,Full-stack Developer,https://jobs.example.com/initech/3,Applied,2026-10-14,"Austin, TX",On-site,,,,,Company site,Backend v3',
  'Hooli,Senior Web Engineer,https://jobs.example.com/hooli/4,Applied,2026-10-15,Mountain View,Hybrid,,,,,Referral,Frontend 2026',
  'Stark Industries,UI Engineer,https://jobs.example.com/stark/5,Offer,2026-09-24,New York,Hybrid,,,,,Recruiter,Design systems',
  'Umbrella Health,React Developer,https://jobs.example.com/umbrella/6,Rejected,2026-10-02,London,Remote,,,,,LinkedIn,Frontend 2026',
  'Wayne Enterprises,Frontend Developer,https://jobs.example.com/wayne/7,Interviewing,2026-09-28,Chicago,On-site,,,,,Indeed,Frontend 2026',
  'Soylent,Web Developer,https://jobs.example.com/soylent/8,Saved,,Remote,Remote,,,,,LinkedIn,',
  'Vandelay,Frontend Engineer,https://jobs.example.com/vandelay/9,Applied,2026-10-06,Toronto,Hybrid,,,,,Wellfound,Frontend 2026',
].join('\r\n');

async function settle(page: Page) {
  await page.waitForTimeout(400);
  await page.evaluate(() =>
    Promise.race([
      Promise.allSettled(document.getAnimations().map((a) => a.finished)),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]),
  );
}

/** The panel as it is now, at its real size, for the composite. */
async function panelShot(page: Page, name: string) {
  await settle(page);
  const file = path.join(WORK, `${name}-panel.png`);
  await page.screenshot({ path: file });
  return file;
}

const fontFace = `@font-face { font-family: Geist; src: url('file://${FONT}') format('woff2'); font-weight: 100 900; }`;

/** A 1280×800 screenshot: a caption on the left, the panel docked on the right. */
async function compose(
  session: ExtensionSession,
  name: string,
  panel: string,
  caption: { title: string; text: string },
  aside = '',
) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    ${fontFace}
    * { box-sizing: border-box; }
    body { margin: 0; width: 1280px; height: 800px; overflow: hidden; font-family: Geist, system-ui;
      background: linear-gradient(135deg, #eff6ff 0%, #f8fafc 55%, #e0e7ff 100%); color: #09090b;
      display: flex; align-items: center; }
    .copy { flex: 1; padding: 0 72px 0 88px; display: flex; flex-direction: column; gap: 20px; }
    .brand { display: flex; align-items: center; gap: 12px; font-weight: 600; font-size: 22px; }
    .brand svg { width: 40px; height: 40px; }
    h1 { margin: 0; font-size: 48px; line-height: 1.1; letter-spacing: -0.02em; font-weight: 650; text-wrap: balance; }
    p { margin: 0; font-size: 22px; line-height: 1.45; color: #3f3f46; max-width: 560px; text-wrap: pretty; }
    .panel { width: ${PANEL.width}px; height: ${PANEL.height}px; margin-right: 72px; border-radius: 14px;
      overflow: hidden; box-shadow: 0 24px 60px rgba(15, 23, 42, .18), 0 0 0 1px rgba(15, 23, 42, .08);
      background: #fff; }
    .panel img { display: block; width: 100%; height: 100%; }
    ${aside ? '.copy { gap: 24px; }' : ''}
  </style></head><body>
    <div class="copy">
      <div class="brand">${ICON}<span>Huntlog</span></div>
      <h1>${caption.title}</h1>
      <p>${caption.text}</p>
      ${aside}
    </div>
    <div class="panel"><img src="file://${panel}"></div>
  </body></html>`;
  const file = path.join(WORK, `${name}.html`);
  fs.writeFileSync(file, html);
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`file://${file}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(OUT, 'screenshots', `${name}.png`) });
  await page.close();
}

// The right-click menu, drawn (Playwright can't open Chrome's own), as on a posting.
const CONTEXT_MENU = `<div style="align-self: flex-start; margin-top: 8px; width: 300px; border-radius: 8px;
  background: #fff; box-shadow: 0 8px 24px rgba(15,23,42,.16), 0 0 0 1px rgba(15,23,42,.08);
  padding: 6px 0; font-size: 15px; color: #27272a;">
  <div style="padding: 7px 16px;">Back</div>
  <div style="padding: 7px 16px;">Reload</div>
  <div style="height: 1px; background: #e4e4e7; margin: 6px 0;"></div>
  <div style="padding: 7px 16px; background: #eff6ff; display: flex; align-items: center; gap: 10px;">
    <span style="width: 16px; height: 16px; display: inline-flex;">${ICON.replace('<svg ', '<svg width="16" height="16" ')}</span>
    Add job to Huntlog</div>
  <div style="padding: 7px 16px;">Inspect</div>
</div>`;

test('store screenshots and promo tile', async ({ session }) => {
  fs.mkdirSync(path.join(OUT, 'screenshots'), { recursive: true });
  fs.mkdirSync(WORK, { recursive: true });
  const page = await session.context.newPage();
  await page.clock.setFixedTime(NOW);
  await page.setViewportSize(PANEL);
  await page.goto(panelUrl(session.extensionId));

  // Sample data: three resumes, then the applications from a spreadsheet, linked by name.
  await page.getByRole('tab', { name: 'Resumes' }).click();
  for (const name of ['Design systems', 'Backend v3', 'Frontend 2026']) {
    await uploadResume(page, { name: `${name}.pdf`, mimeType: 'application/pdf', buffer: PDF });
  }
  await page.getByRole('tab', { name: 'Applications' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('switch', { name: 'Set a weekly goal' }).click();
  await settings.getByLabel('Applications per week').fill('5');
  await settings.getByLabel('Applications per week').press('Enter');
  await settings.getByRole('button', { name: 'Import' }).click();
  const importing = page.getByRole('dialog', { name: 'Import' });
  await importing.getByLabel('File to import').setInputFiles({
    name: 'applications.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(CSV),
  });
  await importing.getByRole('button', { name: 'Import 9 applications' }).click();
  await expect(importing).toBeHidden();
  await page.keyboard.press('Escape');
  await sheetsClosed(page);
  // Acme moves on through the stages, so its timeline has a story.
  await pickStatus(page, 'Acme', 'Screening');
  await sheetsClosed(page);
  await pickStatus(page, 'Acme', 'Interviewing');
  await sheetsClosed(page);
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0, { timeout: 10_000 });
  await page.reload();

  // 1. The list.
  await compose(session, '1-list', await panelShot(page, 'list'), {
    title: 'Every application, beside the posting',
    text: 'Huntlog lives in Chrome’s side panel. Change a status with one tap, search, and filter by status, date or source.',
  });

  // 2. A capture: the form fills itself in from the posting.
  const windowId = await page.evaluate(async () => (await chrome.windows.getCurrent()).id!);
  await session.serviceWorker.evaluate(
    ([key, value]) => chrome.storage.session.set({ [key]: value }),
    [
      draftKey(windowId),
      createDraft(
        'page',
        {
          url: 'https://jobs.example.com/northwind/10',
          title: 'Senior Frontend Engineer',
          company: 'Northwind',
          location: 'Amsterdam',
          workMode: 'hybrid',
          salary: { min: 75000, max: 90000, currency: 'EUR', period: 'year' },
        },
        NOW,
      ),
    ] as const,
  );
  await expect(page.getByRole('dialog', { name: 'Add application' })).toBeVisible();
  await compose(
    session,
    '2-capture',
    await panelShot(page, 'capture'),
    {
      title: 'Right-click a job. It fills itself in.',
      text: 'Company, title, location, work mode and salary come from the posting. Check them, pick the resume you sent, and save.',
    },
    CONTEXT_MENU,
  );
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await sheetsClosed(page);

  // 3. One application's story.
  await page.getByRole('button', { name: 'Acme, Frontend Engineer' }).click();
  const editDate = async (status: string, date: string) => {
    await page.getByRole('button', { name: `Change the date for ${status}` }).click();
    await page.getByLabel(`${status} date`, { exact: true }).fill(date);
    await page.getByRole('button', { name: `Save the date for ${status}` }).click();
  };
  await editDate('Screening', '2026-10-14');
  await editDate('Interviewing', '2026-10-15');
  await page.locator('[data-tab-panel][data-active]').evaluate((element) => element.scrollTo(0, 0));
  await compose(session, '3-detail', await panelShot(page, 'detail'), {
    title: 'Every stage, on a timeline',
    text: 'See when you applied, heard back and interviewed, which resume you sent, and your notes, all in one place.',
  });
  await page.getByRole('button', { name: 'Back to applications' }).click();

  // 4. Stats.
  await page.getByRole('tab', { name: 'Stats' }).click();
  await page.getByRole('radio', { name: 'This month' }).click();
  await compose(session, '4-stats', await panelShot(page, 'stats'), {
    title: 'Your week, your rates, your goal',
    text: 'This week against your goal, your response and interview rates, and where every application stands.',
  });

  // 5. Resumes.
  await page.getByRole('tab', { name: 'Resumes' }).click();
  await compose(session, '5-resumes', await panelShot(page, 'resumes'), {
    title: 'Know which resume you sent',
    text: 'Keep every version of your resume and link one to each application. Everything stays on your device.',
  });

  // The small promo tile, 440×280.
  const tile = await session.context.newPage();
  await tile.setViewportSize({ width: 440, height: 280 });
  const tileFile = path.join(WORK, 'promo-tile.html');
  fs.writeFileSync(
    tileFile,
    `<!doctype html><html><head><meta charset="utf-8"><style>
      ${fontFace}
      body { margin: 0; width: 440px; height: 280px; overflow: hidden; font-family: Geist, system-ui;
        background: linear-gradient(135deg, #1d4ed8 0%, #2563eb 60%, #3b82f6 100%); color: #fff;
        display: flex; flex-direction: column; justify-content: center; padding: 0 40px; box-sizing: border-box; gap: 14px; }
      .brand { display: flex; align-items: center; gap: 14px; font-size: 40px; font-weight: 650; letter-spacing: -0.02em; }
      .brand svg { width: 64px; height: 64px; padding: 4px; border-radius: 20px; background: #fff; box-shadow: 0 6px 18px rgba(0,0,0,.2); }
      p { margin: 0; font-size: 20px; line-height: 1.35; color: #dbeafe; }
    </style></head><body>
      <div class="brand">${ICON}<span>Huntlog</span></div>
      <p>Track your job applications, right beside the posting. Private: nothing leaves your device.</p>
    </body></html>`,
  );
  await tile.goto(`file://${tileFile}`);
  await tile.evaluate(() => document.fonts.ready);
  await tile.screenshot({ path: path.join(OUT, 'promo-tile.png') });
});
