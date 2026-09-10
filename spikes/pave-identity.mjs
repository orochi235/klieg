/**
 * A fingerprint of everything a pave cut hands the shell — every pocket and every rim-bead ring —
 * so two builds can be proven to produce the same geometry rather than merely the same count.
 *
 *   npm run build -w klieg && node spikes/pave-identity.mjs [letter]
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { cutterFor } from '../packages/core/dist/render/wells/cutters.js';
import { regionOf } from '../packages/core/dist/render/wells/region.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const LETTER = process.argv[2] ?? 'R';
const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const spec = specOf('pave').decoration;
const shapes = glyphToShapes(font, LETTER, 1);
const cut = cutterFor(spec.cutter)(shapes, regionOf(shapes, spec.insets), spec);

const hash = createHash('sha256');
let points = 0;
const feed = (path) => {
  for (const p of path.getPoints(1)) {
    hash.update(`${p.x.toFixed(9)},${p.y.toFixed(9)};`);
    points++;
  }
  hash.update('|');
};
for (const well of cut.wells) feed(well);
const bead = cut.bead?.([0, spec.rimBevel ?? 0.003, (spec.rimBevel ?? 0.003) + (spec.rimDrop ?? 0.003)]) ?? [];
for (const rings of bead) for (const ring of rings) feed(ring);

console.log(`'${LETTER}': ${cut.wells.length} wells, ${points} points, ${hash.digest('hex').slice(0, 16)}`);
