/**
 * Pulls a full turn of `apps/lab/pave-spin/` frame by frame and cuts it into an MP4 and a strip.
 *
 *   npm run dev -w @klieg/lab -- --port 5192 --strictPort --host '::'
 *   node spikes/pave-spin.mjs <out-dir> [frames] ["TEXT"]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const dir = process.argv[2] ?? 'pave-spin';
const N = Number(process.argv[3] ?? 96);
const text = process.argv[4];
const url = `http://localhost:5192/pave-spin/${text ? `#${encodeURIComponent(text)}` : ''}`;
mkdirSync(dir, { recursive: true });

// The full chromium build on Metal: headless-shell rasterizes WebGL in software.
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log(`  [error] ${e.message}`));

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => 'READY' in globalThis, null, { timeout: 300_000 });
console.log('built:', JSON.stringify(await page.evaluate(() => globalThis.READY)));

for (let k = 0; k < N; k++) {
  const data = await page.evaluate(([i, n]) => globalThis.frame(i, n), [k, N]);
  writeFileSync(join(dir, `f${String(k).padStart(3, '0')}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
  console.log(`${k + 1}/${N}`);
}
await browser.close();

const ff = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
ff('-framerate', '24', '-i', join(dir, 'f%03d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', join(dir, 'spin.mp4'));
// Eight evenly spaced frames, two rows of four, for a wall that shows stills.
const step = Math.max(1, Math.floor(N / 8));
ff('-i', join(dir, 'f%03d.jpg'), '-vf', `select='not(mod(n\\,${step}))',scale=640:-1,tile=4x2`, '-frames:v', '1', join(dir, 'strip.jpg'));
console.log(join(dir, 'spin.mp4'));
console.log(join(dir, 'strip.jpg'));
