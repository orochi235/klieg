/**
 * Does raising `count` still add sequins, or has the field saturated?
 *
 *   npm run build -w klieg && node spikes/sequin-coverage.mjs [--letter R] [--counts 130,260,520]
 *
 * A render diff cannot answer this: `poolFor` derives the sample pool from `count`, so a changed
 * count reseeds the whole arrangement and the diff measures rearrangement. Coverage can. Every
 * chunk's disc is transformed by its own instance matrix, projected on z the way the camera sees
 * it, and rasterised into one mask over the glyph — so overlap counts once, which is the whole
 * point. The denominator is the glyph's own filled area.
 *
 * Two numbers, and they say different things: the share of the letter's own area that has a disc on
 * it, and the total the field paints — which passes 100% once the discs spill past the silhouette,
 * because they stand proud of it.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import * as THREE from 'three';
import {
  buildChunkBlueprint,
  chunkGeometry,
  chunkInstances,
  poolFor,
} from '../packages/core/dist/render/decoration.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { DEFAULT_GLYPH_OPTIONS, buildGlyphGeometry } from '../packages/core/dist/text/glyphs.js';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const LETTERS = arg('letters', 'RKO');
const COUNTS = arg('counts', '65,130,260,520,1040,2080').split(',').map(Number);
const GRID = Number(arg('grid', 512));
const FONT = arg('font', 'font');

const base = specOf('sequin').decoration;
if (base?.kind !== 'chunks') throw new Error('sequin has no chunk decoration');
const url =
  FONT === 'font'
    ? new URL('../apps/lab/public/font.ttf', import.meta.url)
    : new URL(`../apps/lab/public/fonts/${FONT}.ttf`, import.meta.url);
const buf = readFileSync(url);
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

/** The chunk's own outline at unit size, which its matrix scales and turns. */
function outline(shape) {
  const geo = chunkGeometry(shape);
  const pos = geo.getAttribute('position');
  const ring = [];
  const seen = new Set();
  for (let i = 0; i < pos.count; i++) {
    const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    const key = `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ring.push(p);
  }
  geo.dispose();
  // Round the ring, so the polygon walks its rim rather than zig-zagging across the fan.
  return ring.sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
}

function fillPolygon(mask, poly, box, grid) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const r0 = Math.max(0, Math.ceil(((minY - box.y0) / box.h) * grid - 0.5));
  const r1 = Math.min(grid - 1, Math.floor(((maxY - box.y0) / box.h) * grid - 0.5));
  for (let row = r0; row <= r1; row++) {
    const y = box.y0 + ((row + 0.5) / grid) * box.h;
    const xs = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > y !== b.y > y) xs.push(((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x);
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(((xs[k] - box.x0) / box.w) * grid - 0.5));
      const c1 = Math.min(grid - 1, Math.floor(((xs[k + 1] - box.x0) / box.w) * grid - 0.5));
      for (let col = c0; col <= c1; col++) mask[row * grid + col] = 1;
    }
  }
}

const ring = outline(base.shape);
console.log(`sequin coverage on ${LETTERS}, grid ${GRID}\n`);
console.log('  letter  count   painted   on the letter   discs   per disc');

for (const letter of LETTERS) {
  const glyph = buildGlyphGeometry(font, letter, 1, DEFAULT_GLYPH_OPTIONS);
  glyph.computeBoundingBox();
  const bb = glyph.boundingBox;
  const box = {
    x0: bb.min.x,
    y0: bb.min.y,
    w: Math.max(bb.max.x - bb.min.x, 1e-6),
    h: Math.max(bb.max.y - bb.min.y, 1e-6),
  };
  // The letter's own painted area, from the extrusion's front-facing triangles.
  const letterMask = new Uint8Array(GRID * GRID);
  const pos = glyph.getAttribute('position');
  const idx = glyph.getIndex();
  const count = idx ? idx.count : pos.count;
  for (let t = 0; t < count; t += 3) {
    const tri = [0, 1, 2].map((k) => {
      const i = idx ? idx.getX(t + k) : t + k;
      return new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    });
    fillPolygon(letterMask, tri, box, GRID);
  }
  const letterArea = letterMask.reduce((a, b) => a + b, 0);

  for (const n of COUNTS) {
    const spec = { ...base, count: n };
    const blueprint = buildChunkBlueprint(glyph, {
      pool: poolFor(spec),
      faceBias: spec.faceBias,
      bedding: spec.bedding,
    });
    const { matrices } = chunkInstances(blueprint, spec, 3);
    const mask = new Uint8Array(GRID * GRID);
    for (const m of matrices) {
      fillPolygon(
        mask,
        ring.map((p) => p.clone().applyMatrix4(m)),
        box,
        GRID,
      );
    }
    let covered = 0;
    let onLetter = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      covered++;
      if (letterMask[i]) onLetter++;
    }
    const share = covered / letterArea;
    console.log(
      `  ${letter}       ${String(n).padStart(4)}    ${(share * 100).toFixed(1)}%` +
        `      ${((onLetter / letterArea) * 100).toFixed(1)}%` +
        `          ${matrices.length}     ${((share / matrices.length) * 100).toFixed(3)}%`,
    );
  }
  glyph.dispose();
  console.log('');
}
