import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const entry = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The published package resolves to built output; the lab reads the workspace source instead, so
// `dev` needs no prior build.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^klieg$/,
        replacement: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      },
    ],
  },
  // Pages out of one app: the tuning lab at the root, and `show` (the no-chrome demo) and `strip`
  // (the anchored-placement route) one directory down, served from the same artifact.
  build: {
    rollupOptions: {
      input: {
        main: entry('./index.html'),
        show: entry('./show/index.html'),
        strip: entry('./strip/index.html'),
      },
    },
  },
  server: { port: 5180 },
});
