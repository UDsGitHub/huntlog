import fs from 'node:fs';
import path from 'node:path';

// The privacy policy ships in the extension (Settings → About) and is published with GitHub
// Pages for the store listing (spec §8). They must say the same thing.
const root = path.resolve(import.meta.dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

/** The text of a page's <main>, as a reader sees it (tags dropped, spaces collapsed). */
function policyText(html: string) {
  const main = new DOMParser().parseFromString(html, 'text/html').querySelector('main');
  return main?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

describe('privacy policy', () => {
  const bundled = policyText(read('entrypoints/privacy/index.html'));
  const published = policyText(read('docs/privacy/index.html'));

  it('is the same in the extension and on the published page', () => {
    expect(bundled.length).toBeGreaterThan(500);
    expect(published).toBe(bundled);
  });

  it('is final: no draft note, a date and a contact', () => {
    expect(bundled).not.toMatch(/draft|placeholder/i);
    expect(bundled).toMatch(/Effective \w+ \d{1,2}, \d{4}/);
    expect(bundled).toContain('dingding8003@gmail.com');
  });

  it('names every permission the manifest asks for', () => {
    for (const name of [
      'Side panel',
      'Storage',
      'unlimited storage',
      'Context menus',
      'Active tab',
      'scripting',
    ]) {
      expect(bundled).toContain(name);
    }
  });
});
