/**
 * What brings back a face's small counters under `tubing`:
 *
 *   node spikes/counter-runs.mjs BAR [font.otf]
 *
 * Builds each glyph twice per variant, once with holes and once without, and reports the runs and
 * arc length the counters account for. A `holeRuns` of 0 or less means the counters drew nothing.
 * Reads the built package, so `npm run build -w klieg` first.
 *
 * Measured on Vegapunk over BARO. Which counters survive is per glyph, not per face: `O`'s large
 * counter draws at every setting including the shipped one, while `B`, `A` and `R` draw nothing
 * there. No `rejoin` value moves any of them, and neither a lower `bend` nor a smaller `radius`
 * alone recovers one -- it takes both. `radius 0.012 + bend 1.25` brings back `B` only; `0.008 +
 * bend 1.25` is the first variant that draws all four.
 *
 * `counter-box.mjs` reports every one of these counters as wider than the tube, so width is not
 * what defeats them -- the bend radius at the turn is.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { buildTubeBlueprint } from '../packages/core/dist/render/tube/index.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const letters = process.argv[2] ?? 'BAR';
const fontRel = process.argv[3] ?? 'apps/lab/public/fonts/vegapunk.otf';
const buf = readFileSync(new URL('../' + fontRel, import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const base = specOf('tubing').decoration;

const build = (ch, spec, strip) => {
  const shapes = glyphToShapes(font, ch, 1);
  if (strip) for (const s of shapes) s.holes = [];
  const bp = buildTubeBlueprint(shapes, spec, 0.3, 0);
  const out = { n: bp.runs.length, sum: bp.runs.reduce((a, r) => a + r.length, 0) };
  bp.dispose();
  return out;
};

const variants = [
  ['base (shipped)', {}],
  ['rejoin relax', { rejoin: 'relax' }],
  ['rejoin bridge', { rejoin: 'bridge' }],
  ['rejoin widen', { rejoin: 'widen' }],
  ['bend 1.25', { bend: 1.25 }],
  ['radius 0.012', { radius: 0.012 }],
  ['radius 0.012 + bend 1.25', { radius: 0.012, bend: 1.25 }],
  ['radius 0.008 + bend 1.25', { radius: 0.008, bend: 1.25 }],
];

for (const ch of letters) {
  console.log(`\n  '${ch}'   (minBend = radius x bend)`);
  console.log(`  ${'variant'.padEnd(26)} ${'runs'.padStart(5)} ${'holeRuns'.padStart(9)} ${'holeLen'.padStart(8)}`);
  for (const [name, over] of variants) {
    const spec = { ...base, ...over };
    const all = build(ch, spec, false);
    const outerOnly = build(ch, spec, true);
    const holeRuns = all.n - outerOnly.n;
    const holeLen = all.sum - outerOnly.sum;
    console.log(
      `  ${name.padEnd(26)} ${String(all.n).padStart(5)} ${String(holeRuns).padStart(9)} ${holeLen.toFixed(3).padStart(8)}` +
        (holeRuns > 0 ? '  <- counters drawn' : ''),
    );
  }
}
