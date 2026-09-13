/**
 * Whether a glyph's counters are wide enough for `tubing`'s tube to fit inside them:
 *
 *   node spikes/counter-box.mjs BAR [font.otf]
 *
 * Prints each counter's bounding box in em beside the tube diameter. Reads the built package, so
 * `npm run build -w klieg` first. Written against Vegapunk, whose small counters vanish when
 * tubed; `counter-runs.mjs` is the follow-up that finds what brings them back.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const fontRel = process.argv[3] ?? 'apps/lab/public/fonts/vegapunk.otf';
const buf = readFileSync(new URL('../' + fontRel, import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const d = specOf('tubing').decoration;
console.log(`tubing: radius ${d.radius}  diameter ${(d.radius * 2).toFixed(4)} em  minBend ${(d.radius * (d.bend ?? 2)).toFixed(4)} em\n`);
console.log(`  ${'glyph/hole'.padEnd(12)} ${'width'.padStart(7)} ${'height'.padStart(7)} ${'fits?'.padStart(6)}`);
for (const ch of process.argv[2] ?? 'BAR') {
  for (const s of glyphToShapes(font, ch, 1)) {
    s.holes.forEach((h, j) => {
      const p = h.getPoints(32);
      const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
      const w = Math.max(...xs) - Math.min(...xs);
      const ht = Math.max(...ys) - Math.min(...ys);
      const fits = Math.min(w, ht) > d.radius * 2;
      console.log(`  ${(ch + ' hole ' + j).padEnd(12)} ${w.toFixed(4).padStart(7)} ${ht.toFixed(4).padStart(7)} ${(fits ? 'yes' : 'NO').padStart(6)}`);
    });
  }
}
