/**
 * What a chamfer does to a letter's stroke ratios.
 *
 *   npm run build -w klieg && node spikes/stroke-widths.mjs [--letter R] [--outer 0.038]
 *
 * A uniform inset takes the same absolute amount off both sides of every stroke, so a thin stroke
 * loses a larger fraction of itself than a thick one and the letter's own contrast is exaggerated.
 * This reads the half-widths off the distance field's ridge — a ridge point sits equidistant from
 * both sides of its stroke, so its value is that stroke's half-width — and prints what the top face
 * is left with.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import { signedDistanceField } from '../packages/core/dist/render/tube/field.js';
import { DEFAULT_GLYPH_OPTIONS, chamfered, glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
};

const LETTER = arg('letter', 'R');
const OUTER = Number(arg('outer', String(DEFAULT_GLYPH_OPTIONS.bevelSize)));
const RES = Number(arg('resolution', '1024'));

const buf = readFileSync(resolve(ROOT, 'apps/lab/public/font.ttf'));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const shapes = chamfered(glyphToShapes(font, LETTER, 1), DEFAULT_GLYPH_OPTIONS);

const rings = [];
for (const shape of shapes) {
  rings.push(shape.getPoints(48).map((p) => ({ x: p.x, y: p.y })));
  for (const hole of shape.holes) rings.push(hole.getPoints(48).map((p) => ({ x: p.x, y: p.y })));
}
const field = signedDistanceField(rings, { resolution: RES, pad: 0.05 });
const { data, size, emPerCell } = field;
const at = (ix, iy) => data[iy * size + ix];

// Which sign the metal is on: the glyph's own centre of mass is inside it.
let sx = 0;
let sy = 0;
let n = 0;
for (const ring of rings) {
  for (const p of ring) {
    sx += p.x;
    sy += p.y;
    n++;
  }
}
const SIGN = Math.sign(field.sample(sx / n, sy / n)) || 1;
const depth = (ix, iy) => SIGN * at(ix, iy);

/**
 * Ridge cells: a local maximum of the depth in its 8 neighbours. Ties are broken by index so a flat
 * ridge — every stroke of constant width has one — reports one cell per run rather than none.
 */
const peaks = [];
for (let iy = 1; iy < size - 1; iy++) {
  for (let ix = 1; ix < size - 1; ix++) {
    const d = depth(ix, iy);
    if (d <= emPerCell) continue;
    let best = true;
    for (let dy = -1; dy <= 1 && best; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const o = depth(ix + dx, iy + dy);
        if (o > d || (o === d && (dy < 0 || (dy === 0 && dx < 0)))) {
          best = false;
          break;
        }
      }
    }
    if (best) peaks.push(d);
  }
}
peaks.sort((a, b) => a - b);

/** Peaks within a cell of each other are the same stroke seen along its length. */
const groups = [];
for (const d of peaks) {
  const last = groups.at(-1);
  if (last && d - last.at(-1) <= 2.5 * emPerCell) last.push(d);
  else groups.push([d]);
}
const strokes = groups
  .filter((g) => g.length >= 3)
  .map((g) => ({ half: g[Math.floor(g.length / 2)], cells: g.length }))
  .sort((a, b) => a.half - b.half);

console.log(`"${LETTER}" at ${RES}², chamfer ${OUTER} em taken off each side`);
console.log('  half-width   width    top face   kept');
for (const { half } of strokes) {
  const left = 2 * (half - OUTER);
  const kept = left > 0 ? `${((100 * left) / (2 * half)).toFixed(0)}%` : 'eaten';
  console.log(
    `  ${half.toFixed(4)}      ${(2 * half).toFixed(4)}   ${Math.max(0, left).toFixed(4)}     ${kept}`,
  );
}
const thin = strokes[0];
const thick = strokes.at(-1);
if (thin && thick && thin !== thick) {
  const before = thick.half / thin.half;
  const after = (thick.half - OUTER) / (thin.half - OUTER);
  console.log(
    `  contrast thick:thin ${before.toFixed(2)} on the glyph, ` +
      `${after > 0 ? after.toFixed(2) : '∞'} on the top face`,
  );
}
