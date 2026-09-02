/**
 * What does cutting wells into a letter cost?
 *
 *   npm run build -w klieg && node spikes/well-cost.mjs [--stones 40] [--word JACKPOT]
 *
 * The wells-and-fills design says to pick a stone pitch against a measurement rather than against
 * a still of one letter, and this is that measurement — taken before any of the pipeline exists,
 * because it does not need it. A well is a hole in the plate, and a hole is a contour on the shape
 * the extruder triangulates; so cutting N of them is just `Shape.holes` with N more rings, and both
 * the vertex count and the build time can be read off today's extruder.
 *
 * Reports per letter, since a word is the sum and the letters differ: an `I` has room for far
 * fewer stones than an `O` and pays proportionally less.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import * as THREE from 'three';
import {
  buildChunkBlueprint,
  chunkInstances,
  poolFor,
} from '../packages/core/dist/render/decoration.js';
import { DEFAULT_GLYPH_OPTIONS, glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const WORD = arg('word', 'JACKPOT');
const STONES = arg('stones', '0,10,20,40,80').split(',').map(Number);
const SEGMENTS = Number(arg('segments', '12'));
const RADIUS = Number(arg('radius', '0.03'));

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

/**
 * Where the stones sit. Reuses the chunk sampler rather than inventing a placement: it already
 * scatters over a glyph's surface with the cap bias a set stone would want, so the wells land where
 * a real one would and the count is honest about clustering.
 */
function seats(shapes, n) {
  if (n === 0) return [];
  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth: DEFAULT_GLYPH_OPTIONS.depth,
    bevelEnabled: false,
  });
  const spec = { kind: 'chunks', count: n, size: RADIUS * 2, shape: 'disc', align: 0, cluster: 0, proud: 0, faceBias: 32, look: {} };
  const blueprint = buildChunkBlueprint(geo, { pool: poolFor(spec), faceBias: spec.faceBias });
  const { matrices } = chunkInstances(blueprint, spec, 0);
  geo.dispose();
  const out = [];
  const at = new THREE.Vector3();
  for (const m of matrices) {
    at.setFromMatrixPosition(m);
    // Front cap only: a well cut into the extrusion band is a different cutter, and the design
    // starts with a hole in a plate.
    if (at.z > DEFAULT_GLYPH_OPTIONS.depth - 1e-3) out.push({ x: at.x, y: at.y });
  }
  return out;
}

/** The same shapes with `n` circular holes added to whichever outline contains each seat. */
function withWells(shapes, seats) {
  const cut = shapes.map((s) => {
    const copy = s.clone();
    copy.holes = s.holes.map((h) => h.clone());
    return copy;
  });
  let placed = 0;
  for (const seat of seats) {
    const host = cut.find((s) => THREE.ShapeUtils.isClockWise(s.getPoints(24)) !== undefined && inside(s, seat));
    if (!host) continue;
    const hole = new THREE.Path();
    hole.absarc(seat.x, seat.y, RADIUS, 0, Math.PI * 2, true);
    host.holes.push(hole);
    placed++;
  }
  return { cut, placed };
}

function inside(shape, point) {
  const poly = shape.getPoints(24);
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      hit = !hit;
    }
  }
  return hit;
}

console.log(`wells at r=${RADIUS} em, ${SEGMENTS}-gon each, over "${WORD}"\n`);
console.log('  asked   seated   vertices   triangles   build ms   per well   no bevel');
const base = { v: 0, t: 0, bare: 0 };
for (const n of STONES) {
  let vertices = 0;
  let triangles = 0;
  let bare = 0;
  let placed = 0;
  const t0 = performance.now();
  for (const ch of WORD) {
    const shapes = glyphToShapes(font, ch, 1);
    const { cut, placed: got } = withWells(shapes, seats(shapes, n));
    placed += got;
    const geo = new THREE.ExtrudeGeometry(cut, {
      ...DEFAULT_GLYPH_OPTIONS,
      bevelEnabled: true,
      bevelOffset: 0,
      curveSegments: SEGMENTS,
    });
    vertices += geo.getAttribute('position').count;
    const index = geo.getIndex();
    triangles += (index ? index.count : geo.getAttribute('position').count) / 3;
    geo.dispose();
    // The same cut without a bevel: a well's own bevel is what seats a stone, so what it costs
    // over a bare hole is the number that decides whether the seat is geometry or a fill's job.
    const flat = new THREE.ExtrudeGeometry(cut, {
      depth: DEFAULT_GLYPH_OPTIONS.depth,
      bevelEnabled: false,
      curveSegments: SEGMENTS,
    });
    bare += flat.getAttribute('position').count;
    flat.dispose();
  }
  const ms = performance.now() - t0;
  if (n === 0) {
    base.v = vertices;
    base.t = triangles;
    base.bare = bare;
  }
  const per = placed > 0 ? (vertices - base.v) / placed : 0;
  const perBare = placed > 0 ? (bare - base.bare) / placed : 0;
  console.log(
    `  ${String(n).padStart(5)}   ${String(placed).padStart(6)}   ${String(vertices).padStart(8)}` +
      `   ${String(triangles).padStart(9)}   ${ms.toFixed(0).padStart(8)}` +
      `   ${per ? `+${per.toFixed(0)}`.padStart(8) : '       —'}   ${perBare ? `+${perBare.toFixed(0)}` : '—'}`,
  );
}
console.log(`\n  asked is per letter; seated is the word's total, and falls short because the`);
console.log('  sampler only takes seats on the front cap.');
console.log(`  baseline is ${base.v} vertices for ${WORD.length} letters, ${base.bare} of them unbevelled.`);
