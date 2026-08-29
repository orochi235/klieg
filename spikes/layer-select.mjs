// What a real drag actually paints over the word, plus whether the camera's aspect and the canvas
// box agree. The highlight is painted over each span's inline box, not its glyph ink, so this is
// the only honest picture of what selecting the word looks like.
//   URL=http://localhost:5199/ TEXT=BIG OUT=/tmp/select.png node spikes/layer-select.mjs
import { chromium } from '@playwright/test';

const url = process.env.URL ?? 'http://localhost:5199/';
const out = process.env.OUT ?? '/tmp/layer-select.png';
const text = process.env.TEXT ?? 'BIG';

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({
  viewport: { width: 800, height: 600 },
  deviceScaleFactor: 2,
  reducedMotion: 'no-preference',
});

await page.goto(url, { waitUntil: 'load' });
await page.locator('#enter').selectOption('none');
await page.locator('#active').selectOption('none');
await page.locator('#hold').fill('30000');
await page.locator('#text').fill(text);
await page.locator('#selectable').selectOption('layer');
await page.getByRole('button', { name: 'FIRE', exact: true }).click();
await page.waitForSelector('canvas', { timeout: 15000 });
await page.waitForTimeout(2500);

const geom = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const r = c.getBoundingClientRect();
  return {
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight,
    canvasClientW: c.clientWidth,
    canvasClientH: c.clientHeight,
    canvasRectW: r.width,
    canvasRectH: r.height,
    docEl: document.documentElement.clientWidth,
  };
});
console.log('geometry:', JSON.stringify(geom, null, 2));
console.log(
  `camera aspect source (innerW/innerH) = ${(geom.innerWidth / geom.innerHeight).toFixed(6)}`,
);
console.log(
  `projection box   (clientW/clientH)   = ${(geom.canvasClientW / geom.canvasClientH).toFixed(6)}`,
);
const skew = geom.innerWidth / geom.innerHeight / (geom.canvasClientW / geom.canvasClientH);
console.log(`ASPECT SKEW = ${skew.toFixed(6)}  (1.0 = the two agree)`);

const boxes = await page.evaluate(() =>
  [...document.querySelectorAll('span')]
    .filter((s) => getComputedStyle(s).color === 'rgba(0, 0, 0, 0)' && s.textContent?.trim())
    .map((s) => {
      const r = s.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }),
);
const first = boxes[0];
const last = boxes[boxes.length - 1];
await page.mouse.move(first.left + 2, (first.top + first.bottom) / 2);
await page.mouse.down();
await page.mouse.move(last.right - 2, (last.top + last.bottom) / 2, { steps: 12 });
await page.mouse.up();

console.log(`selected: ${JSON.stringify(await page.evaluate(() => getSelection().toString()))}`);
await page.screenshot({ path: out });
console.log(`wrote ${out}`);
await browser.close();
process.exit(0);
