/**
 * Does a plate stacked on a slab still read as one letter, and does a hole in it read as a well?
 *
 *   npm run build -w klieg && node spikes/plate-stack.mjs [--letter R] [--out dir]
 *
 * The wells-and-fills design cuts recesses without CSG by extruding the glyph twice: a full-depth
 * slab, and a shallower plate carrying the well outlines as `Shape.holes`. Nothing in the tree has
 * ever built that stack, and one detail decides the slice — `ExtrudeGeometry` bevels both ends of
 * every contour, outer and hole alike, from one setting. So the plate's back bevel and the slab's
 * front bevel meet along the letter's whole silhouette, and the bevel that seats a stone cannot be
 * asked for without also asking for that seam.
 *
 * Renders the control beside three stacks and reports each one's vertices.
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import { chromium } from 'playwright';
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
const OUT = resolve(arg('out', resolve(HERE, 'plate-stack-out')));
/** How much of the letter's depth the plate takes; the slab keeps the rest. */
const PLATE = Number(arg('plate', '0.09'));
/** The bezel: how far in from the outline a well may start, in em. */
const MARGIN = Number(arg('margin', '0.05'));
/** Lattice pitch and each diamond's half-diagonal, in em. */
const PITCH = Number(arg('pitch', '0.1'));
const HALF = Number(arg('half', '0.032'));
const RESOLUTION = Number(arg('resolution', '256'));
/**
 * The slab's own bevel, which is not the glyph default. A bevelled extrusion's front cap only
 * covers the shape inset by `bevelSize`, and ramps down by `bevelThickness` over that width — so
 * the slab's front face, which is every well's floor, is flat only further in than this. It is a
 * knob rather than a constant because in a stack the plate carries the letter's front bevel and
 * the slab's front bevel is buried; all it still does is decide the minimum bezel.
 */
const SLAB_BEVEL = Number(arg('slab-bevel', String(DEFAULT_GLYPH_OPTIONS.bevelSize)));
const D = DEFAULT_GLYPH_OPTIONS.depth;

const buf = readFileSync(resolve(ROOT, 'apps/lab/public/font.ttf'));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

/**
 * The region is a predicate, not a polygon. Inside is negative, so "at least `m` in from every
 * contour" is one sample — no contour offset needed, and counters are handled by the same test
 * because the field already counts them as boundary.
 */
function regionOf(letterShapes) {
  const polygons = [];
  for (const shape of letterShapes) {
    polygons.push(shape.getPoints(64).map((p) => ({ x: p.x, y: p.y })));
    for (const hole of shape.holes) {
      polygons.push(hole.getPoints(64).map((p) => ({ x: p.x, y: p.y })));
    }
  }
  const field = signedDistanceField(polygons, { resolution: RESOLUTION, pad: 0.05 });
  return (x, y, m) => field.sample(x, y) <= -m;
}

/** Diamond well seats on a staggered lattice, kept only where the whole diamond clears the bezel. */
function lattice(letterShapes, insideBy, margin, half = HALF) {
  const box = new THREE.Box2();
  for (const s of letterShapes) for (const p of s.getPoints(24)) box.expandByPoint(p);
  const out = [];
  let rejected = 0;
  const rows = Math.ceil((box.max.y - box.min.y) / (PITCH * 0.866));
  for (let r = 0; r <= rows; r++) {
    const y = box.min.y + r * PITCH * 0.866;
    const stagger = r % 2 ? PITCH / 2 : 0;
    for (let x = box.min.x + stagger; x <= box.max.x; x += PITCH) {
      // The diamond's four corners, not just its centre: a centre that clears the bezel by less
      // than the half-diagonal still breaks the letter's edge.
      const corners = [
        [x, y + half],
        [x + half, y],
        [x, y - half],
        [x - half, y],
      ];
      if (!corners.every(([cx, cy]) => insideBy(cx, cy, margin))) {
        rejected++;
        continue;
      }
      out.push({ x, y });
    }
  }
  return { seats: out, rejected };
}

/**
 * How many seats survive as the slab's bevel — and with it the smallest legal bezel — is reduced.
 * The bezel cannot go below the slab's bevel, because inside that width the slab's front face is
 * a ramp rather than a floor, and a well cut over it has a sloped seat at an unpredictable depth.
 */
if (process.argv.includes('--sweep')) {
  const LETTERS = arg('letters', 'IRHOB').split('');
  const BEVELS = arg('bevels', '0.038,0.03,0.02,0.012,0.006,0').split(',').map(Number);
  console.log(`seats at pitch ${PITCH}, stone half-diagonal ${HALF} em; bezel = the slab's bevel\n`);
  console.log(`  bevel   ${LETTERS.map((l) => l.padStart(5)).join('')}    total`);
  for (const b of BEVELS) {
    const counts = LETTERS.map((letter) => {
      const s = glyphToShapes(font, letter, 1);
      // A zero bezel still has to keep the stone out of the outline itself, so the floor
      // constraint relaxes to nothing but the silhouette one does not.
      return lattice(s, regionOf(s), Math.max(b, 1e-4)).seats.length;
    });
    const total = counts.reduce((a, c) => a + c, 0);
    console.log(
      `  ${b.toFixed(3)}   ${counts.map((c) => String(c).padStart(5)).join('')}   ${String(total).padStart(6)}`,
    );
  }
  process.exit(0);
}

const shapes = glyphToShapes(font, LETTER, 1);
const insideBy = regionOf(shapes);
const { seats, rejected } = lattice(shapes, insideBy, MARGIN);

/** The glyph's shapes with a diamond hole per seat. */
function cutPlate() {
  const cut = shapes.map((s) => {
    const copy = s.clone();
    copy.holes = s.holes.map((h) => h.clone());
    return copy;
  });
  for (const seat of seats) {
    // One outline per glyph in every face here; a multi-outline glyph would need a containment
    // test, and the field cannot say which outline a point belongs to.
    const host = cut[0];
    const hole = new THREE.Path();
    hole.moveTo(seat.x, seat.y + HALF);
    hole.lineTo(seat.x + HALF, seat.y);
    hole.lineTo(seat.x, seat.y - HALF);
    hole.lineTo(seat.x - HALF, seat.y);
    hole.closePath();
    host.holes.push(hole);
  }
  return cut;
}

const plateShapes = cutPlate();
const bevelOf = (size) => ({
  bevelThickness: (DEFAULT_GLYPH_OPTIONS.bevelThickness * size) / DEFAULT_GLYPH_OPTIONS.bevelSize,
  bevelSize: size,
  bevelSegments: DEFAULT_GLYPH_OPTIONS.bevelSegments,
  bevelOffset: 0,
});
const extrude = (s, depth, bevelSize) =>
  new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: bevelSize > 0,
    curveSegments: DEFAULT_GLYPH_OPTIONS.curveSegments,
    ...(bevelSize > 0 ? bevelOf(bevelSize) : {}),
  });

/** A stack: a slab of `D - PLATE`, and a plate of `PLATE` sitting on its front face. */
function stack(plate, slabBevel, plateBevel) {
  const slabGeo = extrude(shapes, D - PLATE, slabBevel);
  const plateGeo = extrude(plate, PLATE, plateBevel);
  plateGeo.translate(0, 0, D - PLATE);
  return [slabGeo, plateGeo];
}

const FULL = DEFAULT_GLYPH_OPTIONS.bevelSize;
const VARIANTS = {
  // Today's letter. Anything that changes here changes every shipped look.
  today: () => [extrude(shapes, D, FULL)],
  // The stack with no wells at all: the junction on its own.
  stack: () => stack(shapes, FULL, FULL),
  // The design's construction, at whatever slab bevel was asked for.
  wells: () => stack(plateShapes, SLAB_BEVEL, FULL),
  // The slab's bevel dropped entirely, which takes the letter's back edge with it.
  'wells-flat-slab': () => stack(plateShapes, 0, FULL),
};

const dump = (geo) => ({
  position: [...geo.getAttribute('position').array],
  normal: [...geo.getAttribute('normal').array],
  index: geo.getIndex() ? [...geo.getIndex().array] : null,
});

console.log(
  `"${LETTER}" — ${seats.length} seats placed, ${rejected} rejected by the ${MARGIN} em bezel\n`,
);
console.log('  variant             meshes   vertices');
const payload = {
  letter: LETTER,
  variants: Object.entries(VARIANTS).map(([name, make]) => {
    const geos = make();
    const vertices = geos.reduce((n, g) => n + g.getAttribute('position').count, 0);
    console.log(
      `  ${name.padEnd(18)}  ${String(geos.length).padStart(5)}   ${String(vertices).padStart(8)}`,
    );
    const out = { name, meshes: geos.map(dump) };
    for (const g of geos) g.dispose();
    return out;
  }),
};

mkdirSync(OUT, { recursive: true });
const TREES = {
  '/klieg/': resolve(ROOT, 'packages/core/dist'),
  '/three/': resolve(ROOT, 'node_modules/three/build'),
};
const FILES = {
  '/': [readFileSync(resolve(HERE, 'plate-stack.html')), 'text/html'],
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
const page = await browser.newPage({ viewport: { width: 1600, height: 560 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
page.on('console', (m) => m.type() === 'error' && console.log(`  [console] ${m.text()}`));
console.log('');
for (const look of arg('looks', 'gold,chrome').split(',')) {
  await page.goto(`${base}/?look=${look}`);
  await page.waitForFunction(() => window.__shot === true, null, { timeout: 60_000 });
  const file = resolve(OUT, `plate-${LETTER}-${look}.png`);
  writeFileSync(file, await page.screenshot());
  console.log(`  wrote ${file}`);
}
await browser.close();
server.close();
process.exit(0);
