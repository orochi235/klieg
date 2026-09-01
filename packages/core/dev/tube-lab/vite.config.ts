import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// 5181 so this and apps/lab (5180) can run side by side, which is the point of a second lab.
export default defineConfig({
  // Per-lab, because three labs share packages/core/node_modules: one shared dep cache lets
  // whichever server started last invalidate the others, which 504s them into a blank page.
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite-tube-lab', import.meta.url)),
  server: { port: 5181 },
  resolve: {
    alias: { '@core': fileURLToPath(new URL('../../src', import.meta.url)) },
  },
});
