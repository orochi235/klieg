/**
 * Which capitals does the triangulator draw as the wrong letter?
 *
 *   npm run build -w klieg && node spikes/glyph-fidelity.mjs [--faces a,b] [--chars ABC]
 *
 * Ground truth is the font's own fill: the outline flattened and filled by the non-zero winding
 * rule, which is what a text renderer does. Against it, `glyphToShapes` plus three's earcut, which
 * cannot union overlapping contours. Both are rasterised on the same grid and compared as a
 * symmetric difference over the union, so a letter that comes out a different shape scores high
 * whichever direction it errs in.
 *
 * `--mode extruded` measures the built geometry instead, and its numbers are not comparable: the
 * bevel stands the silhouette off the outline by `bevelSize` all round, which on a letter-sized
 * glyph is 40% of the area before anything is wrong. Use it to compare letters within one face,
 * never against zero.
 */
import { readdirSync, readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import * as THREE from 'three';
import { DEFAULT_GLYPH_OPTIONS, buildGlyphGeometry, glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const FONT_DIR = new URL('../apps/lab/public/fonts/', import.meta.url);
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const CHARS = arg('chars', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
const N = Number(arg('grid', 256));
const faceArg = arg('faces', null);
const MODE = arg('mode', 'flat');
const faces = readdirSync(FONT_DIR)
  .filter((f) => f.endsWith('.ttf'))
  .filter((f) => !faceArg || faceArg.split(',').some((w) => f.includes(w)));

const CURVE = 24;
/** The font's outline as flat rings, in three's y-up space — the same negation `contoursOf` does. */
function rings(font, char, size) {
  const path = font.charToGlyph(char).getPath(0, 0, size);
  const out = [];
  let ring = null;
  let cx = 0;
  let cy = 0;
  const push = (x, y) => {
    ring?.push([x, y]);
    cx = x;
    cy = y;
  };
  for (const c of path.commands) {
    if (c.type === 'M') {
      ring = [];
      out.push(ring);
      push(c.x, -c.y);
    } else if (c.type === 'L') push(c.x, -c.y);
    else if (c.type === 'Q') {
      const [x0, y0] = [cx, cy];
      for (let i = 1; i <= CURVE; i++) {
        const t = i / CURVE;
        const u = 1 - t;
        push(u * u * x0 + 2 * u * t * c.x1 + t * t * c.x, u * u * y0 + 2 * u * t * -c.y1 + t * t * -c.y);
      }
    } else if (c.type === 'C') {
      const [x0, y0] = [cx, cy];
      for (let i = 1; i <= CURVE; i++) {
        const t = i / CURVE;
        const u = 1 - t;
        push(
          u * u * u * x0 + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          u * u * u * y0 + 3 * u * u * t * -c.y1 + 3 * u * t * t * -c.y2 + t * t * t * -c.y,
        );
      }
    }
  }
  return out.filter((r) => r.length >= 3);
}

function fillNonZero(polys, box, grid) {
  const mask = new Uint8Array(grid * grid);
  const { x0, y0, w, h } = box;
  for (let row = 0; row < grid; row++) {
    const y = y0 + ((row + 0.5) / grid) * h;
    const xs = [];
    for (const ring of polys) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, ay] = ring[i];
        const [bx, by] = ring[j];
        if (ay > y !== by > y) {
          xs.push({ x: ((bx - ax) * (y - ay)) / (by - ay) + ax, dir: by > ay ? 1 : -1 });
        }
      }
    }
    xs.sort((a, b) => a.x - b.x);
    let wind = 0;
    for (let k = 0; k < xs.length - 1; k++) {
      wind += xs[k].dir;
      if (wind === 0) continue;
      const from = Math.ceil(((xs[k].x - x0) / w) * grid - 0.5);
      const to = Math.floor(((xs[k + 1].x - x0) / w) * grid - 0.5);
      for (let col = Math.max(0, from); col <= Math.min(grid - 1, to); col++) mask[row * grid + col] = 1;
    }
  }
  return mask;
}

function fillTriangles(geo, box, grid) {
  const mask = new Uint8Array(grid * grid);
  const pos = geo.getAttribute('position');
  const idx = geo.getIndex();
  const { x0, y0, w, h } = box;
  const count = idx ? idx.count : pos.count;
  for (let t = 0; t < count; t += 3) {
    const p = [0, 1, 2].map((k) => {
      const i = idx ? idx.getX(t + k) : t + k;
      return [pos.getX(i), pos.getY(i)];
    });
    const minY = Math.min(...p.map((q) => q[1]));
    const maxY = Math.max(...p.map((q) => q[1]));
    const r0 = Math.max(0, Math.ceil(((minY - y0) / h) * grid - 0.5));
    const r1 = Math.min(grid - 1, Math.floor(((maxY - y0) / h) * grid - 0.5));
    for (let row = r0; row <= r1; row++) {
      const y = y0 + ((row + 0.5) / grid) * h;
      const xs = [];
      for (let i = 0, j = 2; i < 3; j = i++) {
        const [ax, ay] = p[i];
        const [bx, by] = p[j];
        if (ay > y !== by > y) xs.push(((bx - ax) * (y - ay)) / (by - ay) + ax);
      }
      if (xs.length < 2) continue;
      const lo = Math.min(...xs);
      const hi = Math.max(...xs);
      const c0 = Math.max(0, Math.ceil(((lo - x0) / w) * grid - 0.5));
      const c1 = Math.min(grid - 1, Math.floor(((hi - x0) / w) * grid - 0.5));
      for (let col = c0; col <= c1; col++) mask[row * grid + col] = 1;
    }
  }
  return mask;
}

const results = [];
for (const file of faces) {
  const buf = readFileSync(new URL(file, FONT_DIR));
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const name = file.replace(/\.ttf$/, '');
  for (const ch of CHARS) {
    const polys = rings(font, ch, 1);
    if (!polys.length) continue;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const r of polys)
      for (const [x, y] of r) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    const pad = 0.02;
    const box = { x0: x0 - pad, y0: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
    const truth = fillNonZero(polys, box, N);
    const shapes = glyphToShapes(font, ch, 1);
    const geo = MODE === 'flat' ? new THREE.ShapeGeometry(shapes, 24) : buildGlyphGeometry(font, ch, 1, DEFAULT_GLYPH_OPTIONS);
    const drawn = fillTriangles(geo, box, N);
    let both = 0;
    let either = 0;
    let missing = 0;
    let extra = 0;
    for (let i = 0; i < truth.length; i++) {
      const a = truth[i];
      const b = drawn[i];
      if (a || b) either++;
      if (a && b) both++;
      if (a && !b) missing++;
      if (!a && b) extra++;
    }
    const err = either ? 1 - both / either : 0;
    results.push({ name, ch, err, missing: missing / (either || 1), extra: extra / (either || 1), contours: polys.length, shapes: shapes.length });
    if (err > 0.02)
      console.log(`  ${name.padEnd(16)} ${ch}  err ${(err * 100).toFixed(1)}%  missing ${(100 * missing / either).toFixed(1)}%  extra ${(100 * extra / either).toFixed(1)}%  (${polys.length} contours -> ${shapes.length} shapes)`);
  }
  const worst = results.filter((r) => r.name === name).sort((a, b) => b.err - a.err);
  console.log(`${name.padEnd(16)} worst ${worst[0].ch} ${(worst[0].err * 100).toFixed(1)}%   over 2%: ${worst.filter((r) => r.err > 0.02).length}/${worst.length}`);
}
