/**
 * What else can a letter be inflated into, and which mesher builds the crown?
 *
 *   npm run build -w klieg && node spikes/inflate.mjs [--letter R] [--out dir]
 *
 * Everything klieg draws is one linear push along z with a bevel at each end. The wells-and-fills
 * model says what to carve out of a solid and never says how the solid got its shape, so this is
 * the other half: a profile that maps how deep inside the outline a point sits to how far it stands
 * proud. Today's flat cap is the profile `z = 0`.
 *
 * The distance is the tube pipeline's own signed distance field, which is the point — the machinery
 * for "how far inside the letter is this" already ships, and an inflation is a function of it.
 *
 * The profile was never the open question; the mesher is. Three build the same crown here:
 *
 *   heightfield  a grid over the field, a quad where all four corners are solid. The prototype.
 *   cap          the extruder's own lid, refined where a chord misses the profile, displaced.
 *   rings        the profile read as level sets: iso-contours at successive insets, banded.
 *
 * All three replace the lid rather than floating over it, and all three take their profile from a
 * field built on the lid's own boundary — so a crown meets the bevel where the flat cap did, and
 * the three are comparable.
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import { chromium } from 'playwright';
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
const OUT = resolve(arg('out', resolve(HERE, 'inflate-out')));
const RESOLUTION = Number(arg('resolution', '384'));
/** How far in from the lid's edge the inflation reaches full height, in em. */
const REACH = Number(arg('reach', '0.09'));
/** How far the crown stands above the flat cap, in em. */
const RISE = Number(arg('rise', '0.1'));
/** Chord-to-profile error a refined cap triangle is allowed, in em. */
const TOL = Number(arg('tol', '0.002'));
/** Level count for the ring mesher, and the arc error a decimated ring is allowed. */
const LEVELS = Number(arg('levels', '20'));
const RING_TOL = Number(arg('ringTol', '0.0012'));
/** The front face, which the bevel carries `bevelThickness` beyond the extrusion's own depth. */
const TOP = DEFAULT_GLYPH_OPTIONS.depth + DEFAULT_GLYPH_OPTIONS.bevelThickness;

/**
 * Each profile takes `t`, the fraction of `REACH` a point sits inside the lid's edge, and answers
 * how far above the flat cap it stands. `flat` is what ships.
 */
const PROFILES = {
  flat: () => 0,
  pillow: (t) => Math.sqrt(Math.max(0, 1 - (1 - t) ** 2)),
  dome: (t) => Math.sin((Math.PI * t) / 2),
  ridge: (t) => t,
  /** `pillow`'s look with a finite slope where it meets the cap — see the sweep's cost on each. */
  cushion: (t) => t * t * (3 - 2 * t),
};

const buf = readFileSync(resolve(ROOT, 'apps/lab/public/font.ttf'));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const shapes = glyphToShapes(font, LETTER, 1);

// ---------------------------------------------------------------------------------------------
// The body, and the lid we are replacing.

const EXTRUDE = { ...DEFAULT_GLYPH_OPTIONS, bevelEnabled: true, bevelOffset: 0 };
const solid = new THREE.ExtrudeGeometry(shapes, EXTRUDE);
solid.computeVertexNormals();

/**
 * The extruder is non-indexed and lays its lid faces down with the walls; a triangle is the front
 * lid when it faces +z and sits flat against the front plane. Splitting on geometry rather than on
 * buffer order survives a change in how three orders its groups.
 */
function splitLid(geo) {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const lid = [];
  const rest = { position: [], normal: [] };
  for (let t = 0; t < pos.count; t += 3) {
    const flat = [0, 1, 2].every((k) => Math.abs(pos.getZ(t + k) - TOP) < 1e-6);
    const facing = [0, 1, 2].every((k) => nrm.getZ(t + k) > 0.999);
    if (flat && facing) {
      lid.push([0, 1, 2].map((k) => ({ x: pos.getX(t + k), y: pos.getY(t + k) })));
      continue;
    }
    for (let k = 0; k < 3; k++) {
      rest.position.push(pos.getX(t + k), pos.getY(t + k), pos.getZ(t + k));
      rest.normal.push(nrm.getX(t + k), nrm.getY(t + k), nrm.getZ(t + k));
    }
  }
  return { lid, rest };
}

const { lid: lidTris, rest: bodyDump } = splitLid(solid);
if (lidTris.length === 0) throw new Error('no lid triangles found — check the extrude options');

/** Weld the lid's soup into an indexed mesh, so an edge can be split once for both its faces. */
const key = (p) => `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;
const lidPoints = [];
const lidIndex = new Map();
const idOf = (p) => {
  const k = key(p);
  let id = lidIndex.get(k);
  if (id === undefined) {
    id = lidPoints.length;
    lidPoints.push({ x: p.x, y: p.y });
    lidIndex.set(k, id);
  }
  return id;
};
const lidFaces = lidTris.map((tri) => tri.map(idOf));

/** The lid's outline: every edge used by exactly one triangle, chained into closed rings. */
function boundaryRings(points, faces) {
  const seen = new Map();
  for (const [a, b, c] of faces) {
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const k = u < v ? `${u},${v}` : `${v},${u}`;
      if (seen.has(k)) seen.delete(k);
      else seen.set(k, [u, v]);
    }
  }
  const next = new Map();
  for (const [u, v] of seen.values()) next.set(u, v);
  const rings = [];
  const used = new Set();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const ring = [];
    let at = start;
    while (at !== undefined && !used.has(at)) {
      used.add(at);
      ring.push(points[at]);
      at = next.get(at);
    }
    if (ring.length > 2) rings.push(ring);
  }
  return rings;
}

const capRings = boundaryRings(lidPoints, lidFaces);

/**
 * The profile's field is built on the lid's edge, not on the glyph's outline. The lid is already
 * inset by the bevel, so measuring from the outline lifts the crown's rim off the bevel it is
 * supposed to meet — a step all the way around the letter, and the one thing every mesher here
 * would have shared.
 */
const field = signedDistanceField(capRings, { resolution: RESOLUTION, pad: 0.05 });

/** Bilinear, unlike `Field.sample`, which rounds — a nearest sample stairsteps the crown. */
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

const heightAt = (profile, x, y) =>
  TOP + RISE * profile(Math.min(Math.max(-depthAt(x, y) / REACH, 0), 1));

/** Exact distance from a point to the lid's edge — the rim gap, free of the field's cell wobble. */
function distanceToRings(x, y) {
  let best = Number.POSITIVE_INFINITY;
  for (const ring of capRings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j];
      const b = ring[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1e-24;
      const t = Math.min(Math.max(((x - a.x) * dx + (y - a.y) * dy) / len2, 0), 1);
      best = Math.min(best, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)));
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// The three meshers. Each answers { position, index } over the lid's footprint.

/**
 * Today's prototype: a grid over the field, dropping any cell the boundary crosses. `stride`
 * coarsens the mesh without touching the field, so what the sweep varies is mesh density and not
 * how well the profile itself is known.
 */
function heightfield(profile, stride = 1) {
  const { size, data, emPerCell, originX, originY } = field;
  const index = new Int32Array(size * size).fill(-1);
  const position = [];
  for (let gy = 0; gy < size; gy += stride) {
    for (let gx = 0; gx < size; gx += stride) {
      if (data[gy * size + gx] >= 0) continue;
      const x = originX + gx * emPerCell;
      const y = originY + gy * emPerCell;
      index[gy * size + gx] = position.length / 3;
      position.push(x, y, heightAt(profile, x, y));
    }
  }
  const indices = [];
  for (let gy = 0; gy + stride < size; gy += stride) {
    for (let gx = 0; gx + stride < size; gx += stride) {
      const a = index[gy * size + gx];
      const b = index[gy * size + gx + stride];
      const c = index[(gy + stride) * size + gx + stride];
      const e = index[(gy + stride) * size + gx];
      if (a < 0 || b < 0 || c < 0 || e < 0) continue;
      indices.push(a, b, c, a, c, e);
    }
  }
  return { position, index: indices, converged: true };
}

/**
 * The extruder's own lid, refined where a triangle's chord misses the profile by more than `TOL`,
 * then displaced. Red-green: a face with two marked edges gets its third marked, which runs to a
 * fixpoint and leaves every face splitting on 0, 1 or 3 — so the mesh stays conforming.
 */
function cap(profile, tol = TOL) {
  const points = lidPoints.map((p) => ({ ...p }));
  let faces = lidFaces.map((f) => [...f]);
  const z = (p) => heightAt(profile, p.x, p.y);
  const ek = (u, v) => (u < v ? `${u},${v}` : `${v},${u}`);
  let converged = false;

  for (let pass = 0; pass < 12; pass++) {
    const marked = new Set();
    for (const [a, b, c] of faces) {
      for (const [u, v] of [
        [a, b],
        [b, c],
        [c, a],
      ]) {
        const k = ek(u, v);
        if (marked.has(k)) continue;
        const p = points[u];
        const q = points[v];
        const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        if (Math.abs(z(mid) - (z(p) + z(q)) / 2) > tol) marked.add(k);
      }
    }
    if (marked.size === 0) {
      converged = true;
      break;
    }

    // To a fixpoint, not to an iteration budget: marking a face's third edge can put a neighbour
    // at two, and a face left at two splits one edge while its neighbour splits another — a
    // T-junction, which reads downstream as a torn mesh rather than as a refinement bug.
    for (let grew = true; grew; ) {
      grew = false;
      for (const [a, b, c] of faces) {
        const es = [ek(a, b), ek(b, c), ek(c, a)];
        if (es.filter((k) => marked.has(k)).length !== 2) continue;
        for (const k of es) {
          if (!marked.has(k)) {
            marked.add(k);
            grew = true;
          }
        }
      }
    }

    const mids = new Map();
    const midOf = (u, v) => {
      const k = ek(u, v);
      let id = mids.get(k);
      if (id === undefined) {
        id = points.length;
        points.push({ x: (points[u].x + points[v].x) / 2, y: (points[u].y + points[v].y) / 2 });
        mids.set(k, id);
      }
      return id;
    };
    const out = [];
    for (const [a, b, c] of faces) {
      const es = [
        [a, b],
        [b, c],
        [c, a],
      ];
      const on = es.map(([u, v]) => marked.has(ek(u, v)));
      const count = on.filter(Boolean).length;
      if (count === 0) {
        out.push([a, b, c]);
      } else if (count === 3) {
        const ab = midOf(a, b);
        const bc = midOf(b, c);
        const ca = midOf(c, a);
        out.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
      } else {
        if (count !== 1) throw new Error(`closure left a face with ${count} marked edges`);
        const [u, v] = es[on.indexOf(true)];
        const w = [a, b, c].find((p) => p !== u && p !== v);
        const m = midOf(u, v);
        out.push([u, m, w], [m, v, w]);
      }
    }
    faces = out;
  }

  const position = [];
  for (const p of points) position.push(p.x, p.y, z(p));
  return { position, index: faces.flat(), converged };
}

/**
 * A ring with no repeated closing vertex. `isoContours` closes its polylines by repeating the first
 * point and the lid's rings do not; the zero-length edge that leaves is degenerate to earcut, which
 * answers triangles outside the contour rather than failing.
 */
function open(ring) {
  const last = ring[ring.length - 1];
  return Math.hypot(ring[0].x - last.x, ring[0].y - last.y) < 1e-9 ? ring.slice(0, -1) : ring;
}

/** Douglas-Peucker on a closed ring, so a marching-squares contour is not carried at grid density. */
function decimate(ring, tol) {
  const n = ring.length;
  if (n < 8) return ring;
  const keep = new Uint8Array(n);
  const half = Math.floor(n / 2);
  keep[0] = 1;
  keep[half] = 1;
  keep[n - 1] = 1;
  const stack = [
    [0, half],
    [half, n - 1],
  ];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const p = ring[a];
    const q = ring[b];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1e-12;
    let best = -1;
    let bestD = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((ring[i].x - p.x) * dy - (ring[i].y - p.y) * dx) / len;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0 || bestD <= tol) continue;
    keep[best] = 1;
    stack.push([a, best], [best, b]);
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(ring[i]);
  return out.length > 2 ? out : ring;
}

const inside = (ring, p) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      hit = !hit;
    }
  }
  return hit;
};

/**
 * Group a set of rings into contours and their holes by containment depth. Consecutive level sets
 * nest strictly, so even-odd is exactly the band between them — and a counter needs no special
 * case, because the field already treats it as boundary.
 */
function nest(rings) {
  const depth = rings.map((r, i) =>
    rings.reduce((n, other, j) => (i !== j && inside(other, r[0]) ? n + 1 : n), 0),
  );
  const parent = rings.map((r, i) => {
    let best = -1;
    for (let j = 0; j < rings.length; j++) {
      if (i === j || !inside(rings[j], r[0])) continue;
      if (best === -1 || depth[j] > depth[best]) best = j;
    }
    return best;
  });
  return rings
    .map((ring, i) => ({ ring, i }))
    .filter(({ i }) => depth[i] % 2 === 0)
    .map(({ ring, i }) => ({
      contour: ring,
      holes: rings.filter((_, j) => depth[j] % 2 === 1 && parent[j] === i),
    }));
}

/**
 * The profile read as rings: iso-contours at successive insets, each band triangulated flat and
 * carried at its own two heights. The outermost ring is the lid's own edge rather than a contour of
 * the field, so the crown welds to the bevel exactly.
 */
function rings(profile, levels = LEVELS, ringTol = RING_TOL) {
  const position = [];
  const index = [];
  const push = (p, h) => {
    position.push(p.x, p.y, h);
    return position.length / 3 - 1;
  };
  // `--space height` puts the levels at equal steps of z rather than of depth, which is the obvious
  // way to bound the error by one step whatever the slope does — and it does not work. A profile
  // steep at the rim wants its first levels closer together than the field can tell apart
  // (`pillow`'s first thirty-second of rise is 0.00004 em of depth against a 0.0021 em cell), so
  // the contours cross, the nesting inverts, and the crown tears. Kept as a flag because the next
  // person to look at this will propose it.
  const depthOf = (h) => {
    if (Math.abs(profile(1) - profile(0)) < 1e-12) return -(h * REACH);
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (profile(mid) < h) lo = mid;
      else hi = mid;
    }
    return -((lo + hi) / 2) * REACH;
  };
  const byHeight = arg('space', 'depth') === 'height';
  const depths = [];
  for (let k = 0; k <= levels; k++) {
    depths.push(byHeight ? depthOf(k / levels) : -(k / levels) * REACH);
  }
  // Decimation has to stay well inside the level spacing. Simplify by more than the levels are
  // apart and neighbouring rings cross, which puts one inside the other and inverts the nesting.
  let closest = REACH;
  for (let k = 1; k <= levels; k++) closest = Math.min(closest, depths[k - 1] - depths[k]);
  const tol = Math.min(ringTol, closest / 4);
  const levelRings = [];
  for (let k = 0; k <= levels; k++) {
    const raw = k === 0 ? capRings : isoContours(field, depths[k]);
    levelRings.push(raw.map((r) => decimate(open(r), tol)).filter((r) => r.length > 2));
  }
  if (has('verbose')) {
    console.log(`    rings: levels ${levels}`);
    levelRings.forEach((rs, k) => {
      const facts = rs.map((r) => {
        const closed = Math.hypot(r[0].x - r[r.length - 1].x, r[0].y - r[r.length - 1].y) < 1e-9;
        const seen = new Set(r.map((p) => `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`));
        return `${r.length}${closed ? 'c' : 'OPEN'}${seen.size < r.length - (closed ? 1 : 0) ? `/dup${r.length - seen.size}` : ''}`;
      });
      console.log(
        `      level ${k} d=${(-(k / levels) * REACH).toFixed(4)} ` +
          `${rs.length} rings: ${facts.join(' ') || '-'}`,
      );
    });
  }

  const band = (outer, inner, hOuter, hInner) => {
    const heights = new Map();
    for (const r of outer) heights.set(r, hOuter);
    for (const r of inner) heights.set(r, hInner);
    for (const { contour, holes } of nest([...outer, ...inner])) {
      const cv = contour.map((p) => new THREE.Vector2(p.x, p.y));
      const hv = holes.map((h) => h.map((p) => new THREE.Vector2(p.x, p.y)));
      const hs = [
        ...cv.map(() => heights.get(contour)),
        ...holes.flatMap((h) => h.map(() => heights.get(h))),
      ];
      const ids = [...cv, ...hv.flat()].map((p, i) => push(p, hs[i]));
      for (const tri of THREE.ShapeUtils.triangulateShape(cv, hv)) {
        index.push(ids[tri[0]], ids[tri[1]], ids[tri[2]]);
      }
    }
  };

  for (let k = 0; k < levels; k++) {
    if (levelRings[k].length === 0) continue;
    band(
      levelRings[k],
      levelRings[k + 1],
      TOP + RISE * profile(-depths[k] / REACH),
      TOP + RISE * profile(-depths[k + 1] / REACH),
    );
  }
  // The plateau: everything deeper than REACH stands at full height.
  const deepest = levelRings[levels];
  if (deepest.length > 0) {
    const h = TOP + RISE * profile(1);
    for (const { contour, holes } of nest(deepest)) {
      const cv = contour.map((p) => new THREE.Vector2(p.x, p.y));
      const hv = holes.map((r) => r.map((p) => new THREE.Vector2(p.x, p.y)));
      const ids = [...cv, ...hv.flat()].map((p) => push(p, h));
      for (const tri of THREE.ShapeUtils.triangulateShape(cv, hv)) {
        index.push(ids[tri[0]], ids[tri[1]], ids[tri[2]]);
      }
    }
  }
  return { position, index, converged: true };
}

const MESHERS = { heightfield, cap, rings };
/** Each mesher's own quality knob, coarse to fine — what a sweep varies to price its error. */
const KNOBS = {
  heightfield: [6, 4, 3, 2, 1],
  cap: [0.008, 0.004, 0.002, 0.001, 0.0005],
  rings: [5, 8, 12, 20, 32],
};

// ---------------------------------------------------------------------------------------------
// What separates them.

/**
 * Where the crown's own edge lands against the lid's, and how far a triangle's flat face sits from
 * the profile it stands for. The first is what "the bevel shows through the rim" measures; the
 * second is what buying vertices is supposed to buy.
 */
function measure(profile, { position, index }) {
  // Welded by position, not by index: a ring mesher pushes its own copy of each level, so counting
  // raw indices reports every band seam as an open edge and the rim as the deepest level.
  const weld = new Map();
  const at = new Int32Array(position.length / 3);
  for (let i = 0; i < at.length; i++) {
    const k = `${Math.round(position[i * 3] * 1e6)},${Math.round(position[i * 3 + 1] * 1e6)},${Math.round(position[i * 3 + 2] * 1e6)}`;
    let id = weld.get(k);
    if (id === undefined) {
      id = weld.size;
      weld.set(k, id);
    }
    at[i] = id;
  }
  const used = new Map();
  for (let i = 0; i < index.length; i += 3) {
    for (const [u, v] of [
      [at[index[i]], at[index[i + 1]]],
      [at[index[i + 1]], at[index[i + 2]]],
      [at[index[i + 2]], at[index[i]]],
    ]) {
      const k = u < v ? `${u},${v}` : `${v},${u}`;
      used.set(k, (used.get(k) ?? 0) + 1);
    }
  }
  const open = new Set();
  for (const [k, n] of used) {
    if (n === 1) for (const id of k.split(',')) open.add(id);
  }
  const byWeld = new Map();
  for (let i = 0; i < at.length; i++) byWeld.set(String(at[i]), i);
  // Against the lid's own rings, not against the field: the field only knows its zero level to
  // within a cell, which is the same size as the gap being measured.
  let rim = 0;
  for (const id of open) {
    const i = byWeld.get(id);
    rim = Math.max(rim, distanceToRings(position[i * 3], position[i * 3 + 1]));
  }
  let worst = 0;
  let where = null;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < index.length; i += 3) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < 3; k++) {
      const id = index[i + k];
      cx += position[id * 3] / 3;
      cy += position[id * 3 + 1] / 3;
      cz += position[id * 3 + 2] / 3;
    }
    const err = Math.abs(cz - heightAt(profile, cx, cy));
    if (err > worst) {
      worst = err;
      where = { x: cx, y: cy, z: cz, want: heightAt(profile, cx, cy), d: depthAt(cx, cy) };
    }
    sum += err * err;
    count++;
  }
  if (has('verbose') && where) {
    console.log(
      `    worst triangle at (${where.x.toFixed(4)}, ${where.y.toFixed(4)}) ` +
        `z ${where.z.toFixed(4)} want ${where.want.toFixed(4)} depth ${where.d.toFixed(4)} ` +
        `— ${open.size} open vertices of ${weld.size}`,
    );
  }
  return { rim, worst, rms: Math.sqrt(sum / Math.max(count, 1)) };
}

const dump = (geo) => ({
  position: [...geo.getAttribute('position').array],
  normal: [...geo.getAttribute('normal').array],
  index: geo.getIndex() ? [...geo.getIndex().array] : null,
});

const profileNames = arg('profiles', 'pillow,ridge').split(',');
const mesherNames = arg('meshers', 'heightfield,cap,rings').split(',');
console.log(`inflate: ${LETTER}, field ${RESOLUTION}, reach ${REACH}, rise ${RISE}`);
console.log(`  lid ${lidPoints.length} points, ${lidFaces.length} faces, ${capRings.length} rings`);

/**
 * What a mesher's vertices buy. One reading per mesher is not a comparison — each has its own
 * quality knob, and the question is what error it reaches at what cost, not where its default sits.
 */
if (has('sweep')) {
  const rows = [];
  let n = 0;
  const total = profileNames.length * mesherNames.length * 5;
  for (const pn of profileNames) {
    for (const mn of mesherNames) {
      for (const knob of KNOBS[mn]) {
        const started = Date.now();
        const built = MESHERS[mn](PROFILES[pn], knob);
        const stats = measure(PROFILES[pn], built);
        const row = {
          profile: pn,
          mesher: mn,
          knob,
          vertices: built.position.length / 3,
          triangles: built.index.length / 3,
          converged: built.converged,
          ...stats,
          ms: Date.now() - started,
        };
        rows.push(row);
        console.log(
          `  ${++n}/${total} ${pn.padEnd(7)} ${mn.padEnd(12)} knob ${String(knob).padStart(7)} ` +
            `${String(row.vertices).padStart(7)} verts  rim ${stats.rim.toFixed(5)}  ` +
            `err max ${stats.worst.toFixed(5)} rms ${stats.rms.toFixed(5)} ` +
            `(${((stats.rms / RISE) * 100).toFixed(2)}% of rise)` +
            `${built.converged ? '' : '  UNCONVERGED'}  ${row.ms}ms`,
        );
      }
    }
  }
  mkdirSync(OUT, { recursive: true });
  const file = resolve(OUT, `sweep-${LETTER}.json`);
  writeFileSync(file, JSON.stringify(rows, null, 2));
  console.log(`  wrote ${file}`);
  process.exit(0);
}

const cells = [];
let step = 0;
const total = profileNames.length * mesherNames.length;
for (const pn of profileNames) {
  for (const mn of mesherNames) {
    const started = Date.now();
    const built = MESHERS[mn](PROFILES[pn]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(built.position, 3));
    geo.setIndex(built.index);
    geo.computeVertexNormals();
    const stats = measure(PROFILES[pn], built);
    const vertices = built.position.length / 3;
    const triangles = built.index.length / 3;
    cells.push({ profile: pn, mesher: mn, vertices, triangles, ...stats, ...dump(geo) });
    geo.dispose();
    console.log(
      `  ${++step}/${total} ${pn.padEnd(7)} ${mn.padEnd(12)} ` +
        `${String(vertices).padStart(7)} verts ${String(triangles).padStart(7)} tris ` +
        `rim ${stats.rim.toFixed(5)} em  err max ${stats.worst.toFixed(5)} ` +
        `rms ${stats.rms.toFixed(5)} (${((stats.rms / RISE) * 100).toFixed(2)}% of rise) ` +
        `${Date.now() - started}ms`,
    );
  }
}

const payload = { letter: LETTER, body: bodyDump, rows: profileNames, cols: mesherNames, cells };
solid.dispose();

mkdirSync(OUT, { recursive: true });
writeFileSync(
  resolve(OUT, `inflate-${LETTER}.json`),
  JSON.stringify(
    cells.map(({ profile, mesher, vertices, triangles, rim, worst, rms }) => ({
      profile,
      mesher,
      vertices,
      triangles,
      rim,
      worst,
      rms,
    })),
    null,
    2,
  ),
);

if (has('no-render')) process.exit(0);

const TREES = {
  '/klieg/': resolve(ROOT, 'packages/core/dist'),
  '/three/': resolve(ROOT, 'node_modules/three/build'),
};
const FILES = {
  '/': [readFileSync(resolve(HERE, 'inflate.html')), 'text/html'],
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
// One column per shot by default: nine letters in one viewport render too small to judge, which is
// the whole reason to render at all.
const columns = has('grid') ? [null] : mesherNames;
const page = await browser.newPage({
  viewport: {
    width: 520 * (has('grid') ? mesherNames.length : 1),
    height: 380 * profileNames.length,
  },
  deviceScaleFactor: 2,
});
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
page.on('console', (m) => m.type() === 'error' && console.log(`  [console] ${m.text()}`));
const bloom = has('bloom') ? '1' : '0';
const fill = arg('fill', '2.2');
for (const look of arg('looks', 'chrome,gold').split(',')) {
  for (const column of columns) {
    const query = `look=${look}&bloom=${bloom}&fill=${fill}${column ? `&mesher=${column}` : ''}`;
    await page.goto(`${base}/?${query}`);
    await page.waitForFunction(() => window.__shot === true, null, { timeout: 120_000 });
    const file = resolve(OUT, `inflate-${LETTER}-${column ?? 'grid'}-${look}.png`);
    writeFileSync(file, await page.screenshot());
    console.log(`  wrote ${file}`);
  }
}
await browser.close();
server.close();
process.exit(0);
