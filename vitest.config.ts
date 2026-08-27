import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // App tests import `klieg` by package name, which resolves to built output that need not exist.
  resolve: {
    alias: [
      {
        find: /^klieg$/,
        replacement: fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      },
      // The dev labs resolve core through `@core/*`, so a test importing a lab module has to
      // resolve it the same way vite does.
      {
        find: /^@core\//,
        replacement: fileURLToPath(new URL('./packages/core/src/', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
  },
});
