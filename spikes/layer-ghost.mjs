// Paints the selectable layer's own glyphs over the render they are meant to sit on, so the
// mismatch is visible as shape against shape rather than a box around a letter. The layer's spans
// carry real text in the real face; only their colour is transparent, so tinting them in place is
// exactly what a selection highlight reveals.
//   URL=http://localhost:5199/ TEXT=BIG OUT=/tmp/ghost.png node spikes/layer-ghost.mjs
import { chromium } from '@playwright/test';

const url = process.env.URL ?? 'http://localhost:5199/';
const out = process.env.OUT ?? '/tmp/layer-ghost.png';
const text = process.env.TEXT ?? 'BIG';
const tint = process.env.TINT ?? 'rgba(255,45,85,0.85)';

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({
  viewport: { width: 800, height: 600 },
  deviceScaleFactor: 2,
  reducedMotion: 'no-preference',
});

await page.goto(url, { waitUntil: 'load' });
await page.locator('#enter').selectOption('none');
await page.locator('#active').selectOption('none');
await page.locator('#hold').fill('20000');
await page.locator('#text').fill(text);
await page.locator('#selectable').selectOption('layer');
await page.getByRole('button', { name: 'FIRE', exact: true }).click();
await page.waitForSelector('canvas', { timeout: 15000 });
await page.waitForTimeout(2500);

const report = await page.evaluate((colour) => {
  const spans = [...document.querySelectorAll('span')].filter(
    (s) => getComputedStyle(s).color === 'rgba(0, 0, 0, 0)' && s.textContent?.trim(),
  );
  const rows = [];
  for (const s of spans) {
    const cs = getComputedStyle(s);
    rows.push({ char: s.textContent, font: cs.fontSize, family: cs.fontFamily, left: cs.left, top: cs.top });
    s.style.color = colour;
  }
  return rows;
}, tint);

for (const [i, r] of report.entries())
  console.log(`${i + 1}/${report.length} '${r.char}'  ${r.font} ${r.family}  left=${r.left} top=${r.top}`);

await page.screenshot({ path: out });
console.log(`wrote ${out}`);
await browser.close();
process.exit(0);
