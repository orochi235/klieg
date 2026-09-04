/**
 * How many holes can one extruded contour carry before they stop being cut?
 *
 *   node spikes/hole-wall.mjs [--letter R] [--counts 1,8,16,...] [--bevel 0]
 *
 * `pave.mjs` past ~69 wells extrudes as a solid slab and loses the letter's own counter with them.
 * This punches N synthetic holes into the same construction and reads the answer off the geometry
 * rather than off a render: the front cap's own area. A cut plate's cap is the outline minus the
 * holes; an uncut one's is the whole outline, whatever the stones standing on it look like.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import * as THREE from 'three';
import { signedDistanceField } from '../packages/core/dist/render/tube/field.js';
import { DEFAULT_GLYPH_OPTIONS, glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const LETTER = arg('letter', 'R');
const BEVEL = Number(arg('bevel', '0'));
const PITCH = Number(arg('pitch', '0.055'));
/** Hole radius as a fraction of the pitch — well under half, so no two holes ever touch. */
const FRAC = Number(arg('frac', '0.34'));
const SIDES = Number(arg('sides', '6'));
const DEPTH = 0.16;

const buf = readFileSync(resolve(ROOT, 'apps/lab/public/font.ttf'));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const shapes = glyphToShapes(font, LETTER, 1);

const rings = [];
for (const shape of shapes) {
  rings.push(shape.getPoints(32).map((p) => ({ x: p.x, y: p.y })));
  for (const hole of shape.holes) rings.push(hole.getPoints(32).map((p) => ({ x: p.x, y: p.y })));
}
const field = signedDistanceField(rings, { resolution: 512, pad: 0.05 });
const depthAt = (x, y) => {
  const { data, size, emPerCell, originX, originY } = field;
  const gx = Math.min(Math.max((x - originX) / emPerCell, 0), size - 1.0001);
  const gy = Math.min(Math.max((y - originY) / emPerCell, 0), size - 1.0001);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const d00 = data[y0 * size + x0];
  const d10 = data[y0 * size + x0 + 1];
  const d01 = data[(y0 + 1) * size + x0];
  const d11 = data[(y0 + 1) * size + x0 + 1];
  return (d00 * (1 - fx) + d10 * fx) * (1 - fy) + (d01 * (1 - fx) + d11 * fx) * fy;
};

const box = new THREE.Box2();
for (const shape of shapes) for (const p of shape.getPoints(32)) box.expandByPoint(p);

/** Hex-lattice hole centres well inside the letter, in scan order so N and N+1 share N holes. */
const R = PITCH * FRAC;
const centres = [];
const rowStep = PITCH * (Math.sqrt(3) / 2);
for (let r = 0; r * rowStep + box.min.y <= box.max.y; r++) {
  const y = box.min.y + r * rowStep;
  const stagger = r % 2 ? PITCH / 2 : 0;
  for (let x = box.min.x + stagger; x <= box.max.x; x += PITCH) {
    if (depthAt(x, y) < -(R + PITCH * 0.12)) centres.push([x, y]);
  }
}

const hexAt = ([cx, cy]) =>
  Array.from({ length: SIDES }, (_, k) => {
    const a = (2 * Math.PI * k) / SIDES;
    return [cx + R * Math.cos(a), cy + R * Math.sin(a)];
  });

const ringArea = (pts) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  }
  return a / 2;
};

/** The outer contour and its counters, exactly as `hollow.mjs` hands them to the extruder. */
const baseShapes = shapes.map((s) => {
  const copy = s.clone();
  copy.holes = s.holes.map((h) => h.clone());
  return copy;
});

const HOST = 0;
const outerArea = Math.abs(ringArea(baseShapes[HOST].getPoints(32)));
const counterArea = baseShapes[HOST].holes.reduce((n, h) => n + Math.abs(ringArea(h.getPoints(32))), 0);
const holeArea = Math.PI === 0 ? 0 : Math.abs(ringArea(hexAt([0, 0]).map(([x, y]) => ({ x, y }))));

/** Area of every triangle sitting on the front cap plane. */
function capArea(geo, z) {
  const p = geo.getAttribute('position').array;
  let a = 0;
  let tris = 0;
  for (let i = 0; i < p.length; i += 9) {
    if (Math.abs(p[i + 2] - z) > 1e-6 || Math.abs(p[i + 5] - z) > 1e-6 || Math.abs(p[i + 8] - z) > 1e-6) continue;
    a += Math.abs(
      ((p[i + 3] - p[i]) * (p[i + 7] - p[i + 1]) - (p[i + 6] - p[i]) * (p[i + 4] - p[i + 1])) / 2,
    );
    tris++;
  }
  return { a, tris };
}

const counts = arg('counts', '0,1,8,16,23,32,40,48,56,64,69,80,100,140')
  .split(',')
  .map(Number)
  .filter((n) => n <= centres.length);

const bevelZ = BEVEL > 0 ? (DEFAULT_GLYPH_OPTIONS.bevelThickness * BEVEL) / DEFAULT_GLYPH_OPTIONS.bevelSize : 0;
console.log(
  `"${LETTER}" — ${centres.length} lattice sites, hole r ${R.toFixed(4)} (${holeArea.toFixed(5)} em2 each), bevel ${BEVEL}`,
);
console.log(`  outer ${outerArea.toFixed(4)} em2, ${baseShapes[HOST].holes.length} counter(s) ${counterArea.toFixed(4)} em2`);
console.log('    N   verts     cap area    expected    cut   counters');

for (const n of counts) {
  const shape = baseShapes[HOST].clone();
  shape.holes = baseShapes[HOST].holes.map((h) => h.clone());
  for (const c of centres.slice(0, n)) {
    const path = new THREE.Path();
    const pts = hexAt(c);
    path.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) path.lineTo(x, y);
    path.closePath();
    shape.holes.push(path);
  }
  const geo = new THREE.ExtrudeGeometry([shape], {
    depth: DEPTH,
    curveSegments: DEFAULT_GLYPH_OPTIONS.curveSegments,
    bevelEnabled: BEVEL > 0,
    bevelSize: BEVEL,
    bevelThickness: bevelZ,
    bevelSegments: 3,
    bevelOffset: 0,
  });
  const { a, tris } = capArea(geo, DEPTH + bevelZ);
  const expect = outerArea - counterArea - n * holeArea;
  const cut = (outerArea - counterArea - a) / (holeArea || 1);
  console.log(
    `  ${String(n).padStart(4)}  ${String(geo.getAttribute('position').count).padStart(6)}  ` +
      `${a.toFixed(5).padStart(9)}   ${expect.toFixed(5).padStart(9)}  ${cut.toFixed(1).padStart(5)}   ` +
      `${a < outerArea - counterArea * 0.5 ? 'yes' : 'NO'}   ${tris} cap tris`,
  );
}
