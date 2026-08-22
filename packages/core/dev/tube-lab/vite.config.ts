import { defineConfig } from 'vite';

// 5181 so this and apps/lab (5180) can run side by side, which is the point of a second lab.
export default defineConfig({
  server: { port: 5181 },
});
