import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const entry = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The published package resolves to built output; the lab reads the workspace source instead, so
// `dev` needs no prior build.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^klieg\/element$/,
        replacement: fileURLToPath(new URL('../../packages/core/src/element.ts', import.meta.url)),
      },
      {
        find: /^klieg\/sign$/,
        replacement: fileURLToPath(
          new URL('../../packages/core/src/sign/index.ts', import.meta.url),
        ),
      },
      {
        find: /^klieg$/,
        replacement: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      },
    ],
  },
  // Pages out of one app: the tuning lab at the root, and `show` (the no-chrome demo), `strip`
  // (the anchored-placement route) and `sign` (the custom element) one directory down, served
  // from the same artifact.
  build: {
    rollupOptions: {
      input: {
        main: entry('./index.html'),
        show: entry('./show/index.html'),
        strip: entry('./strip/index.html'),
        sign: entry('./sign/index.html'),
      },
    },
  },
  server: { port: 5180 },
});
