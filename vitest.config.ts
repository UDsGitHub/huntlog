import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'happy-dom',
    globals: true,
    // forks, not threads: lib/dates.test.ts changes process.env.TZ, which only takes effect per process.
    pool: 'forks',
    setupFiles: ['./vitest.setup.ts'],
    include: ['{lib,components,tests}/**/*.test.{ts,tsx}'],
  },
});
