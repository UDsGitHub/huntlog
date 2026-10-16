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
    description: 'Track the job applications you submit.',
    permissions: ['sidePanel', 'storage'],
    action: {
      default_title: 'Open Job Log',
    },
  },
});
