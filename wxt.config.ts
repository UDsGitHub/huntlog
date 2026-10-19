import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';
import { ADD_JOB_COMMAND } from './lib/commands';

// Permissions are fixed by spec §8 and grow only per milestone. Adding one is a product decision.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'Huntlog',
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
      default_title: 'Open Huntlog',
    },
    commands: {
      [ADD_JOB_COMMAND]: {
        suggested_key: { default: 'Alt+Shift+J' },
        description: 'Add the current page to Huntlog',
      },
    },
  },
});
