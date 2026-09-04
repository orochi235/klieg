/**
 * Hollow a letterform out as a stack of levels, and bevel the outside and the wells separately.
 *
 *   npm run build -w klieg && node spikes/hollow.mjs [--letter R] [--rim 0.05] [--well 0.16]
 *   node spikes/hollow.mjs --levels 0.05:0.10,0.09:0.06        # a stepped well
 *
 * A level is an outline and a depth: the glyph inset by `inset`, its floor `depth` below the floor
 * above it. The drinking glass is the one-level case and concentric wells are the same construction
 * with more, so nothing here hard-codes a slab under a plate.
 *
 * Nothing is extruded. `ExtrudeGeometry` bevels every contour it is handed at one size, which is
 * both faults it used to have at once: the outside carried a ledge where two separately bevelled
 * solids met, and a well's rim could not take a bead while the letter kept its chamfer. Walls are
 * stitched here between two offsets of one ring, so `--outer` and `--bevel` are independent and
 * the outer skin is a single unbroken surface from the back face to the front.
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
import * as THREE from 'three';
import { isoContours, signedDistanceField } from '../packages/core/dist/render/tube/field.js';
import {
  buildGlyphGeometry,
  chamfered,
  DEFAULT_GLYPH_OPTIONS,
  glyphToShapes,
} from '../packages/core/dist/text/glyphs.js';

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
/** The letter's own chamfer, on the outside only. */
const OUTER = Number(arg('outer', String(DEFAULT_GLYPH_OPTIONS.bevelSize)));
/** The bead around a well's rim, on the hole only. A well wants far less than a letter does. */
const LIP = Number(arg('bevel', '0.008'));
const SEGS = Math.max(1, Number(arg('bevelSegments', '3')));
/** How coarsely a level's outline is walked, in em. Below the field's own cell it is all staircase. */
const SPACING = Number(arg('outlineSpacing', '0.006'));
const TILT = Number(arg('tilt', '0.5'));

/** How thick the letter is, in em, before anything is taken out of it. */
const D = Number(arg('depth', String(DEFAULT_GLYPH_OPTIONS.depth)));
/** How far the outer chamfer falls, in em. Scaled off the glyph's own unless given. */
const OUTER_T = Number(
  arg('outerDrop', String((DEFAULT_GLYPH_OPTIONS.bevelThickness * OUTER) / DEFAULT_GLYPH_OPTIONS.bevelSize)),
);
if (2 * OUTER_T >= D) throw new Error(`a chamfer falling ${OUTER_T} twice does not fit ${D} of letter`);
/** How far a rim's bead falls as it narrows. Square by default, which is a 45 degree bead. */
const LIP_T = Number(arg('lipDrop', String(LIP)));

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
    throw new Error(
      `level ${i + 1} must sit inside level ${i}: ${LEVELS[i].inset} is not past ${LEVELS[i - 1].inset}`,
    );
  }
}
const TOTAL = LEVELS.reduce((n, l) => n + l.depth, 0);
if (TOTAL >= D) throw new Error(`the levels are ${TOTAL} deep and the letter is only ${D}`);
if (LEVELS[0].inset <= OUTER + LIP) {
  throw new Error(
    `a ${LEVELS[0].inset} em rim leaves no metal between a ${OUTER} em chamfer and a ${LIP} em bead`,
  );
}
for (const level of LEVELS) {
  if (level.depth <= LIP_T) throw new Error(`a level ${level.depth} deep cannot hold a ${LIP_T} em bead`);
}

const buf = readFileSync(resolve(ROOT, 'apps/lab/public/font.ttf'));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const shapes = glyphToShapes(font, LETTER, 1);

const SEGMENTS = 48;
const xy = (points) => points.map((p) => [p.x, p.y]);

// ---------------------------------------------------------------------------------------------
// Rings. Every ring is oriented with the metal on its left, whether it bounds a letter, a counter,
// a well or an island standing in one — which is what lets one offset and one stitch serve all four.

const signedArea = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
};

const dedupe = (ring) =>
  ring.filter((p, i) => {
    const q = ring[(i - 1 + ring.length) % ring.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9;
  });

/** `metalInside` is whether the material is enclosed by the ring or surrounds it. */
const orient = (ring, metalInside) => {
  const clean = dedupe(ring);
  return signedArea(clean) > 0 === metalInside ? clean : clean.slice().reverse();
};

/** three's own cap on a runaway miter, which is what stops a spur at a near-reversal. */
const MITER_CAP = Math.SQRT2;

/**
 * Every vertex moved `d` toward the metal, keeping the ring's point count. Two offsets of one ring
 * therefore stitch quad for quad, which is the whole reason a wall can be built here at all — the
 * field can offset any ring but gives back a ring with no correspondence to the one it came from.
 */
function offsetRing(ring, d) {
  if (d === 0) return ring.map((p) => [p[0], p[1]]);
  const n = ring.length;
  const normals = ring.map((p, i) => {
    const q = ring[(i + 1) % n];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.hypot(dx, dy) || 1e-12;
    // Metal is on the left of travel, so the inward normal is the left-hand normal.
    return [-dy / len, dx / len];
  });
  const step = field.emPerCell * 2;
  const moved = ring.map((p, i) => {
    const n2 = normals[i];
    const n1 = normals[(i - 1 + n) % n];
    const dot = n1[0] * n2[0] + n1[1] * n2[1];
    const denom = 1 + dot;
    let mx;
    let my;
    if (denom < 1e-6) {
      mx = n2[0] * d;
      my = n2[1] * d;
    } else {
      mx = ((n1[0] + n2[0]) * d) / denom;
      my = ((n1[1] + n2[1]) * d) / denom;
      const len = Math.hypot(mx, my);
      const cap = MITER_CAP * Math.abs(d);
      if (len > cap) {
        mx = (mx / len) * cap;
        my = (my / len) * cap;
      }
    }
    const level = depthAt(p[0], p[1]);
    const sign = Math.sign(depthAt(p[0] + n2[0] * step, p[1] + n2[1] * step) - level) || -1;
    return { p, m: [mx, my], t: reach(p[0], p[1], mx, my, level, sign, Math.abs(d)) };
  });

  // The field answers for one vertex at a time, so it catches a vertex overshooting its own medial
  // axis and misses two parts of a ring closing on each other — the S's spine folds with the field
  // never turning back. An edge that comes out pointing the other way is that fold, and is what a
  // per-vertex test cannot be asked. Pull both its ends in until it points the right way again.
  const at = (v) => [v.p[0] + v.m[0] * v.t, v.p[1] + v.m[1] * v.t];
  for (let pass = 0; pass < 12; pass++) {
    let folded = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = moved[i];
      const b = moved[j];
      if (a.t === 0 && b.t === 0) continue;
      const qa = at(a);
      const qb = at(b);
      const was = [b.p[0] - a.p[0], b.p[1] - a.p[1]];
      const now = [qb[0] - qa[0], qb[1] - qa[1]];
      if (now[0] * was[0] + now[1] * was[1] >= 0) continue;
      a.t *= 0.5;
      b.t *= 0.5;
      folded++;
    }
    if (folded === 0) break;
  }
  return moved.map(at);
}

/**
 * A ring walked at a fixed spacing. An iso-contour arrives at the field's own resolution, and its
 * vertex normals alternate with the grid's staircase — a miter off those folds the ring at almost
 * every vertex however small the offset is, which is not a thing a coarser ring does.
 */
function resample(ring, spacing) {
  const n = ring.length;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const q = ring[(i + 1) % n];
    total += Math.hypot(q[0] - ring[i][0], q[1] - ring[i][1]);
  }
  const steps = Math.max(8, Math.round(total / spacing));
  const step = total / steps;
  const out = [];
  let at = 0;
  let carried = 0;
  let want = 0;
  for (let i = 0; i < n && out.length < steps; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (want < carried + seg && out.length < steps) {
      const t = (want - carried) / (seg || 1);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      want += step;
    }
    carried += seg;
    at = i;
  }
  return out;
}

/** Three passes of the same filter the tube pipeline runs, for the same staircase. */
function smooth(ring, passes) {
  let out = ring;
  for (let k = 0; k < passes; k++) {
    const n = out.length;
    out = out.map((p, i) => {
      const a = out[(i - 1 + n) % n];
      const b = out[(i + 1) % n];
      return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
    });
  }
  return out;
}

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

// The letter, chamfered first: a chamfer cuts a sharp corner back so the miter above has something
// to work with, and it is what the shipped letter is built from anyway.
const CH = chamfered(shapes, DEFAULT_GLYPH_OPTIONS);
/** The glyph as regions of `{ outer, holes }`, all rings metal-on-the-left. */
const GLYPH = CH.map((shape) => ({
  outer: orient(xy(shape.getPoints(SEGMENTS)), true),
  holes: shape.holes.map((h) => orient(xy(h.getPoints(SEGMENTS)), false)),
}));

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

/** Bilinear, unlike `Field.sample`, which rounds — a clamped offset needs a smooth gradient. */
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
 * How far along its miter a vertex may actually travel. A taper runs out of metal before a wide
 * chamfer does — the R's leg has nowhere to put 0.038 em — and a miter that does not know that
 * folds the ring through itself. Walked rather than solved: stop at the level the offset was aiming
 * for, or at the turn where the field stops deepening, whichever comes first.
 */
function reach(px, py, mx, my, level, sign, want) {
  const target = level + sign * want;
  const ok = (t, from) => {
    const z = depthAt(px + mx * t, py + my * t);
    return sign * (z - from) >= -1e-9 && sign * (z - target) <= 1e-9 ? z : null;
  };
  let last = level;
  let best = 0;
  let k = 1;
  for (; k <= 8; k++) {
    const z = ok(k / 8, last);
    if (z === null) break;
    last = z;
    best = k / 8;
  }
  if (k > 8) return 1;
  // Bisect the step that failed. Eighths alone quantise the clamp, and a chamfer whose width jumps
  // between two neighbouring vertices reads as a serration all the way round the counter.
  let lo = best;
  let hi = k / 8;
  for (let i = 0; i < 6; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid, last) === null) hi = mid;
    else lo = mid;
  }
  return lo;
}

/**
 * A level's outline, as void regions. The orientation is inverted against the glyph's: a well's own
 * boundary has the metal outside it, and the island the R's counter leaves standing inside a well
 * has the metal inside — the same two roles the letter and its counter have, the other way round.
 */
const clean = (ring) => smooth(resample(ring, SPACING), 3);
const outlineAt = (inset) =>
  nest(isoContours(field, -inset).map((r) => clean(xy(r)))).map((poly) => ({
    outer: orient(poly[0], false),
    holes: poly.slice(1).map((h) => orient(h, true)),
  }));

const OUTLINES = LEVELS.map(({ inset }, i) => {
  const poly = outlineAt(inset);
  if (poly.length === 0) {
    throw new Error(`level ${i + 1}'s ${inset} em inset leaves nothing on '${LETTER}'`);
  }
  return poly;
});

/** The floor of each level, measured down from the letter's top face; descending. */
const FLOORS = [];
let running = D;
for (const { depth } of LEVELS) {
  running -= depth;
  FLOORS.push(running);
}

// ---------------------------------------------------------------------------------------------
// The shell: caps and walls, and nothing else.

const pos = [];
const tri = (a, b, c) => {
  pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
};

/** A quad strip between two offsets of one ring. `lower` first, so the metal ends up on the left. */
function wall(lower, zLo, upper, zHi) {
  if (Math.abs(zHi - zLo) < 1e-12) return;
  for (let i = 0; i < lower.length; i++) {
    const j = (i + 1) % lower.length;
    const a = [lower[i][0], lower[i][1], zLo];
    const b = [lower[j][0], lower[j][1], zLo];
    const c = [upper[j][0], upper[j][1], zHi];
    const e = [upper[i][0], upper[i][1], zHi];
    tri(a, b, c);
    tri(a, c, e);
  }
}

/**
 * A flat face. Its facing is asserted per triangle rather than inherited from the ring order, so a
 * ring that arrives wound the other way darkens nothing — a lid facing into the solid is invisible
 * and reads as a missing cap, which is a long way to chase for a sign flip.
 */
function cap(contour, holes, z, up) {
  const c = contour.map(([x, y]) => new THREE.Vector2(x, y));
  const hs = holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y)));
  const faces = THREE.ShapeUtils.triangulateShape(c, hs);
  const all = [c, ...hs].flat();
  if (process.env.HOLLOW_EDGES) {
    console.log(`    cap z ${z}: ${all.length} pts, ${hs.length} holes → ${faces.length} faces, want ${all.length + 2 * hs.length - 2}`);
  }
  for (const [ia, ib, ic] of faces) {
    const a = all[ia];
    const b = all[ib];
    const d = all[ic];
    const twice = (b.x - a.x) * (d.y - a.y) - (d.x - a.x) * (b.y - a.y);
    const ccw = twice > 0;
    const p = (v) => [v.x, v.y, z];
    if (ccw === up) tri(p(a), p(b), p(d));
    else tri(p(d), p(b), p(a));
  }
}

/**
 * A bevel as offsets of one ring: `size` toward the metal at the near end, nothing at the far end,
 * over `thick` of height. A quarter ellipse, which is the profile `ExtrudeGeometry` walks too.
 */
const bevelSteps = (size, thick, segs) =>
  Array.from({ length: segs + 1 }, (_, k) => {
    const t = k / segs;
    return { inset: size * Math.cos((t * Math.PI) / 2), dz: thick * Math.sin((t * Math.PI) / 2) };
  });

/** The letter's outer skin: chamfer up off the back face, one straight wall, chamfer in to the front. */
const OUTER_STEPS = OUTER > 0 && OUTER_T > 0 ? bevelSteps(OUTER, OUTER_T, SEGS) : [{ inset: 0, dz: 0 }];
const skinRing = (ring, k) => offsetRing(ring, OUTER_STEPS[k].inset);
const GLYPH_RINGS = GLYPH.flatMap((g) => [g.outer, ...g.holes]);
for (const ring of GLYPH_RINGS) {
  for (let k = 0; k < OUTER_STEPS.length - 1; k++) {
    wall(skinRing(ring, k), OUTER_STEPS[k].dz, skinRing(ring, k + 1), OUTER_STEPS[k + 1].dz);
  }
  wall(skinRing(ring, OUTER_STEPS.length - 1), OUTER_T, skinRing(ring, OUTER_STEPS.length - 1), D - OUTER_T);
  for (let k = OUTER_STEPS.length - 1; k > 0; k--) {
    wall(skinRing(ring, k), D - OUTER_STEPS[k].dz, skinRing(ring, k - 1), D - OUTER_STEPS[k - 1].dz);
  }
}

/**
 * A flat face from every ring that lands on its plane, nested by containment. A well inside a
 * letter can hold an island — the metal the R's counter leaves standing — and that island holds the
 * counter, so a face is four rings deep and a flat contour-with-holes cannot say so.
 */
const capPlane = (planeRings, z, up) => {
  for (const [contour, ...holes] of nest(planeRings)) cap(contour, holes, z, up);
};

/** The back face, which no level reaches. */
capPlane(GLYPH_RINGS.map((r) => offsetRing(r, OUTER)), 0, false);

/** A well's rim: `LIP` of metal taken off the ring at the ceiling, back to nothing `LIP_T` below. */
const LIP_STEPS = LIP > 0 && LIP_T > 0 ? bevelSteps(LIP, LIP_T, SEGS) : [{ inset: 0, dz: 0 }];
const wellRing = (ring, k) => offsetRing(ring, LIP_STEPS[k].inset);
const RIM_RINGS = OUTLINES.map((regions) =>
  regions.flatMap((r) => [r.outer, ...r.holes]).map((ring) => wellRing(ring, 0)),
);

for (let i = 0; i < LEVELS.length; i++) {
  const ceiling = i === 0 ? D : FLOORS[i - 1];
  for (const ring of OUTLINES[i].flatMap((r) => [r.outer, ...r.holes])) {
    for (let k = 0; k < LIP_STEPS.length - 1; k++) {
      wall(wellRing(ring, k + 1), ceiling - LIP_STEPS[k + 1].dz, wellRing(ring, k), ceiling - LIP_STEPS[k].dz);
    }
    const straight = wellRing(ring, LIP_STEPS.length - 1);
    wall(straight, FLOORS[i], straight, ceiling - LIP_T);
  }
}

/** The letter's front, then one floor per level: what the level leaves, opened by the level below. */
const frontRings = [...GLYPH_RINGS.map((r) => offsetRing(r, OUTER)), ...RIM_RINGS[0]];
if (process.env.HOLLOW_EDGES) {
  console.log(`    front rings: ${frontRings.map((r) => r.length).join(', ')}`);
  console.log(`    nested: ${nest(frontRings).map((g) => g.map((r) => r.length).join('+')).join(' | ')}`);
}
capPlane(frontRings, D, true);
for (let i = 0; i < LEVELS.length; i++) {
  const floor = OUTLINES[i]
    .flatMap((r) => [r.outer, ...r.holes])
    .map((ring) => wellRing(ring, LIP_STEPS.length - 1));
  capPlane([...floor, ...(RIM_RINGS[i + 1] ?? [])], FLOORS[i], true);
}

const body = new THREE.BufferGeometry();
body.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(pos), 3));
body.computeVertexNormals();

// The control. `--plain` renders the letter the shipped path builds, wells and all removed, so the
// outside has something to be judged against rather than only a memory of what it should look like.
const plain = has('plain')
  ? buildGlyphGeometry(font, LETTER, 1, {
      ...DEFAULT_GLYPH_OPTIONS,
      depth: D,
      bevelSize: OUTER,
      bevelThickness: OUTER_T,
    })
  : null;

// ---------------------------------------------------------------------------------------------
// What a render cannot say.

/**
 * A hand-built shell is either closed or it is not, and nothing in a render distinguishes a missing
 * cap from a dark one. Every edge of a closed surface is walked once in each direction.
 */
function openEdges() {
  const seen = new Map();
  const key = (i) => `${pos[i].toFixed(9)},${pos[i + 1].toFixed(9)},${pos[i + 2].toFixed(9)}`;
  for (let i = 0; i < pos.length; i += 9) {
    const v = [key(i), key(i + 3), key(i + 6)];
    for (let e = 0; e < 3; e++) {
      const a = v[e];
      const b = v[(e + 1) % 3];
      if (a === b) continue;
      seen.set(`${a}|${b}`, (seen.get(`${a}|${b}`) ?? 0) + 1);
    }
  }
  let open = 0;
  const where = new Map();
  for (const [edge, n] of seen) {
    const [a, b] = edge.split('|');
    if (n === (seen.get(`${b}|${a}`) ?? 0)) continue;
    open++;
    const z = a.split(',')[2];
    where.set(z, (where.get(z) ?? 0) + 1);
  }
  if (open > 0 && process.env.HOLLOW_EDGES) {
    for (const [z, n] of [...where].sort((x, y) => y[1] - x[1]).slice(0, 8)) {
      console.log(`    z ${z}: ${n} open edges`);
    }
  }
  return open;
}

console.log(`"${LETTER}" — ${LEVELS.length} level(s), ${TOTAL} em of ${D} em hollowed out`);
console.log(
  `  ${D} em thick, chamfer ${OUTER} falling ${OUTER_T} on the outside, ` +
    `bead ${LIP} falling ${LIP_T} on every rim, ${SEGS} segments each`,
);
for (let i = 0; i < LEVELS.length; i++) {
  console.log(
    `  level ${i + 1}: inset ${LEVELS[i].inset}, floor z ${FLOORS[i].toFixed(4)}, ` +
      `${OUTLINES[i].length} region(s), ${RIM_RINGS[i].length} ring(s)`,
  );
}
const open = openEdges();
console.log(`  body ${body.getAttribute('position').count} verts, ${pos.length / 9} triangles`);
console.log(
  open === 0
    ? '  shell: closed — every edge walked once each way'
    : `  shell: ${open} edges walked only one way — there is a hole in it`,
);

const dump = (geo) => ({
  position: [...geo.getAttribute('position').array],
  normal: [...geo.getAttribute('normal').array],
});
const payload = { letter: LETTER, body: dump(plain ?? body), tilt: TILT };
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
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
page.on('console', (m) => m.type() === 'error' && console.log(`  [console] ${m.text()}`));
for (const look of arg('looks', 'gold').split(',')) {
  await page.goto(`${origin}/?look=${look}`);
  await page.waitForFunction(() => window.__shot === true, null, { timeout: 120_000 });
  const file = resolve(OUT, `hollow-${LETTER}-${look}.png`);
  writeFileSync(file, await page.screenshot());
  console.log(`  wrote ${file}`);
}
await browser.close();
server.close();
process.exit(0);
