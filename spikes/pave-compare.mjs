/**
 * Screenshots `apps/lab/pave-compare/`: real pavé geometry against a shader-painted fake, at five
 * angles through a spin.
 *
 *   npm run dev -w @klieg/lab -- --port 5192 --strictPort --host '::'
 *   node spikes/pave-compare.mjs [letter] [out.png]
 */
import { chromium } from 'playwright-core';

const letter = process.argv[2] ?? 'R';
const out = process.argv[3] ?? `pave-compare-${letter}.png`;
const url = `http://localhost:5192/pave-compare/#${encodeURIComponent(letter)}`;

// The full chromium build on Metal: headless-shell rasterizes WebGL in software, and transmission
// is exactly the pass a software rasterizer gets wrong.
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1380, height: 1000 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log(`  [error] ${e.message}`));
page.on('console', (m) => m.type() === 'error' && console.log(`  [page] ${m.text()}`));

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.DONE === true, null, { timeout: 180_000 });
console.log(await page.textContent('#status'));
await page.screenshot({ path: out, fullPage: true });
console.log(out);
await browser.close();
