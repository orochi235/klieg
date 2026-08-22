/**
 * How far a corner keeps turning past the stretch detection collapses it to.
 *
 *   npm run build -w klieg && node spikes/shoulder-census.mjs [look] [letters]
 *
 * Detection groups only the vertices bending tighter than the threshold, so a corner's anchors can
 * land inside its own shoulder — the fillet is then tangent to a line the path has already left.
 * For every hard corner this prints the detected width against the width two candidate rules would
 * take, and the turn each leaves outside the group. `PATH_SOURCE` overrides the look's own source.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import {
  cornersByBend,
  minBendRadius,
  STYLE_FACTOR,
  vertexBends,
} from '../packages/core/dist/render/tube/bend.js';
import { generatePaths } from '../packages/core/dist/render/tube/generators.js';
import { surfacesOf } from '../packages/core/dist/render/tube/surfaces.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const LOOK = process.argv[2] ?? 'piping';
const spec = specOf(LOOK).decoration;
const SOURCE = process.env.PATH_SOURCE ?? spec.pathSource ?? 'direct';
const LETTERS = process.argv[3] ?? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const rhoMin = minBendRadius(spec.radius, spec.bend);
const detect = Math.max(rhoMin, spec.radius * STYLE_FACTOR);
const deg = (rad) => (rad * 180) / Math.PI;

/** Widen a group outward while the rule still calls a vertex part of the same turn. */
function widen(bends, lo, hi, keep) {
  let a = lo;
  let b = hi;
  while (bends.has(a - 1) && keep(bends.get(a - 1))) a--;
  while (bends.has(b + 1) && keep(bends.get(b + 1))) b++;
  return [a, b];
}

const RULES = [
  ['rho<1.5x', (v) => v.rho < detect * 1.5],
  ['rho<2x', (v) => v.rho < detect * 2],
  ['turn>=5deg', (v) => deg(v.turn) >= 5],
];

const totals = new Map(RULES.map(([name]) => [name, { extra: 0, outside: 0 }]));
let hard = 0;
for (const ch of LETTERS) {
  const paths = generatePaths(surfacesOf(glyphToShapes(font, ch, 1), 0.3), spec.surfaces, {
    level: spec.level,
    spacing: spec.spacing,
    wallDepth: 0.5,
    resolution: 256,
    pad: 0.35,
    source: SOURCE,
  });
  let perLetter = 0;
  for (const path of paths) {
    const bends = new Map(vertexBends(path.points, path.closed).map((b) => [b.index, b]));
    for (const corner of cornersByBend(path.points, path.closed, rhoMin, spec.radius * STYLE_FACTOR)) {
      if (!corner.hard) continue;
      hard++;
      perLetter++;
      const lo = corner.index - corner.groupBefore;
      const hi = corner.index + corner.groupAfter;
      for (const [name, keep] of RULES) {
        const [a, b] = widen(bends, lo, hi, keep);
        const t = totals.get(name);
        t.extra += b - a - (hi - lo);
        // Turn the detected group leaves outside itself, which is what the leg fit reads as straight.
        let outside = 0;
        for (let i = a; i <= b; i++) if (i < lo || i > hi) outside += deg(bends.get(i)?.turn ?? 0);
        t.outside += outside;
      }
    }
  }
  console.log(`${ch}: ${perLetter} hard corners`);
}

console.log(`\n${LOOK}/${SOURCE}: ${hard} hard corners, detected at ${(detect / spec.radius).toFixed(2)}r`);
for (const [name, t] of totals) {
  console.log(
    `  ${name.padEnd(11)} widens by ${(t.extra / hard).toFixed(2)} vertices/corner, ` +
      `capturing ${(t.outside / hard).toFixed(1)} deg/corner the group misses`,
  );
}
