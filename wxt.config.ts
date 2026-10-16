import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// Permissions are fixed by spec §8 and grow only per milestone. Adding one is a product decision.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'Job Log',
    // sidePanel API landed in 114, setPanelBehavior in 116.
    minimum_chrome_version: '116',
    permissions: [
      'sidePanel',
      'storage',
      'unlimitedStorage',
      'contextMenus',
      'activeTab',
      'scripting',
    ],
    action: {
      default_title: 'Open Job Log',
    },
    commands: {
      'add-job': {
        suggested_key: { default: 'Alt+Shift+J' },
        description: 'Add the current page to Job Log',
      },
    },
  },
});
