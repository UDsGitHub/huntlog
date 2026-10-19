import fs from 'node:fs';
import path from 'node:path';
import { publicPrivacyPage } from '../scripts/privacyPage';
import config from '../wxt.config';

// The privacy policy ships in the extension (Settings → About) and is published with GitHub
// Pages for the store listing (spec §8). The published page is generated from the bundled one.
const root = path.resolve(import.meta.dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file));
const bundledHtml = read('entrypoints/privacy/index.html').toString('utf8');
const permissions = (config.manifest as { permissions: string[] }).permissions;

/** How the policy names each permission (spec §8). */
const PERMISSION_LABELS: Record<string, string> = {
  sidePanel: 'Side panel',
  storage: 'Storage',
  unlimitedStorage: 'unlimited storage',
  contextMenus: 'Context menus',
  activeTab: 'Active tab',
  scripting: 'scripting',
};

/** The text of a page's <main>, as a reader sees it (tags dropped, spaces collapsed). */
function policyText(html: string) {
  const main = new DOMParser().parseFromString(html, 'text/html').querySelector('main');
  return main?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

describe('privacy policy', () => {
  const bundled = policyText(bundledHtml);

  it('is published as generated from the bundled page (node scripts/build-privacy-page.ts)', () => {
    expect(read('docs/privacy/index.html').toString('utf8')).toBe(publicPrivacyPage(bundledHtml));
    expect(read('docs/privacy/icon.png').equals(read('public/icon/128.png'))).toBe(true);
  });

  it('is final: no draft note, a date and a contact', () => {
    expect(bundled.length).toBeGreaterThan(500);
    expect(bundled).not.toMatch(/draft|placeholder/i);
    expect(bundled).toMatch(/Effective \w+ \d{1,2}, \d{4}/);
    expect(bundled).toContain('dingding8003@gmail.com');
  });

  it('names every permission the manifest asks for', () => {
    for (const permission of permissions) {
      expect(PERMISSION_LABELS, `a label for ${permission}`).toHaveProperty(permission);
      expect(bundled).toContain(PERMISSION_LABELS[permission]);
    }
  });
});
