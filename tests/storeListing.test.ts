import fs from 'node:fs';
import path from 'node:path';
import { ADD_JOB_COMMAND } from '../lib/commands';
import config from '../wxt.config';

// docs/store/listing.md is pasted into the Chrome Web Store dashboard (spec §8). It must match
// what the package really asks for and says.
const listing = fs.readFileSync(
  path.resolve(import.meta.dirname, '../docs/store/listing.md'),
  'utf8',
);
const manifest = config.manifest as {
  description: string;
  permissions: string[];
  commands: Record<string, { suggested_key: { default: string } }>;
};
const spec = fs.readFileSync(path.resolve(import.meta.dirname, '../spec.md'), 'utf8');

describe('store listing', () => {
  it("uses the manifest's description as its summary, within the store's 132 characters", () => {
    expect(manifest.description.length).toBeLessThanOrEqual(132);
    expect(listing).toContain(`> ${manifest.description}`);
  });

  it('justifies exactly the permissions the manifest asks for', () => {
    const justified = [...listing.matchAll(/^\| `(\w+)` \|/gm)].map((match) => match[1]);
    expect(justified.sort()).toEqual([...manifest.permissions].sort());
  });

  it('states the single purpose exactly as spec §8 does', () => {
    const statement = /\*\*Single purpose statement:\*\* "(.+?)"/.exec(spec)?.[1];
    expect(statement).toBeDefined();
    expect(listing).toContain(`> ${statement}`);
  });

  it('advertises the shortcut the manifest suggests', () => {
    const shortcut = manifest.commands[ADD_JOB_COMMAND]!.suggested_key.default;
    expect(listing).toContain(`press ${shortcut}`);
  });

  it('points at the published privacy policy and the contact email', () => {
    expect(listing).toContain('https://udsgithub.github.io/huntlog/privacy/');
    expect(listing).toContain('dingding8003@gmail.com');
  });

  it('has its images at the store’s sizes, as 24-bit PNGs without alpha', () => {
    const store = path.resolve(import.meta.dirname, '../docs/store');
    const images = [
      ...fs
        .readdirSync(path.join(store, 'screenshots'))
        // Only the images: Finder leaves .DS_Store files behind.
        .filter((name) => name.endsWith('.png'))
        .map((name) => `screenshots/${name}`),
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

  it("has the store icon as a 128×128 PNG, the extension's own", () => {
    const root = path.resolve(import.meta.dirname, '..');
    const icon = fs.readFileSync(path.join(root, 'docs/store/icon-128.png'));
    expect([icon.readUInt32BE(16), icon.readUInt32BE(20)]).toEqual([128, 128]);
    // scripts/render-icons.ts writes both.
    expect(icon.equals(fs.readFileSync(path.join(root, 'public/icon/128.png')))).toBe(true);
    expect(listing).toContain('icon-128.png');
  });
});
