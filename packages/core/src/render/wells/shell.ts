import * as THREE from 'three';
import { chamfered, DEFAULT_GLYPH_OPTIONS } from '../../text/glyphs.js';
import { type Field, isoContours, signedDistanceField } from '../tube/field.js';
import type { Cut } from './cutters.js';
import {
  fromPoints,
  type Nested,
  nest,
  orient,
  type Point,
  type Ring,
  resample,
  shrink,
  smooth,
  toPoints,
} from './rings.js';

/** Grid cells per side for the letter's own field, and the room left around its silhouette. */
const RESOLUTION = 512;
const PAD = 0.05;

/** How coarsely a level's outline is walked, in em. Below the field's own cell it is all staircase. */
const SPACING = 0.006;

/** How finely a glyph contour is sampled into the polygon the field rasterises. */
const SEGMENTS = 48;

export interface ShellOptions {
  /** The letter's full depth, slab plus plate. */
  depth: number;
  /** How far in from every contour a well stays, in em. Caps the back chamfer. */
  bezel: number;
  /** The bead around a well's rim, in em. Separate from the letter's own chamfer, which is why. */
  rimBevel: number;
  /** How far a rim's bead falls as it narrows, in em. */
  rimDrop: number;
  /** Bevel segments on both the letter's chamfer and every rim bead. */
  segments: number;
  /** Radius the reflex corners are rounded to — junctions between strokes, inside a counter. */
  round: number;
  /** Radius the convex corners are rounded to — outer corners, tips, a leg's point. */
  roundOuter: number;
}

export const DEFAULT_SHELL: Omit<ShellOptions, 'depth' | 'bezel'> = {
  rimBevel: 0.008,
  rimDrop: 0.008,
  segments: 3,
  round: 0,
  roundOuter: 0,
};

/**
 * One step of a bevel: how far the ring stands out from the plane's own outline, and how far it
 * sits from that plane. Both profiles below are the same quarter ellipse `ExtrudeGeometry` walks,
 * run in opposite directions, because a chamfer opens away from its cap and a bead opens toward it.
 */
interface Step {
  out: number;
  dz: number;
}

/** The letter's own edge: flush with the cap at `k = 0`, standing `size` proud at the wall. */
const chamferSteps = (size: number, thick: number, segs: number): Step[] =>
  Array.from({ length: segs + 1 }, (_, k) => {
    const t = k / segs;
    return {
      out: size * Math.sin((t * Math.PI) / 2),
      dz: thick * (1 - Math.cos((t * Math.PI) / 2)),
    };
  });

/** A well's rim: `size` wider than the pocket at the face, back to the pocket `thick` below it. */
const beadSteps = (size: number, thick: number, segs: number): Step[] =>
  Array.from({ length: segs + 1 }, (_, k) => {
    const t = k / segs;
    return { out: size * Math.cos((t * Math.PI) / 2), dz: thick * Math.sin((t * Math.PI) / 2) };
  });

const clean = (ring: Ring): Ring => smooth(resample(ring, SPACING), 3);

/** The glyph's rings as one field. */
function fieldOf(rings: Ring[]): Field {
  return signedDistanceField(rings.map(toPoints), { resolution: RESOLUTION, pad: PAD });
}

/** The metal at one iso level, as regions — negative erodes it, positive grows it. */
function metalAt(field: Field, level: number): Nested[] {
  return nest(isoContours(field, level).map((r) => clean(fromPoints(r)))).map((poly) => ({
    outer: orient(poly[0] as Ring, true),
    holes: poly.slice(1).map((h) => orient(h, false)),
  }));
}

const flatten = (regions: Nested[]): Ring[] => regions.flatMap((g) => [g.outer, ...g.holes]);

/**
 * A radius rolled along the outline, which rounds a corner without having to find one. Growing the
 * metal and shrinking it back fills every reflex corner to the radius and leaves the convex ones;
 * the other order rounds the convex ones instead.
 *
 * It cannot be done by shifting one field's levels. The distance field of a grown shape equals the
 * original minus the radius only on the outside, and the inside is exactly where a filled corner
 * changes which edge is nearest — so each half rebuilds the field, and the radius is a real one.
 */
function roll(rings: Ring[], r: number, outward: boolean): Ring[] {
  const grown = flatten(metalAt(fieldOf(rings), outward ? r : -r));
  return flatten(metalAt(fieldOf(grown), outward ? -r : r));
}

/** Every directed edge walked once in each direction, which is the only check a render cannot make. */
export function openEdges(position: Float32Array): number {
  // Quantised, not printed. Two vertices meant to coincide can differ by float noise — the plane
  // where the back chamfer meets the wall lands on -1e-18 from one side and 0 from the other,
  // because `1 - Math.cos(PI / 2)` is not 1 — and `toFixed` keeps that sign, so every edge across
  // the plane hashes two ways and reads as open. A micro-em is far below anything geometric here.
  const fix = (v: number) => Math.round(v * 1e6);
  const key = (i: number) =>
    `${fix(position[i] as number)},${fix(position[i + 1] as number)},${fix(position[i + 2] as number)}`;
  const seen = new Map<string, number>();
  for (let i = 0; i < position.length; i += 9) {
    const v = [key(i), key(i + 3), key(i + 6)];
    for (let e = 0; e < 3; e++) {
      const a = v[e] as string;
      const b = v[(e + 1) % 3] as string;
      if (a === b) continue;
      seen.set(`${a}|${b}`, (seen.get(`${a}|${b}`) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const [edge, n] of seen) {
    const [a, b] = edge.split('|');
    if (n === (seen.get(`${b}|${a}`) ?? 0)) continue;
    open++;
  }
  return open;
}

/** Accumulates triangles; every face in the shell is pushed through one of the three writers. */
class Skin {
  readonly pos: number[] = [];

  tri(a: readonly number[], b: readonly number[], c: readonly number[]): void {
    this.pos.push(
      a[0] as number,
      a[1] as number,
      a[2] as number,
      b[0] as number,
      b[1] as number,
      b[2] as number,
      c[0] as number,
      c[1] as number,
      c[2] as number,
    );
  }

  /**
   * A quad strip between two rings that need not correspond. Both are walked by their own arc
   * length and whichever is behind advances, so the strip closes whatever the point counts are.
   *
   * That is what lets every ring come off the field. A miter keeps the point count and so cannot
   * survive being asked for more than a corner's own radius — past that the offset has to invert.
   * An iso-contour never folds; it just does not correspond, and this is the correspondence.
   */
  stitch(lower: Ring, zLo: number, upper: Ring, zHi: number): void {
    const na = lower.length;
    const nb = upper.length;
    if (na < 3 || nb < 3) return;
    const arc = (ring: Ring): number[] => {
      const t = [0];
      for (let i = 1; i <= ring.length; i++) {
        const p = ring[i - 1] as Point;
        const q = ring[i % ring.length] as Point;
        t.push((t[i - 1] as number) + Math.hypot(q[0] - p[0], q[1] - p[1]));
      }
      const total = (t[t.length - 1] as number) || 1;
      return t.map((v) => v / total);
    };
    // Two iso levels start wherever marching squares happened to start them; without this the
    // strip is built with a twist in it and every quad crosses the letter.
    let off = 0;
    let best = Number.POSITIVE_INFINITY;
    const head = lower[0] as Point;
    for (let k = 0; k < nb; k++) {
      const u = upper[k] as Point;
      const d = Math.hypot(u[0] - head[0], u[1] - head[1]);
      if (d < best) {
        best = d;
        off = k;
      }
    }
    const b = upper.slice(off).concat(upper.slice(0, off));
    const ta = arc(lower);
    const tb = arc(b);
    const A = (i: number) => {
      const p = lower[i % na] as Point;
      return [p[0], p[1], zLo];
    };
    const B = (j: number) => {
      const p = b[j % nb] as Point;
      return [p[0], p[1], zHi];
    };
    let i = 0;
    let j = 0;
    while (i < na || j < nb) {
      if (j >= nb || (i < na && (ta[i + 1] as number) <= (tb[j + 1] as number))) {
        this.tri(A(i), A(i + 1), B(j));
        i++;
      } else {
        this.tri(A(i), B(j + 1), B(j));
        j++;
      }
    }
  }

  /**
   * A flat face. Its facing is asserted per triangle rather than inherited from ring order: a lid
   * facing into the solid is invisible and reads as a missing cap, which is a long way to chase
   * for a sign flip.
   */
  cap(contour: Ring, holes: Ring[], z: number, up: boolean): void {
    const c = contour.map(([x, y]) => new THREE.Vector2(x, y));
    const hs = holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y)));
    const faces = THREE.ShapeUtils.triangulateShape(c, hs);
    const all = [c, ...hs].flat();
    for (const face of faces) {
      const a = all[face[0] as number] as THREE.Vector2;
      const b = all[face[1] as number] as THREE.Vector2;
      const d = all[face[2] as number] as THREE.Vector2;
      const ccw = (b.x - a.x) * (d.y - a.y) - (d.x - a.x) * (b.y - a.y) > 0;
      const p = (v: THREE.Vector2) => [v.x, v.y, z];
      if (ccw === up) this.tri(p(a), p(b), p(d));
      else this.tri(p(d), p(b), p(a));
    }
  }

  /** A flat face from every ring that lands on its plane, nested by containment. */
  capPlane(rings: Ring[], z: number, up: boolean): void {
    for (const group of nest(rings)) this.cap(group[0] as Ring, group.slice(1), z, up);
  }
}

/**
 * Which ring of one level answers which of the next.
 *
 * Two iso levels of the same letter run parallel, so a ring is answered by the one nearest it that
 * is also about the same size and going the same way round — a hole and an outline wind opposite
 * ways and can never be each other. Centroid alone is not enough, and an O is why: its outline and
 * its counter share a centre, so whichever came out marginally closer won and the outline of one
 * level was stitched to the counter of the next, which is a sheet of quads across the counter.
 * Cheapest pair first, so one ring's near miss cannot push every ring after it onto the wrong one.
 */
export function pair(a: Ring[], b: Ring[]): [Ring, Ring][] | null {
  if (a.length !== b.length) return null;
  const of = (ring: Ring) => {
    let x = 0;
    let y = 0;
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const p = ring[i] as Point;
      const q = ring[j] as Point;
      x += p[0];
      y += p[1];
      area += q[0] * p[1] - p[0] * q[1];
    }
    return { x: x / ring.length, y: y / ring.length, area: area / 2 };
  };
  const ma = a.map(of);
  const mb = b.map(of);
  /** As a radius, so it is in em and adds to a distance rather than dwarfing it. */
  const radius = (m: { area: number }) => Math.sqrt(Math.abs(m.area) / Math.PI);
  const costs: [number, number, number][] = [];
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      const mi = ma[i] as { x: number; y: number; area: number };
      const mj = mb[j] as { x: number; y: number; area: number };
      const turn = Math.sign(mi.area) !== Math.sign(mj.area) ? 1e3 : 0;
      const gap = Math.hypot(mi.x - mj.x, mi.y - mj.y);
      costs.push([gap + Math.abs(radius(mi) - radius(mj)) + turn, i, j]);
    }
  }
  costs.sort((p, q) => p[0] - q[0]);
  const from = new Set<number>();
  const to = new Set<number>();
  const out: [Ring, Ring][] = [];
  for (const [cost, i, j] of costs) {
    if (from.has(i) || to.has(j) || cost >= 1e3) continue;
    from.add(i);
    to.add(j);
    out.push([a[i] as Ring, b[j] as Ring]);
  }
  return out.length === a.length ? out : null;
}

/**
 * The two planes a fill has to sit between, and where the shell puts its own faces.
 *
 * The names are the plate's, and the front face and floor are exactly where the extruded plate had
 * them, so a fill written against `platePlanes` still lands. What differs is between them: the
 * plate's own wells were bevelled at the letter's chamfer, which folds a small hole through itself.
 */
export function shellPlanes(depth: number, floor: number, bezel: number) {
  const full = DEFAULT_GLYPH_OPTIONS.bevelSize;
  const slabDepth = Math.max(depth - floor, 0);
  const slabBevel = Math.min(full, bezel);
  const slabBevelZ = (DEFAULT_GLYPH_OPTIONS.bevelThickness * slabBevel) / full;
  return {
    slabDepth,
    slabBevel,
    slabBevelZ,
    backZ: -slabBevelZ,
    floorZ: slabDepth + slabBevelZ,
    faceZ: depth + DEFAULT_GLYPH_OPTIONS.bevelThickness,
  };
}

/**
 * A letter carved with wells, stitched ring by ring rather than extruded.
 *
 * Every ring in the outer skin is an iso-contour of the letter's own distance field at the level
 * that ring sits at, so nothing is offset and nothing can fold. The wells come from the cutter,
 * because only it knows where they are; their rim beads come from the cutter too when it can
 * re-derive them, and are shrunk here when it cannot.
 */
export function buildShell(
  shapes: readonly THREE.Shape[],
  cut: Cut,
  opts: ShellOptions,
): THREE.BufferGeometry {
  const full = DEFAULT_GLYPH_OPTIONS.bevelSize;
  const planes = shellPlanes(opts.depth, cut.floor, opts.bezel);
  const skin = new Skin();

  let rings: Ring[] = [];
  for (const shape of chamfered(shapes as THREE.Shape[], DEFAULT_GLYPH_OPTIONS)) {
    rings.push(orient(fromPoints(shape.getPoints(SEGMENTS)), true));
    for (const hole of shape.holes) {
      rings.push(orient(fromPoints(hole.getPoints(SEGMENTS)), false));
    }
  }
  if (opts.round > 0) rings = roll(rings, opts.round, true);
  if (opts.roundOuter > 0) rings = roll(rings, opts.roundOuter, false);
  const field = fieldOf(rings);

  // The straight wall is the glyph grown by the letter's own chamfer, and each cap is the glyph
  // itself — which is the silhouette `ExtrudeGeometry` produces, without the doubled band that
  // stacking a bevelled slab and a bevelled plate put down the letter's side.
  const front = chamferSteps(full, DEFAULT_GLYPH_OPTIONS.bevelThickness, opts.segments);
  const back = chamferSteps(planes.slabBevel, planes.slabBevelZ, opts.segments);
  const skinAt = (out: number) => flatten(metalAt(field, out));

  const frontRings = front.map((s) => skinAt(s.out));
  const backRings = back.map((s) => skinAt(full - planes.slabBevel + s.out));
  const wallLo = planes.backZ + planes.slabBevelZ;
  const wallHi = planes.faceZ - (front[front.length - 1] as Step).dz;

  const run = (levels: Ring[][], zAt: (k: number) => number) => {
    for (let k = 0; k < levels.length - 1; k++) {
      const pairs = pair(levels[k] as Ring[], levels[k + 1] as Ring[]);
      if (pairs === null) {
        throw new Error(
          `klieg: a shell band has ${(levels[k] as Ring[]).length} ring(s) below and ` +
            `${(levels[k + 1] as Ring[]).length} above — a stroke closed up or split between them`,
        );
      }
      for (const [lo, hi] of pairs) skin.stitch(lo, zAt(k), hi, zAt(k + 1));
    }
  };

  // Back cap, up its chamfer, straight to the front chamfer, and in to the front face.
  run(backRings, (k) => planes.backZ + (back[k] as Step).dz);
  const wall = backRings[backRings.length - 1] as Ring[];
  const top = frontRings[frontRings.length - 1] as Ring[];
  const pairsUp = pair(wall, top);
  if (pairsUp === null) throw new Error('klieg: the letter’s two chamfers disagree on rings');
  for (const [lo, hi] of pairsUp) skin.stitch(lo, wallLo, hi, wallHi);
  run([...frontRings].reverse(), (k) => planes.faceZ - (front[front.length - 1 - k] as Step).dz);

  // The wells: the rim bead narrowing away from the face, then a straight wall down to the floor.
  const bead = beadSteps(opts.rimBevel, opts.rimDrop, opts.segments);
  const beads = pocketBeads(cut, bead);
  const rim = beads.map((steps) => steps[0] as Ring);
  const seat = beads.map((steps) => steps[steps.length - 1] as Ring);
  for (const steps of beads) {
    for (let k = 0; k < steps.length - 1; k++) {
      skin.stitch(
        steps[k + 1] as Ring,
        planes.faceZ - (bead[k + 1] as Step).dz,
        steps[k] as Ring,
        planes.faceZ - (bead[k] as Step).dz,
      );
    }
  }
  const seatZ = planes.faceZ - (bead[bead.length - 1] as Step).dz;
  for (const ring of seat) skin.stitch(ring, planes.floorZ, ring, seatZ);

  skin.capPlane(backRings[0] as Ring[], planes.backZ, false);
  skin.capPlane([...(frontRings[0] as Ring[]), ...rim], planes.faceZ, true);
  skin.capPlane(seat, planes.floorZ, true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(skin.pos), 3));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  return geo;
}

/**
 * Each well as the rings its bead steps through, widest at the face and the well's own outline at
 * the floor. The cutter supplies these when it can re-derive its pockets; a convex pocket is shrunk
 * here instead, which is exact for one and wrong for a clipped cell.
 */
function pocketBeads(cut: Cut, bead: Step[]): Ring[][] {
  const ring = (path: THREE.Path) => orient(fromPoints(path.getPoints(SEGMENTS)), false);
  if (cut.bead) return cut.bead.map((rings) => rings.map(ring));
  const out: Ring[][] = [];
  for (const well of cut.wells) {
    // Shrunk while wound metal-inside, because `shrink` reads its normals off the winding; a
    // negative distance then grows the pocket, which is what a bead does toward the face.
    const base = orient(fromPoints(well.getPoints(SEGMENTS)), true);
    const rings = bead
      .map((step) => shrink(base, -step.out))
      .filter((r) => r.length >= 3)
      .map((r) => orient(r, false));
    if (rings.length === bead.length) out.push(rings);
  }
  return out;
}
