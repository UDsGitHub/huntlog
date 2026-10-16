import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Local-first: the extension must never talk to the network (CLAUDE.md, spec §8).
const networkBan = {
  'no-restricted-globals': [
    'error',
    { name: 'fetch', message: 'No network calls: Job Log is local-only.' },
    { name: 'XMLHttpRequest', message: 'No network calls: Job Log is local-only.' },
    { name: 'WebSocket', message: 'No network calls: Job Log is local-only.' },
    { name: 'EventSource', message: 'No network calls: Job Log is local-only.' },
  ],
  'no-restricted-properties': [
    'error',
    { object: 'window', property: 'fetch', message: 'No network calls: Job Log is local-only.' },
    {
      object: 'globalThis',
      property: 'fetch',
      message: 'No network calls: Job Log is local-only.',
    },
    {
      object: 'navigator',
      property: 'sendBeacon',
      message: 'No network calls: Job Log is local-only.',
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      '.output/',
      '.wxt/',
      'node_modules/',
      'coverage/',
      'playwright-report/',
      'test-results/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['e2e/**'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...networkBan,
    },
  },
  {
    files: ['e2e/**', '*.config.{ts,js}'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-restricted-globals': 'off', 'no-restricted-properties': 'off' },
  },
);
