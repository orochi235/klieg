/**
 * Pavé: stones packed wall to wall, and the cells that do not fit whole cut to the letter's edge.
 *
 *   npm run build -w klieg && node spikes/pave.mjs [--letter R] [--pitch 0.055]
 *
 * The shipped `lattice` cutter places a diamond only where a whole one fits, so a letter carries a
 * polka-dot field with a wide gold margin and gold between every stone. Real pavé is the other way
 * round: the stones are the surface, the metal is what little is left between them, and the ones at
 * the edge are irregular fragments.
 *
 * Cells are the Voronoi diagram of a staggered lattice, which is a honeycomb in the interior and
 * whatever the letter's outline leaves at the boundary. Each cell is inset by half a wall so the
 * plate keeps metal between neighbours, then clipped to the glyph inset by the bezel. A seed whose
 * cell survives that with enough area gets a well; the rest are dropped rather than cut.
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
import { chamfered, DEFAULT_GLYPH_OPTIONS, glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const has = (name) => process.argv.includes(`--${name}`);
const LETTER = arg('letter', 'R');
const OUT = resolve(arg('out', resolve(HERE, 'pave-out')));
/** Seed spacing, in em — with no gaps this is very nearly the stone's width. */
const PITCH = Number(arg('pitch', '0.055'));
/** Metal left standing between two stones, in em. Half of it comes off each cell. */
const WALL = Number(arg('wall', '0.009'));
/** Metal left at the letter's own edge, in em. */
const BEZEL = Number(arg('bezel', '0.014'));
/** How far a seed may wander off the lattice, as a fraction of the pitch. */
const JITTER = Number(arg('jitter', '0'));
/** A clipped cell smaller than this fraction of a whole one is dropped rather than set. */
const MIN_AREA = Number(arg('minArea', '0.18'));
/** The plate's thickness — a well's depth — in em. */
const PLATE = Number(arg('plate', '0.055'));
/**
 * The bevel around each well. The shipped plate uses the glyph's own 0.038 em, which is most of a
 * cell at this pitch: neighbouring wells' bevels then eat the wall between them and the plate comes
 * apart. Pavé wants a bead, not a chamfer.
 */
const BEVEL = Number(arg('bevel', '0.004'));
const SEED = Number(arg('seed', '7'));

const D = DEFAULT_GLYPH_OPTIONS.depth;
const ROW = Math.sqrt(3) / 2;

const buf = readFileSync(resolve(ROOT, 'apps/lab/public/font.ttf'));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const shapes = glyphToShapes(font, LETTER, 1);

// ---------------------------------------------------------------------------------------------
// The region: the glyph inset by the bezel, as polygons rather than as a predicate.

/** Every ring of the glyph, outlines and counters alike — the field takes them all. */
const rings = [];
for (const shape of shapes) {
  rings.push(shape.getPoints(32).map((p) => ({ x: p.x, y: p.y })));
  for (const hole of shape.holes) rings.push(hole.getPoints(32).map((p) => ({ x: p.x, y: p.y })));
}
const field = signedDistanceField(rings, { resolution: 512, pad: 0.05 });

const inside = (ring, p) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};

/** Contours and their holes, by containment depth — `isoContours` answers rings with no nesting. */
function nest(loops) {
  const depth = loops.map((r, i) =>
    loops.reduce((n, other, j) => (i !== j && inside(other, r[0]) ? n + 1 : n), 0),
  );
  const parent = loops.map((r, i) => {
    let best = -1;
    for (let j = 0; j < loops.length; j++) {
      if (i === j || !inside(loops[j], r[0])) continue;
      if (best === -1 || depth[j] > depth[best]) best = j;
    }
    return best;
  });
  return loops
    .map((loop, i) => ({ loop, i }))
    .filter(({ i }) => depth[i] % 2 === 0)
    .map(({ loop, i }) => [
      loop,
      ...loops.filter((_, j) => depth[j] % 2 === 1 && parent[j] === i),
    ]);
}

const xy = (poly) => poly.map((p) => [p.x, p.y]);
/** The inset glyph as a multipolygon polygon-clipping can intersect against. */
const REGION = nest(isoContours(field, -BEZEL)).map((rs) => rs.map(xy));
if (REGION.length === 0) throw new Error(`nothing survives a ${BEZEL} em bezel on '${LETTER}'`);

// ---------------------------------------------------------------------------------------------
// The cells.

/** Clip a convex polygon by a half-plane, keeping the side `keep` is on. Sutherland-Hodgman. */
function clipHalf(poly, ax, ay, bx, by) {
  // The line through (ax, ay) with normal (bx, by); keep points where the dot product is negative.
  const side = (p) => (p[0] - ax) * bx + (p[1] - ay) * by;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const dCur = side(cur);
    const dPrev = side(prev);
    if (dPrev <= 0 !== dCur <= 0) {
      const t = dPrev / (dPrev - dCur);
      out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
    }
    if (dCur <= 0) out.push(cur);
  }
  return out;
}

const area = (poly) => {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  }
  return Math.abs(a) / 2;
};

const centroidOf = (poly) => {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    a += f;
    cx += (poly[j][0] + poly[i][0]) * f;
    cy += (poly[j][1] + poly[i][1]) * f;
  }
  if (Math.abs(a) < 1e-12) return poly[0];
  return [cx / (3 * a), cy / (3 * a)];
};

/** Every edge pushed inward by `d`, which is an inset while the polygon stays convex. */
function inset(poly, d) {
  let out = poly;
  for (let i = 0; i < poly.length && out.length >= 3; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1e-12;
    // Outward normal for a counter-clockwise ring; `clipHalf` keeps the inward side.
    const nx = ey / len;
    const ny = -ex / len;
    out = clipHalf(out, a[0] + nx * d, a[1] + ny * d, nx, ny);
  }
  return out;
}

const box = new THREE.Box2();
for (const shape of shapes) for (const p of shape.getPoints(32)) box.expandByPoint(p);

let rand = SEED;
const random = () => {
  rand = (rand * 1664525 + 1013904223) % 4294967296;
  return rand / 4294967296;
};

/** A staggered lattice over the glyph's box, so the interior cells come out as a honeycomb. */
const seeds = [];
const rowStep = PITCH * ROW;
for (let r = -1; r * rowStep + box.min.y <= box.max.y + rowStep; r++) {
  const y = box.min.y + r * rowStep;
  const stagger = r % 2 ? PITCH / 2 : 0;
  for (let x = box.min.x - PITCH + stagger; x <= box.max.x + PITCH; x += PITCH) {
    seeds.push([
      x + (random() - 0.5) * PITCH * JITTER,
      y + (random() - 0.5) * PITCH * JITTER,
    ]);
  }
}

const WHOLE = PITCH * PITCH * ROW;
const cells = [];
for (const [sx, sy] of seeds) {
  const r = PITCH * 1.6;
  let cell = [
    [sx - r, sy - r],
    [sx + r, sy - r],
    [sx + r, sy + r],
    [sx - r, sy + r],
  ];
  // The Voronoi cell: every bisector with a neighbour close enough to matter.
  for (const [ox, oy] of seeds) {
    const dx = ox - sx;
    const dy = oy - sy;
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-12 || d2 > (PITCH * 2.5) ** 2) continue;
    const len = Math.sqrt(d2);
    cell = clipHalf(cell, sx + dx / 2, sy + dy / 2, dx / len, dy / len);
    if (cell.length < 3) break;
  }
  if (cell.length < 3) continue;
  const walled = inset(cell, WALL / 2);
  if (walled.length < 3) continue;
  // Clipped to the letter, a cell may come back as several pieces, or as none.
  let pieces;
  try {
    pieces = polygonClipping.intersection([walled], ...REGION.map((r) => [r]));
  } catch {
    continue;
  }
  for (const piece of pieces ?? []) {
    const ring = piece[0];
    if (!ring || ring.length < 4) continue;
    const poly = ring.slice(0, -1);
    if (area(poly) < WHOLE * MIN_AREA) continue;
    cells.push(poly);
  }
}
if (cells.length === 0) throw new Error('no cell survived — try a smaller wall or bezel');

// ---------------------------------------------------------------------------------------------
// The plate, and a stone per cell.

/** Local to this spike: `buildPlate` fixes the well bevel at the glyph's own, which is most of a
 * cell at this pitch. */
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

// Chamfered before the wells go in, never after: `chamfered` cuts sharp corners back so three's
// miter cap does not leave a nub past a letter's tip, and running it over 143 hole paths as well
// is what silently loses most of them.
const CHAMFERED = chamfered(shapes, DEFAULT_GLYPH_OPTIONS);
const holed = CHAMFERED.map((shape) => {
  const copy = shape.clone();
  copy.holes = shape.holes.map((h) => h.clone());
  return copy;
});
const hostRings = holed.map((s) => s.getPoints(32));
for (const poly of cells) {
  const path = new THREE.Path();
  path.moveTo(poly[0][0], poly[0][1]);
  for (const [x, y] of poly.slice(1)) path.lineTo(x, y);
  path.closePath();
  const host = hostRings.findIndex((ring) => inside(ring.map((p) => ({ x: p.x, y: p.y })), {
    x: poly[0][0],
    y: poly[0][1],
  }));
  if (host >= 0) holed[host].holes.push(path);
}

const slabDepth = Math.max(D - PLATE, 0);
const slabBevelZ = (DEFAULT_GLYPH_OPTIONS.bevelThickness * Math.min(DEFAULT_GLYPH_OPTIONS.bevelSize, BEZEL)) / DEFAULT_GLYPH_OPTIONS.bevelSize;
const slab = extrude(CHAMFERED, slabDepth, Math.min(DEFAULT_GLYPH_OPTIONS.bevelSize, BEZEL));
const plate = extrude(holed, PLATE, BEVEL);
plate.translate(0, 0, slabDepth);
const floorZ = slabDepth + slabBevelZ;
const faceZ = slabDepth + PLATE + (DEFAULT_GLYPH_OPTIONS.bevelThickness * BEVEL) / DEFAULT_GLYPH_OPTIONS.bevelSize;

const merged = [];
for (const geo of [slab, plate]) {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  merged.push({ pos: pos.array, nrm: nrm.array });
}
const bodyCount = merged.reduce((n, m) => n + m.pos.length, 0);
const bodyPos = new Float32Array(bodyCount);
const bodyNrm = new Float32Array(bodyCount);
let at = 0;
for (const m of merged) {
  bodyPos.set(m.pos, at);
  bodyNrm.set(m.nrm, at);
  at += m.pos.length;
}
const body = new THREE.BufferGeometry();
body.setAttribute('position', new THREE.Float32BufferAttribute(bodyPos, 3));
body.setAttribute('normal', new THREE.Float32BufferAttribute(bodyNrm, 3));

/** Table width, crown height and pavilion depth over the cell's own width. */
const TABLE = Number(arg('table', '0.56'));
const CROWN = Number(arg('crown', '0.15'));
const PAVILION = Number(arg('pavilion', '0.38'));
/** How far below the plate's face the girdle sits, as a fraction of the plate. */
const SINK = Number(arg('sink', '0.18'));

/**
 * A stone shaped to its own cell: the girdle is the cell, so a fragment at the letter's edge is a
 * fragment of a stone rather than a whole one hanging over the edge.
 */
const stonePos = [];
for (const poly of cells) {
  const c = centroidOf(poly);
  const width = Math.sqrt(area(poly));
  const girdleZ = faceZ - SINK * PLATE;
  const tableZ = girdleZ + CROWN * width;
  const culet = new THREE.Vector3(c[0], c[1], Math.max(girdleZ - PAVILION * width, floorZ + 0.002));
  const girdle = poly.map(([x, y]) => new THREE.Vector3(x, y, girdleZ));
  const table = poly.map(([x, y]) => new THREE.Vector3(
    c[0] + (x - c[0]) * TABLE,
    c[1] + (y - c[1]) * TABLE,
    tableZ,
  ));
  const push = (...ps) => {
    for (const p of ps) stonePos.push(p.x, p.y, p.z);
  };
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    push(girdle[i], girdle[j], table[j]);
    push(girdle[i], table[j], table[i]);
    push(girdle[j], girdle[i], culet);
  }
  // The table, fanned from the first vertex: a cell clipped to the letter can be non-convex, and a
  // fan spans it well enough at this size.
  for (let i = 1; i + 1 < poly.length; i++) push(table[0], table[i], table[i + 1]);
}
const stones = new THREE.BufferGeometry();
stones.setAttribute('position', new THREE.Float32BufferAttribute(stonePos, 3));
stones.computeVertexNormals();

const whole = cells.filter((c) => area(c) > WHOLE * 0.92).length;
console.log(`"${LETTER}" — ${cells.length} cells at pitch ${PITCH}, wall ${WALL}, bezel ${BEZEL}`);
console.log(`  ${whole} whole, ${cells.length - whole} cut to the letter's edge`);
console.log(`  body ${body.getAttribute('position').count} vertices, stones ${stones.getAttribute('position').count}`);

const dump = (geo) => ({
  position: [...geo.getAttribute('position').array],
  normal: [...geo.getAttribute('normal').array],
  index: geo.getIndex() ? [...geo.getIndex().array] : null,
});
const payload = { letter: LETTER, body: dump(body), stones: dump(stones), cells: cells.length };
if (has('no-render')) process.exit(0);

mkdirSync(OUT, { recursive: true });
const TREES = {
  '/klieg/': resolve(ROOT, 'packages/core/dist'),
  '/three/': resolve(ROOT, 'node_modules/three/build'),
};
const FILES = {
  '/': [readFileSync(resolve(HERE, 'pave.html')), 'text/html'],
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
  for (const parts of arg('parts', 'both').split(',')) {
    const tint = arg('tint', '0.5');
    await page.goto(`${base}/?look=${look}&tint=${tint}&parts=${parts}`);
    await page.waitForFunction(() => window.__shot === true, null, { timeout: 120_000 });
    const file = resolve(OUT, `pave-${LETTER}-${look}-${parts}.png`);
    writeFileSync(file, await page.screenshot());
    console.log(`  wrote ${file}`);
  }
}
await browser.close();
server.close();
process.exit(0);
