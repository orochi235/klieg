import { defineConfig } from 'vitest/config';

// Split out of `vitest.config.ts` because these run against `dist/`, which a fresh clone has not
// built. A suite that skipped itself when the artifact was missing would prove nothing.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.dist.test.ts'],
    environment: 'node',
  },
});
