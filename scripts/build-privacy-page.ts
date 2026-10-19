// Writes the public privacy policy (docs/privacy/) from the bundled page, with the store-size
// icon beside it. Run after editing entrypoints/privacy/index.html or the icon:
// node scripts/build-privacy-page.ts
import fs from 'node:fs';
import path from 'node:path';
import { publicPrivacyPage } from './privacyPage.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const out = path.join(ROOT, 'docs/privacy');
fs.mkdirSync(out, { recursive: true });
const bundled = fs.readFileSync(path.join(ROOT, 'entrypoints/privacy/index.html'), 'utf8');
fs.writeFileSync(path.join(out, 'index.html'), publicPrivacyPage(bundled));
fs.copyFileSync(path.join(ROOT, 'public/icon/128.png'), path.join(out, 'icon.png'));
