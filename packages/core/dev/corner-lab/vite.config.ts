import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// 5182, so this sits alongside apps/lab (5180) and the tube lab (5181).
export default defineConfig({
  server: { port: 5182 },
  resolve: {
    alias: { '@core': fileURLToPath(new URL('../../src', import.meta.url)) },
  },
});
