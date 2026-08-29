import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // App tests import `klieg` by package name, which resolves to built output that need not exist.
  resolve: {
    alias: [
      {
        find: /^klieg\/sign$/,
        replacement: fileURLToPath(new URL('./packages/core/src/sign/index.ts', import.meta.url)),
      },
      {
        find: /^klieg\/element$/,
        replacement: fileURLToPath(new URL('./packages/core/src/element.ts', import.meta.url)),
      },
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
    // `*.dist.test.ts` runs against built output; `vitest.dist.config.ts` owns it.
    exclude: [...configDefaults.exclude, '**/*.dist.test.ts'],
    environment: 'node',
  },
});
