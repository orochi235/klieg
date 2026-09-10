/**
 * What a backdrop costs per frame, at each row count, in a real browser.
 *
 *   npm run dev -w @klieg/lab -- --port 5191 --strictPort --host '::'
 *   node spikes/backdrop-frame-cost.mjs [url] [screenshot.png]
 *
 * `fire-build-cost.mjs` answers what the rows cost to build, in node. This is the other half and
 * cannot be done there: every row is another copy of the part pool, the effect compositor walks
 * every part of it every frame, and the draw is real. The page under measurement is
 * `apps/lab/backdrop-cost/`, driven through `createKlieg` on a `ManualClock` so one `advance` is
 * one whole frame.
 */
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5191/backdrop-cost/';
const shot = process.argv[3] ?? null;

// The full chromium build, not `chrome-headless-shell`: the shell rasterizes WebGL in software,
// which measures swiftshader rather than a GPU. `--use-angle=metal` is what puts it on one here.
const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--use-angle=metal', '--enable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('console', (m) => console.log(`  [page] ${m.text()}`));
page.on('pageerror', (e) => console.log(`  [error] ${e.message}`));

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => 'RESULT' in globalThis, null, { timeout: 600_000 });
const rows = await page.evaluate(() => globalThis.RESULT);

console.log('\nlook     rows  median    p95  worst');
for (const r of rows) {
  console.log(
    `${r.look.padEnd(7)} ${String(r.rows).padStart(4)}  ` +
      `${r.median.toFixed(2).padStart(6)} ${r.p95.toFixed(2).padStart(6)} ` +
      `${r.worst.toFixed(2).padStart(6)}`,
  );
}

if (shot) {
  await page.screenshot({ path: shot, fullPage: true });
  console.log(`\nshot: ${shot}`);
}
await browser.close();
