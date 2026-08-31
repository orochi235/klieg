import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Its own server rather than the lab's: the fixture has to set `framing` per case, and every lab
// route fixes its own. The klieg alias matches the lab's, so this reads workspace source too.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: fileURLToPath(new URL('../../apps/lab/public', import.meta.url)),
  resolve: {
    alias: [
      {
        find: /^klieg$/,
        replacement: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      },
    ],
  },
});
