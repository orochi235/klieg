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
/** How far in from the letter's edge the pinned row of seeds sits, as a fraction of the pitch. */
const EDGE_INSET = Number(arg('edgeInset', '0.42'));
/**
 * The plate's thickness — a well's depth — in em, derived from the pitch unless given.
 *
 * It is not a free choice: a brilliant's pavilion is about 0.38 of its girdle, the girdle sits
 * `sink` below the face, and the slab's own bevel lifts the floor. Too thin a plate and every
 * full-size stone bottoms out on the floor, which reads as a flat tile in a hole rather than as a
 * stone with a point. The shipped 0.09 happens to be deep enough for a 0.048 em diamond and is far
 * too thin for a cell three times that wide.
 */
const PITCH_FOR_PLATE = Number(arg('pitch', '0.055'));
const AUTO_PLATE = (() => {
  const width = PITCH_FOR_PLATE * Math.sqrt(Math.sqrt(3) / 2);
  const slabBevelZ =
    (DEFAULT_GLYPH_OPTIONS.bevelThickness *
      Math.min(DEFAULT_GLYPH_OPTIONS.bevelSize, Number(arg('bezel', '0.014')))) /
    DEFAULT_GLYPH_OPTIONS.bevelSize;
  const plateBevelZ =
    (DEFAULT_GLYPH_OPTIONS.bevelThickness * Number(arg('bevel', '0.004'))) /
    DEFAULT_GLYPH_OPTIONS.bevelSize;
  const sink = Number(arg('sink', '0.18'));
  const need = Number(arg('pavilion', '0.38')) * width + slabBevelZ - plateBevelZ + 0.003;
  return Math.round((need / (1 - sink)) * 1e4) / 1e4;
})();
const PLATE = Number(arg('plate', String(AUTO_PLATE)));
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

/** Bilinear, unlike `Field.sample`, which rounds — the inward push needs a smooth gradient. */
function depthAt(x, y) {
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
}

/**
 * A point moved `dist` further inside the letter, along the field's own gradient. Doing it off the
 * field rather than off a ring's normal is what makes a counter behave like the outer edge: inward
 * is wherever the glyph is, and the field already knows.
 */
function pushInward(x, y, dist) {
  const h = field.emPerCell;
  const gx = (depthAt(x + h, y) - depthAt(x - h, y)) / (2 * h);
  const gy = (depthAt(x, y + h) - depthAt(x, y - h)) / (2 * h);
  const len = Math.hypot(gx, gy) || 1e-9;
  return [x - (gx / len) * dist, y - (gy / len) * dist];
}

/**
 * Seeds in two sets. A row along the letter's edge, pinned, so the boundary is a place stones are
 * laid rather than a place they are cut off; and a lattice through what is left, free to relax.
 *
 * Truncating an interior cell is the crude way to fill an edge and it makes shards. A jeweller
 * grades the stones down instead, and seeding the boundary is how that falls out: a pinned row
 * gives the edge its own cells, and Lloyd evens out everything behind it.
 */
const EDGE = arg('edge', 'absorb');
const pinned = [];
const step = PITCH * Number(arg('edgeStep', '0.95'));
for (const rings of EDGE === 'grade' ? REGION : []) {
  for (const ring of rings) {
    let carry = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = carry; t < seg; t += step) {
        const u = t / seg;
        const [px, py] = pushInward(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, EDGE_INSET * PITCH);
        pinned.push([px, py]);
      }
      carry = seg > 0 ? (carry - seg) % step : carry;
      if (carry < 0) carry += step;
    }
  }
}

const free = [];
const rowStep = PITCH * ROW;
// Deep enough that the lattice does not crowd the pinned row it sits behind. With no pinned row
// there is nothing to clear, and a seed is kept as soon as it is inside the letter at all — its
// cell is then whatever the outline leaves, which is the point.
const clearance =
  EDGE === 'grade' ? -(EDGE_INSET * PITCH + PITCH * Number(arg('clearance', '0.62'))) : 0;
for (let r = -1; r * rowStep + box.min.y <= box.max.y + rowStep; r++) {
  const y = box.min.y + r * rowStep;
  const stagger = r % 2 ? PITCH / 2 : 0;
  for (let x = box.min.x - PITCH + stagger; x <= box.max.x + PITCH; x += PITCH) {
    const jx = x + (random() - 0.5) * PITCH * JITTER;
    const jy = y + (random() - 0.5) * PITCH * JITTER;
    if (depthAt(jx, jy) < clearance) free.push([jx, jy]);
  }
}

const WHOLE = PITCH * PITCH * ROW;

/** The Voronoi cell of `seeds[i]`, before the wall comes off it. */
function voronoiCell(i, seeds) {
  const [sx, sy] = seeds[i];
  const r = PITCH * 2.2;
  let cell = [
    [sx - r, sy - r],
    [sx + r, sy - r],
    [sx + r, sy + r],
    [sx - r, sy + r],
  ];
  for (let j = 0; j < seeds.length; j++) {
    if (j === i) continue;
    const dx = seeds[j][0] - sx;
    const dy = seeds[j][1] - sy;
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-12 || d2 > (PITCH * 3) ** 2) continue;
    const len = Math.sqrt(d2);
    cell = clipHalf(cell, sx + dx / 2, sy + dy / 2, dx / len, dy / len);
    if (cell.length < 3) break;
  }
  return cell;
}

/** The cell as the letter leaves it: every piece of it that survives the region. */
function clipped(cell) {
  if (cell.length < 3) return [];
  try {
    const pieces = polygonClipping.intersection([cell], ...REGION.map((r) => [r]));
    return (pieces ?? [])
      .map((piece) => piece[0])
      .filter((ring) => ring && ring.length >= 4)
      .map((ring) => ring.slice(0, -1));
  } catch {
    return [];
  }
}

// Lloyd: each free seed walks to the centroid of what it actually owns inside the letter, which
// is what turns a lattice clipped by an outline into a field that fits it. The pinned row does not
// move — let it relax and it migrates inward, and the edge grading goes with it.
const RELAX = Number(arg('relax', '4'));
for (let pass = 0; pass < RELAX; pass++) {
  const all = [...pinned, ...free];
  for (let i = 0; i < free.length; i++) {
    const pieces = clipped(voronoiCell(pinned.length + i, all));
    if (pieces.length === 0) continue;
    const biggest = pieces.reduce((a, b) => (area(a) > area(b) ? a : b));
    if (area(biggest) < WHOLE * 0.05) continue;
    free[i] = centroidOf(biggest);
  }
}

/**
 * Drop the seed, never the cell. A cell too small to set is dead space only if it is deleted;
 * remove the seed that owns it and every point it held goes to whichever seed is next nearest,
 * which is what Voronoi is for. The neighbours grow to take it and the letter stays covered.
 *
 * `--edge grade` is the other policy: seed the boundary as well, so the edge gets its own smaller
 * stones instead of the interior ones reaching out to the outline.
 */
let seeds = [...pinned, ...free];
let culled = 0;
for (let pass = 0; pass < 8; pass++) {
  const doomed = new Set();
  for (let i = pinned.length; i < seeds.length; i++) {
    const pieces = clipped(inset(voronoiCell(i, seeds), WALL / 2));
    const held = pieces.reduce((n, p) => n + area(p), 0);
    if (held < WHOLE * MIN_AREA) doomed.add(i);
  }
  if (doomed.size === 0) break;
  culled += doomed.size;
  seeds = seeds.filter((_, i) => !doomed.has(i));
}

const cells = [];
for (let i = 0; i < seeds.length; i++) {
  const walled = inset(voronoiCell(i, seeds), WALL / 2);
  for (const poly of clipped(walled)) {
    // The same bar the cull used. Letting a sliver through here is what leaves a needle of a stone
    // in a tapering stroke, and a needle is all fan and no table.
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
/** How far every table stands above the plate's face, in em. Constant, so the tables are coplanar. */
const PROUD = Number(arg('proud', '0.006'));
let clamped = 0;

/**
 * A stone shaped to its own cell: the girdle is the cell, so a fragment at the letter's edge is a
 * fragment of a stone rather than a whole one hanging over the edge.
 */
/**
 * A point the whole cell can be seen from, which the centroid is not once the outline has bitten a
 * bite out of a cell. Scaling a ring toward a point outside it turns the ring inside out, and a fan
 * drawn from one throws triangles clean outside the cell — which is what put extra gold on the
 * bottom-right leg. Sampled rather than solved: the pole of inaccessibility to a grid's accuracy.
 */
function interiorPoint(poly) {
  const c = centroidOf(poly);
  if (inside(poly.map(([x, y]) => ({ x, y })), { x: c[0], y: c[1] })) return c;
  const b = new THREE.Box2();
  for (const [x, y] of poly) b.expandByPoint(new THREE.Vector2(x, y));
  let best = poly[0];
  let bestD = -1;
  const N = 12;
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < N; j++) {
      const x = b.min.x + ((b.max.x - b.min.x) * i) / N;
      const y = b.min.y + ((b.max.y - b.min.y) * j) / N;
      if (!inside(poly.map(([px, py]) => ({ x: px, y: py })), { x, y })) continue;
      let d = Number.POSITIVE_INFINITY;
      for (let k = 0, l = poly.length - 1; k < poly.length; l = k++) {
        const ax = poly[l][0];
        const ay = poly[l][1];
        const ex = poly[k][0] - ax;
        const ey = poly[k][1] - ay;
        const len2 = ex * ex + ey * ey || 1e-24;
        const t = Math.min(Math.max(((x - ax) * ex + (y - ay) * ey) / len2, 0), 1);
        d = Math.min(d, Math.hypot(x - (ax + t * ex), y - (ay + t * ey)));
      }
      if (d > bestD) {
        bestD = d;
        best = [x, y];
      }
    }
  }
  return best;
}

const stonePos = [];
for (const poly of cells) {
  const c = interiorPoint(poly);
  const width = Math.sqrt(area(poly));
  // Every table on one plane, standing `PROUD` above the metal. Deriving the crown from the cell's
  // own width instead — the obvious reading of a brilliant's proportions — sinks the small stones:
  // the girdle sits at a fixed depth, so a narrow cell's crown is too short to reach the surface
  // and its table ends up below the plate. That is what the edges were doing.
  const girdleZ = faceZ - SINK * PLATE;
  const tableZ = faceZ + PROUD;
  // A pavilion deeper than the well gets shallower, never flatter. Clamping the culet to the floor
  // instead lands every big stone on one plane, and a stone with a flat bottom sitting on the
  // floor of its own well is a tile in a hole — which is what the wide cells were reading as.
  const room = (girdleZ - floorZ) * 0.92;
  const drop = Math.min(PAVILION * width, room);
  if (PAVILION * width > room) clamped++;
  const culetZ = girdleZ - drop;
  const toward = (k, z) =>
    poly.map(([x, y]) => new THREE.Vector3(c[0] + (x - c[0]) * k, c[1] + (y - c[1]) * k, z));
  const girdle = toward(1, girdleZ);
  const table = toward(TABLE, tableZ);
  // The pavilion closes on a small ring rather than on a point: a cone from one apex is only ever
  // inside a cell the apex can see all of, and a clipped cell is not that.
  const culet = toward(0.12, culetZ);
  const push = (...ps) => {
    for (const p of ps) stonePos.push(p.x, p.y, p.z);
  };
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    push(girdle[i], girdle[j], table[j]);
    push(girdle[i], table[j], table[i]);
    push(girdle[j], girdle[i], culet[i]);
    push(girdle[j], culet[i], culet[j]);
  }
  // Both caps triangulated rather than fanned, for the same reason the apex moved.
  const cap = THREE.ShapeUtils.triangulateShape(
    poly.map(([x, y]) => new THREE.Vector2(x, y)),
    [],
  );
  for (const [a, b, d] of cap) {
    push(table[a], table[b], table[d]);
    push(culet[d], culet[b], culet[a]);
  }
}
const stones = new THREE.BufferGeometry();
stones.setAttribute('position', new THREE.Float32BufferAttribute(stonePos, 3));
stones.computeVertexNormals();

const whole = cells.filter((c) => area(c) > WHOLE * 0.92).length;
console.log(`"${LETTER}" — ${cells.length} cells at pitch ${PITCH}, wall ${WALL}, bezel ${BEZEL}`);
console.log(
  `  edge '${EDGE}': ${pinned.length} pinned, ${free.length} laid, ${culled} culled so neighbours took the space`,
);
console.log(`  ${whole} whole, ${cells.length - whole} shaped by the outline`);
console.log(
  `  plate ${PLATE} deep, floor z ${floorZ.toFixed(4)}, face z ${faceZ.toFixed(4)}, ` +
    `tables at ${(faceZ + PROUD).toFixed(4)}`,
);
if (clamped > 0) {
  console.log(
    `  ${clamped} of ${cells.length} stones cut shallower than a brilliant — their cell is wider ` +
      `than the plate is deep. They still come to a culet; a deeper plate makes them proper.`,
  );
}
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
