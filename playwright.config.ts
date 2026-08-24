import { createHash } from 'node:crypto';
import { defineConfig } from '@playwright/test';

// A shared fixed port let one worktree's dev server answer another's run: `reuseExistingServer`
// finds a live port, not the code under test, so the suite silently judged the wrong tree against
// these baselines. Deriving the port from the worktree's own path keeps concurrent runs apart.
const digest = createHash('sha1')
  .update(import.meta.dirname)
  .digest();
const port = 5180 + ((digest[0] ?? 0) % 64);

export default defineConfig({
  testDir: './apps/lab/test',
  // Narrowed from the default so the vitest specs alongside these are not picked up as browser tests.
  testMatch: '**/*.spec.ts',
  webServer: {
    // `--strictPort` so a collision fails loudly rather than sliding to a neighbour's port.
    command: `npm run dev -w @klieg/lab -- --port ${port} --strictPort`,
    port,
    // Reusing a server in CI can serve stale code from a previous run's leftover process.
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: `http://localhost:${port}`,
    // The specs read the whole drawing buffer back every frame; a modest 1x buffer keeps that
    // cheap enough to stay in step with the render loop.
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
  },
});
