import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { LABS } from '../shared/pages.js';

export default defineConfig({
  // Per-lab, because the labs share packages/core/node_modules: one shared dep cache lets
  // whichever server started last invalidate the others, which 504s them into a blank page.
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite-tube-gallery', import.meta.url)),
  server: { host: '::', port: LABS['tube-gallery'].port, strictPort: true },
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('../../src', import.meta.url)),
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
});
