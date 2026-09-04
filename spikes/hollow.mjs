/**
 * Can a letter be hollowed into a shallow dish, with stacked plates and nothing else?
 *
 *   npm run build -w klieg && node spikes/hollow.mjs [--letter R] [--rim 0.05]
 *
 * The smallest possible case of the construction everything else here is built on: a slab, and one
 * plate on top of it with a single hole. No cells, no stones, no fill — if this does not hold,
 * nothing stacked on it can.
 *
 * The plate is not "the letter with the inset as a hole". For a letter with a counter, subtracting
 * the inset leaves TWO rings with holes — a band round the outside and a band round the counter —
 * so it takes a real polygon difference rather than pushing one hole onto one shape.
 *
 * Renders the body alone. A stone standing proud of a plate is visible whether or not a well was
 * ever cut, which is exactly how an uncut plate passed for a cut one.
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import { chromium } from 'playwright';
import polygonClipping from 'polygon-clipping';
import * as THREE from 'three';
import { isoContours, signedDistanceField } from '../packages/core/dist/render/tube/field.js';
import { DEFAULT_GLYPH_OPTIONS, glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const has = (name) => process.argv.includes(`--${name}`);
const LETTER = arg('letter', 'R');
const OUT = resolve(arg('out', resolve(HERE, 'hollow-out')));
/** How wide the wall of the glass is, in em: the letter inset by this is the hollow. */
const RIM = Number(arg('rim', '0.05'));
/** How deep the hollow goes, in em. The slab keeps the rest of the letter's depth. */
const WELL = Number(arg('well', '0.16'));
/** The bevel around the plate's contours. */
const BEVEL = Number(arg('bevel', '0.01'));
/** Turned off axis so a recess reads as a recess rather than as a darker shade of gold. */
const TILT = Number(arg('tilt', '0.5'));

const D = DEFAULT_GLYPH_OPTIONS.depth;

const buf = readFileSync(resolve(ROOT, 'apps/lab/public/font.ttf'));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const shapes = glyphToShapes(font, LETTER, 1);

const SEGMENTS = 48;
const xy = (points) => points.map((p) => [p.x, p.y]);

/** The letter as a multipolygon: one polygon per shape, its counters as holes. */
const LETTER_POLY = shapes.map((shape) => [
  xy(shape.getPoints(SEGMENTS)),
  ...shape.holes.map((h) => xy(h.getPoints(SEGMENTS))),
]);

const inside = (ring, px, py) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a[1] > py !== b[1] > py && px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]) {
      hit = !hit;
    }
  }
  return hit;
};

/** Contours and their holes, by containment depth — `isoContours` answers rings with no nesting. */
function nest(loops) {
  const depth = loops.map((r, i) =>
    loops.reduce((n, other, j) => (i !== j && inside(other, r[0][0], r[0][1]) ? n + 1 : n), 0),
  );
  const parent = loops.map((r, i) => {
    let best = -1;
    for (let j = 0; j < loops.length; j++) {
      if (i === j || !inside(loops[j], r[0][0], r[0][1])) continue;
      if (best === -1 || depth[j] > depth[best]) best = j;
    }
    return best;
  });
  return loops
    .map((loop, i) => ({ loop, i }))
    .filter(({ i }) => depth[i] % 2 === 0)
    .map(({ loop, i }) => [loop, ...loops.filter((_, j) => depth[j] % 2 === 1 && parent[j] === i)]);
}

// The hollow: the letter eroded by the rim, off the distance field the tube pipeline already
// builds. A counter erodes outward and the outline inward, and the field knows both.
const rings = [];
for (const shape of shapes) {
  rings.push(shape.getPoints(SEGMENTS).map((p) => ({ x: p.x, y: p.y })));
  for (const hole of shape.holes) {
    rings.push(hole.getPoints(SEGMENTS).map((p) => ({ x: p.x, y: p.y })));
  }
}
const field = signedDistanceField(rings, { resolution: 512, pad: 0.05 });
const HOLLOW = nest(isoContours(field, -RIM).map((r) => xy(r)));
if (HOLLOW.length === 0) throw new Error(`a ${RIM} em rim leaves no hollow on '${LETTER}'`);

// The plate is what is left of the letter once the hollow is taken out of it.
const PLATE_POLY = polygonClipping.difference(LETTER_POLY, HOLLOW);

/** A multipolygon as `THREE.Shape`s, each with its own holes. */
const toShapes = (multi) =>
  multi.map((poly) => {
    const shape = new THREE.Shape();
    const ring = poly[0];
    shape.moveTo(ring[0][0], ring[0][1]);
    for (const [x, y] of ring.slice(1)) shape.lineTo(x, y);
    shape.closePath();
    shape.holes = poly.slice(1).map((hole) => {
      const path = new THREE.Path();
      path.moveTo(hole[0][0], hole[0][1]);
      for (const [x, y] of hole.slice(1)) path.lineTo(x, y);
      path.closePath();
      return path;
    });
    return shape;
  });

function extrude(polys, depth, bevelSize) {
  const full = DEFAULT_GLYPH_OPTIONS.bevelSize;
  return new THREE.ExtrudeGeometry(polys, {
    depth,
    curveSegments: DEFAULT_GLYPH_OPTIONS.curveSegments,
    bevelEnabled: bevelSize > 0,
    bevelSize,
    bevelThickness: (DEFAULT_GLYPH_OPTIONS.bevelThickness * bevelSize) / full,
    bevelSegments: 3,
    bevelOffset: 0,
  });
}

const slabDepth = Math.max(D - WELL, 0);
const slab = extrude(toShapes(LETTER_POLY), slabDepth, Math.min(DEFAULT_GLYPH_OPTIONS.bevelSize, RIM));
const plate = extrude(toShapes(PLATE_POLY), WELL, BEVEL);
plate.translate(0, 0, slabDepth);

const merge = (parts) => {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal']) {
    const attrs = parts.map((p) => p.getAttribute(name));
    const total = attrs.reduce((n, a) => n + a.array.length, 0);
    const merged = new Float32Array(total);
    let at = 0;
    for (const a of attrs) {
      merged.set(a.array, at);
      at += a.array.length;
    }
    out.setAttribute(name, new THREE.Float32BufferAttribute(merged, 3));
  }
  return out;
};
const body = merge([slab, plate]);

console.log(`"${LETTER}" — rim ${RIM}, well ${WELL} deep`);
console.log(`  letter: ${LETTER_POLY.length} polygon(s), ${LETTER_POLY[0].length - 1} counter(s)`);
console.log(`  hollow: ${HOLLOW.length} region(s), rings ${HOLLOW.map((h) => h.length).join('+')}`);
console.log(
  `  plate:  ${PLATE_POLY.length} polygon(s), rings ${PLATE_POLY.map((p) => p.length).join('+')}`,
);
console.log(`  slab ${slab.getAttribute('position').count} verts, plate ${plate.getAttribute('position').count}`);
console.log(`  floor z ${slabDepth.toFixed(4)}, rim top z ${(slabDepth + WELL).toFixed(4)}`);

const dump = (geo) => ({
  position: [...geo.getAttribute('position').array],
  normal: [...geo.getAttribute('normal').array],
});
const payload = { letter: LETTER, body: dump(body), tilt: TILT };
if (has('no-render')) process.exit(0);

mkdirSync(OUT, { recursive: true });
const TREES = {
  '/klieg/': resolve(ROOT, 'packages/core/dist'),
  '/three/': resolve(ROOT, 'node_modules/three/build'),
};
const FILES = {
  '/': [readFileSync(resolve(HERE, 'hollow.html')), 'text/html'],
  '/geometry.json': [Buffer.from(JSON.stringify(payload)), 'application/json'],
};
const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  const hit = FILES[path];
  if (hit) return res.writeHead(200, { 'content-type': hit[1] }).end(hit[0]);
  for (const [prefix, dir] of Object.entries(TREES)) {
    if (!path.startsWith(prefix)) continue;
    const file = resolve(dir, path.slice(prefix.length));
    if (!file.startsWith(dir)) return res.writeHead(403).end();
    try {
      return res.writeHead(200, { 'content-type': 'text/javascript' }).end(readFileSync(file));
    } catch {
      return res.writeHead(404).end();
    }
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
page.on('console', (m) => m.type() === 'error' && console.log(`  [console] ${m.text()}`));
for (const look of arg('looks', 'gold').split(',')) {
  await page.goto(`${base}/?look=${look}`);
  await page.waitForFunction(() => window.__shot === true, null, { timeout: 120_000 });
  const file = resolve(OUT, `hollow-${LETTER}-${look}.png`);
  writeFileSync(file, await page.screenshot());
  console.log(`  wrote ${file}`);
}
await browser.close();
server.close();
process.exit(0);
