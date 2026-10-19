import fs from 'node:fs';
import path from 'node:path';
import config from '../wxt.config';

// docs/store/listing.md is pasted into the Chrome Web Store dashboard (spec §8). It must match
// what the package really asks for and says.
const listing = fs.readFileSync(
  path.resolve(import.meta.dirname, '../docs/store/listing.md'),
  'utf8',
);
const manifest = config.manifest as { description: string; permissions: string[] };

describe('store listing', () => {
  it("uses the manifest's description as its summary, within the store's 132 characters", () => {
    expect(manifest.description.length).toBeLessThanOrEqual(132);
    expect(listing).toContain(`> ${manifest.description}`);
  });

  it('justifies exactly the permissions the manifest asks for', () => {
    const justified = [...listing.matchAll(/^\| `(\w+)` \|/gm)].map((match) => match[1]);
    expect(justified.sort()).toEqual([...manifest.permissions].sort());
  });

  it('points at the published privacy policy and the contact email', () => {
    expect(listing).toContain('https://udsgithub.github.io/job-log/privacy/');
    expect(listing).toContain('dingding8003@gmail.com');
  });

  it('has its images at the store’s sizes, as 24-bit PNGs without alpha', () => {
    const store = path.resolve(import.meta.dirname, '../docs/store');
    const images = [
      ...fs.readdirSync(path.join(store, 'screenshots')).map((name) => `screenshots/${name}`),
      'promo-tile.png',
    ];
    expect(images.filter((name) => name.startsWith('screenshots/'))).toHaveLength(5);
    for (const name of images) {
      const png = fs.readFileSync(path.join(store, name));
      // The IHDR chunk: width, height, bit depth, color type (2 is RGB).
      const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
      expect([width, height, png[24], png[25]], name).toEqual(
        name === 'promo-tile.png' ? [440, 280, 8, 2] : [1280, 800, 8, 2],
      );
      expect(listing, name).toContain(name.replace('screenshots/', ''));
    }
  });
});
