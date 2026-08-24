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
  // Two pages out of one app: the tuning lab at the root, and `show` — the no-chrome demo — one
  // directory down, so Pages serves it from the same artifact at /klieg/show/.
  build: {
    rollupOptions: {
      input: { main: entry('./index.html'), show: entry('./show/index.html') },
    },
  },
  server: { port: 5180 },
});
