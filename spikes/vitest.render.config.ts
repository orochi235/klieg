import { defineConfig } from 'vitest/config';

/** Spikes are outside the repo's own include glob; this is how a render script gets run. */
export default defineConfig({
  test: { include: ['spikes/**/*.test.ts'], testTimeout: 120_000 },
});
