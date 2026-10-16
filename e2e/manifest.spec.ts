import fs from 'node:fs';
import path from 'node:path';
import { EXTENSION_PATH, expect, test } from './fixtures';

// Guards DoD #4: the production manifest matches spec §8 for this milestone, with no creep.
test('production manifest has only the M1 permissions', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_PATH, 'manifest.json'), 'utf8'));
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.minimum_chrome_version).toBe('116');
  expect([...manifest.permissions].sort()).toEqual([
    'activeTab',
    'contextMenus',
    'scripting',
    'sidePanel',
    'storage',
  ]);
  expect(manifest.host_permissions).toBeUndefined();
  expect(manifest.optional_permissions).toBeUndefined();
  expect(manifest.optional_host_permissions).toBeUndefined();
  expect(manifest.content_scripts).toBeUndefined();
  expect(manifest.side_panel?.default_path).toBe('sidepanel.html');
  expect(manifest.action).toBeDefined();
  expect(manifest.commands).toEqual({
    'add-job': {
      suggested_key: { default: 'Alt+Shift+J' },
      description: 'Add the current page to Job Log',
    },
  });
  expect(manifest.web_accessible_resources).toBeUndefined();
  expect(manifest.externally_connectable).toBeUndefined();
});
