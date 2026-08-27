import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// 5183, so this sits alongside apps/lab (5180), the tube lab (5181) and the corner lab (5182).
export default defineConfig({
  server: { port: 5183 },
  resolve: {
    alias: { '@core': fileURLToPath(new URL('../../src', import.meta.url)) },
  },
});
