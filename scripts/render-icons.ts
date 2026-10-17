// Renders assets/icon.svg to the toolbar and store icon sizes in public/icon/, using the
// Chromium Playwright already installs. Run: node scripts/render-icons.ts
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(import.meta.dirname, '..');
const svg = fs.readFileSync(path.join(ROOT, 'assets/icon.svg'), 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`,
    );
    await page.screenshot({
      path: path.join(ROOT, `public/icon/${size}.png`),
      omitBackground: true,
    });
  }
} finally {
  await browser.close();
}
