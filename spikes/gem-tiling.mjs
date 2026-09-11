/**
 * The `tile` cutter drawn top down, one letter at a time, with what it cost.
 *
 *   npm run build -w klieg && node spikes/gem-tiling.mjs [word] [--pitch 0.055] [--wall 0.009]
 *     [--bezel 0.012] [--rim 0.003] [--show R] [--out dir]
 *
 * Each pocket is drawn filled, its rim ring — the pocket at the widest bead growth, which is what
 * the face is cut to — as an outline, and the letter's own outline behind both. A pocket that
 * reaches the letter's edge, or a rim that crosses it, is visible here before a shell is built.
 * `spikes/well-cost.mjs` is the measurement of a whole letter; this is the cutter alone.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import playwright from '@playwright/test';
import { cutterFor } from '../packages/core/dist/render/wells/cutters.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const { chromium } = playwright;

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const WORD = process.argv[2]?.startsWith('--') ? 'FUCK YOU TRAVIS' : (process.argv[2] ?? 'FUCK YOU TRAVIS');
const SPEC = {
  kind: 'well',
  cutter: 'tile',
  pitch: Number(arg('pitch', '0.055')),
  wall: Number(arg('wall', '0.009')),
  bezel: Number(arg('bezel', '0.012')),
  floor: 0.09,
  size: 0.048,
  look: {},
};
const RIM = Number(arg('rim', '0.003'));
const OUT = resolve(arg('out', resolve(HERE, 'gem-tiling-out')));

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const f1 = (n, w) => n.toFixed(1).padStart(w);
const pad = (n, w) => String(n).padStart(w);

const chars = [...new Set([...WORD].filter((c) => c.trim()))];
console.log(`word "${WORD}": ${[...WORD].filter((c) => c.trim()).length} letters, ${chars.length} distinct`);
console.log(`pitch ${SPEC.pitch}  wall ${SPEC.wall}  bezel ${SPEC.bezel}  rim ${RIM}\n`);
console.log('  n/N  ch      cut     bead  pockets');

const cut = cutterFor('tile');
let cutTotal = 0;
let beadTotal = 0;
const drawn = new Map();
for (const [i, char] of chars.entries()) {
  const shapes = glyphToShapes(font, char, 1);
  const t0 = performance.now();
  const result = cut(shapes, null, SPEC);
  const t1 = performance.now();
  const rims = result.bead([RIM, 0]);
  const t2 = performance.now();
  cutTotal += t1 - t0;
  beadTotal += t2 - t1;
  drawn.set(char, { shapes, result, rims });
  console.log(
    `${pad(`${i + 1}/${chars.length}`, 5)}  ${char.padEnd(2)} ${f1(t1 - t0, 8)} ${f1(t2 - t1, 8)}  ${pad(result.wells.length, 7)}`,
  );
}
console.log(`\ntotal     ${f1(cutTotal, 8)} ${f1(beadTotal, 8)}ms`);

const SHOW = arg('show', chars[0]);
const shown = drawn.get(SHOW);
if (shown) {
  const outline = shown.shapes.flatMap((s) => [s.getPoints(48), ...s.holes.map((h) => h.getPoints(48))]);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of outline) {
    for (const p of ring) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  const scale = 900 / Math.max(maxX - minX, maxY - minY);
  const w = (maxX - minX) * scale + 80;
  const h = (maxY - minY) * scale + 80;
  const px = (p) => `${((p.x - minX) * scale + 40).toFixed(2)},${((maxY - p.y) * scale + 40).toFixed(2)}`;
  const poly = (points) => `<polygon points="${points.map(px).join(' ')}" />`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="100%" height="100%" fill="#0b0d12"/>
<path fill="#c9a227" fill-rule="evenodd" d="${outline.map((r) => `M${r.map(px).join('L')}Z`).join('')}"/>
<g fill="#3b6fe0">${shown.result.wells.map((well) => poly(well.getPoints())).join('')}</g>
<g fill="none" stroke="#9fc0ff" stroke-width="0.8">${shown.rims.map((steps) => poly(steps[0].getPoints())).join('')}</g>
</svg>`;
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: Math.ceil(w), height: Math.ceil(h) } });
  await page.setContent(svg);
  const pngFile = resolve(OUT, `tiling-${SHOW}.png`);
  writeFileSync(pngFile, await page.screenshot());
  await browser.close();
  console.log(`wrote ${pngFile}  (${shown.result.wells.length} pockets)`);
}
