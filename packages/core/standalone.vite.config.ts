import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Nothing is external: a script tag has no resolver, so three and opentype.js go in the file.
export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/element.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'klieg-sign.js',
    },
    outDir: 'dist/standalone',
    // `dist` is built by tsc first and this writes inside it.
    emptyOutDir: false,
    rollupOptions: {
      // The element imports `sign()` dynamically so a bundler can split it out. Here that would
      // produce a second file the script tag never fetches.
      output: { inlineDynamicImports: true },
    },
  },
});
