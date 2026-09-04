/**
 * Hollow a letterform out as a stack of levels, and prove the outside stays unbroken.
 *
 *   npm run build -w klieg && node spikes/hollow.mjs [--letter R] [--rim 0.05] [--well 0.16]
 *   node spikes/hollow.mjs --levels 0.05:0.10,0.09:0.06        # a stepped well
 *
 * A level is an outline and a depth. The letter is a stack of layers between their floors: solid
 * below the deepest, and above each floor the letter with that level's outline taken out of it.
 * The drinking glass is the one-level case; concentric wells are the same construction with more.
 *
 * No layer is bevelled. Every layer's outer contour is the glyph's own, at the same x and y, so the
 * outside is one unbroken wall — bevelling the layers separately is what put a ledge down the side.
 * A bevel belongs on the hole, and comes later.
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
/** How deep the hollow goes, in em. The letter keeps the rest of its depth below the floor. */
const WELL = Number(arg('well', '0.16'));
/** Turned off axis so a recess reads as a recess rather than as a darker shade of gold. */
const TILT = Number(arg('tilt', '0.5'));

const D = DEFAULT_GLYPH_OPTIONS.depth;

/**
 * `inset:depth` pairs, outermost first. Each level's outline is the glyph inset by `inset`, and its
 * floor sits `depth` below the floor above it — so a level is a step, not an absolute height.
 */
const LEVELS = arg('levels', `${RIM}:${WELL}`)
  .split(',')
  .filter(Boolean)
  .map((spec) => {
    const [inset, depth] = spec.split(':').map(Number);
    if (!Number.isFinite(inset) || !Number.isFinite(depth)) {
      throw new Error(`--levels wants inset:depth pairs, got '${spec}'`);
    }
    return { inset, depth };
  });
for (let i = 1; i < LEVELS.length; i++) {
  if (LEVELS[i].inset <= LEVELS[i - 1].inset) {
    throw new Error(`level ${i + 1} must sit inside level ${i}: ${LEVELS[i].inset} is not past ${LEVELS[i - 1].inset}`);
  }
}
const TOTAL = LEVELS.reduce((n, l) => n + l.depth, 0);
if (TOTAL >= D) throw new Error(`the levels are ${TOTAL} deep and the letter is only ${D}`);

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

// Every level's outline is an iso-contour of the letter's own distance field. A counter erodes
// outward and the outline inward, and the field knows both — which a ring offset does not.
const rings = [];
for (const shape of shapes) {
  rings.push(shape.getPoints(SEGMENTS).map((p) => ({ x: p.x, y: p.y })));
  for (const hole of shape.holes) {
    rings.push(hole.getPoints(SEGMENTS).map((p) => ({ x: p.x, y: p.y })));
  }
}
const field = signedDistanceField(rings, { resolution: 512, pad: 0.05 });
const outlineAt = (inset) => nest(isoContours(field, -inset).map((r) => xy(r)));

const OUTLINES = LEVELS.map(({ inset }, i) => {
  const poly = outlineAt(inset);
  if (poly.length === 0) throw new Error(`level ${i + 1}'s ${inset} em inset leaves nothing on '${LETTER}'`);
  return poly;
});

/**
 * The floor of each level, measured down from the letter's top face. Descending, so `FLOORS.at(-1)`
 * is the bottom of the deepest well and everything below it is solid letter.
 */
const FLOORS = [];
let running = D;
for (const { depth } of LEVELS) {
  running -= depth;
  FLOORS.push(running);
}

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

const extrude = (multi, depth) =>
  new THREE.ExtrudeGeometry(toShapes(multi), {
    depth,
    curveSegments: DEFAULT_GLYPH_OPTIONS.curveSegments,
    bevelEnabled: false,
  });

/**
 * The stack, bottom up: solid letter below the deepest floor, then one layer per level holding the
 * letter with that level's outline taken out of it. Every layer shares the glyph's outer contour.
 */
const layers = [];
const base = extrude(LETTER_POLY, FLOORS.at(-1));
layers.push({ name: 'base', z: 0, top: FLOORS.at(-1), poly: LETTER_POLY, geo: base });
for (let i = LEVELS.length - 1; i >= 0; i--) {
  const top = i === 0 ? D : FLOORS[i - 1];
  const poly = polygonClipping.difference(LETTER_POLY, OUTLINES[i]);
  const geo = extrude(poly, top - FLOORS[i]);
  geo.translate(0, 0, FLOORS[i]);
  layers.push({ name: `level ${i + 1}`, z: FLOORS[i], top, poly, geo });
}

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
const body = merge(layers.map((l) => l.geo));

/**
 * The ledge check, which a render cannot make: every layer has to still carry the glyph's own outer
 * ring, point for point. A layer whose outline moved by so much as a bevel width steps the outside.
 *
 * Asked of the glyph's points, not of the layer's: subtracting a hollow leaves a second polygon
 * around the counter, whose own outer ring is nowhere near the letter's and never was.
 */
const GLYPH_RING = LETTER_POLY[0][0];
const ledgeOf = (multi) => {
  const pts = multi.flat(2);
  let worst = 0;
  for (const [gx, gy] of GLYPH_RING) {
    let near = Number.POSITIVE_INFINITY;
    for (const [x, y] of pts) near = Math.min(near, Math.hypot(gx - x, gy - y));
    worst = Math.max(worst, near);
  }
  return worst;
};
const ledge = Math.max(...layers.map((l) => ledgeOf(l.poly)));

console.log(`"${LETTER}" — ${LEVELS.length} level(s), ${TOTAL} em of ${D} em hollowed out`);
console.log(`  letter: ${LETTER_POLY.length} polygon(s), ${LETTER_POLY[0].length - 1} counter(s)`);
for (let i = 0; i < LEVELS.length; i++) {
  console.log(
    `  level ${i + 1}: inset ${LEVELS[i].inset}, floor z ${FLOORS[i].toFixed(4)}, ` +
      `${OUTLINES[i].length} region(s), rings ${OUTLINES[i].map((o) => o.length).join('+')}`,
  );
}
for (const l of layers) {
  console.log(
    `  ${l.name.padEnd(8)} z ${l.z.toFixed(4)} → ${l.top.toFixed(4)}, ` +
      `${l.poly.length} polygon(s), ${l.geo.getAttribute('position').count} verts`,
  );
}
console.log(`  body ${body.getAttribute('position').count} verts`);
console.log(
  ledge < 1e-9
    ? '  outer contour: every layer carries the glyph ring point for point — no ledge'
    : `  outer contour: a layer misses the glyph ring by ${ledge.toFixed(5)} em — that is a ledge`,
);

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
const base_ = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
page.on('console', (m) => m.type() === 'error' && console.log(`  [console] ${m.text()}`));
for (const look of arg('looks', 'gold').split(',')) {
  await page.goto(`${base_}/?look=${look}`);
  await page.waitForFunction(() => window.__shot === true, null, { timeout: 120_000 });
  const file = resolve(OUT, `hollow-${LETTER}-${look}.png`);
  writeFileSync(file, await page.screenshot());
  console.log(`  wrote ${file}`);
}
await browser.close();
server.close();
process.exit(0);
