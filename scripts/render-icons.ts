// Renders assets/icon.svg to the toolbar and store icon sizes in public/icon/, using the
// Chromium Playwright already installs. Run: node scripts/render-icons.ts
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (name: string) => fs.readFileSync(path.join(ROOT, 'assets', name), 'utf8');
// 16px: a simpler drawing (no ticks), so the toolbar icon stays sharp. 128px: the store wants
// 96px of artwork inside 16px of transparent padding.
const SIZES = [
  { size: 16, svg: read('icon-16.svg'), padding: 0 },
  { size: 32, svg: read('icon.svg'), padding: 0 },
  { size: 48, svg: read('icon.svg'), padding: 0 },
  { size: 128, svg: read('icon.svg'), padding: 16 },
];
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const { size, svg, padding } of SIZES) {
    const inner = size - 2 * padding;
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<body style="margin:0;padding:${padding}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" style="display:block" `)}</body>`,
    );
    await page.screenshot({
      path: path.join(ROOT, `public/icon/${size}.png`),
      omitBackground: true,
    });
  }
  // The store's icon field (it takes no SVG) and the published privacy page use the 128px one.
  const store = path.join(ROOT, 'public/icon/128.png');
  fs.copyFileSync(store, path.join(ROOT, 'docs/store/icon-128.png'));
  fs.copyFileSync(store, path.join(ROOT, 'docs/privacy/icon.png'));
} finally {
  await browser.close();
}
