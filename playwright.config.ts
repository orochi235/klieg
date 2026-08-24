import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './apps/lab/test',
  // Narrowed from the default so the vitest specs alongside these are not picked up as browser tests.
  testMatch: '**/*.spec.ts',
  // Reusing a server in CI can serve stale code from a previous run's leftover process.
  webServer: {
    command: 'npm run dev -w @klieg/lab',
    port: 5180,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:5180',
    // The specs read the whole drawing buffer back every frame; a modest 1x buffer keeps that
    // cheap enough to stay in step with the render loop.
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
  },
});
