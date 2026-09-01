import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// 5182, so kliegsminister sits alongside apps/lab (5180) and the tube lab (5181).
export default defineConfig({
  // Per-lab, because three labs share packages/core/node_modules: one shared dep cache lets
  // whichever server started last invalidate the others, which 504s them into a blank page.
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite-kliegsminister', import.meta.url)),
  server: { port: 5182 },
  resolve: {
    alias: { '@core': fileURLToPath(new URL('../../src', import.meta.url)) },
  },
});
