// Answers: can a live fire() be seeked by rebuilding and jumping straight to T, or does that
// land somewhere different from playing to T at 60fps? Run from the repo root with a vite
// server up:  npx vite --port 5199   then   node spikes/seek-rebuild/run.mjs
import { chromium } from '@playwright/test';

const PORT = process.env.PORT ?? 5199;
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 520, height: 340 }, reducedMotion: 'no-preference' });
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto(`http://localhost:${PORT}/spikes/seek-rebuild/index.html`, { waitUntil: 'load' });
try {
  await p.waitForFunction(() => document.title === 'done', null, { timeout: 240000 });
} catch {
  console.log('TIMED OUT');
}
console.log(await p.evaluate(() => globalThis.SEEK_RESULT ?? '(no result)'));
await b.close();
process.exit(0);
