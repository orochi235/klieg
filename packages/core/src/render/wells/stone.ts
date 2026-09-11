import * as THREE from 'three';
import type { WellSpec } from '../decoration.js';
import { applyLook } from '../looks.js';
import type { Seat } from './cutters.js';
// Types only, so `fills.ts` can import this module for value and register it without a cycle.
import type { Fill, FillContext, Filled } from './fills.js';
import { interiorPoint } from './pave.js';
import { area, insideRing } from './rings.js';
import { DEFAULT_SHELL } from './shell.js';

/** After the round brilliant: table width, crown height and pavilion depth over girdle width. */
const TABLE = 0.53;
const CROWN = 0.16;
const PAVILION = 0.43;

/** How far down the well's bevel the girdle sits, 0 at the letter's face and 1 below the collar. */
const SINK = 0.25;
/** Transmission thickness as a fraction of the girdle's width. */
const TINT = 0.5;
const FACETS = 8;

/**
 * A brilliant cut, flat-shaded so every facet catches its own highlight.
 *
 * The girdle's width and the height it sits at are one choice, not two: the shell beads every rim,
 * so a well is `half + rimBevel` wide at the plate's front and only `half` wide once the bead has
 * run out. `sink` moves the stone along that taper, and the radius follows. Seat it below the
 * collar and the stone sits in a pit with its crown under the letter's own surface, which reads as
 * a field of dimples rather than of stones.
 */
function brilliant(
  half: number,
  faceZ: number,
  sink: number,
  facets: number,
  rim: Rim,
): THREE.BufferGeometry {
  const girdleR = half + rim.bevel * (1 - sink);
  const girdleZ = faceZ - sink * rim.drop;
  const width = girdleR * 2;

  // Four girdle points sit on the seat's own corners; eight alternate corner and edge midpoint,
  // which is the largest octagon a diamond seat holds.
  const ring = (radius: number, z: number): THREE.Vector3[] => {
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < facets; i++) {
      const a = Math.PI / 2 + (i * 2 * Math.PI) / facets;
      const corner = facets === 4 || i % 2 === 0;
      const r = radius * (corner ? 1 : Math.SQRT1_2);
      out.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z));
    }
    return out;
  };
  const girdle = ring(girdleR, girdleZ);
  const table = ring(girdleR * TABLE, girdleZ + CROWN * width);
  const culet = new THREE.Vector3(0, 0, girdleZ - PAVILION * width);

  const position: number[] = [];
  const push = (...ps: THREE.Vector3[]) => {
    for (const p of ps) position.push(p.x, p.y, p.z);
  };
  for (let i = 0; i < facets; i++) {
    const j = (i + 1) % facets;
    push(girdle[i] as THREE.Vector3, girdle[j] as THREE.Vector3, table[j] as THREE.Vector3);
    push(girdle[i] as THREE.Vector3, table[j] as THREE.Vector3, table[i] as THREE.Vector3);
    push(girdle[j] as THREE.Vector3, girdle[i] as THREE.Vector3, culet);
  }
  for (let i = 1; i + 1 < facets; i++) {
    push(table[0] as THREE.Vector3, table[i] as THREE.Vector3, table[i + 1] as THREE.Vector3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  return geo;
}

/**
 * The plane a stone rides, fitted to what the crown did at each of its girdle's own points. Least
 * squares rather than a tangent at the centre, so a cell clipped to a stroke's edge is not tipped
 * by the one sample that happens to be furthest up the slope.
 */
function ride(
  ring: readonly (readonly [number, number])[],
  lift: ((x: number, y: number) => number) | undefined,
): ((x: number, y: number) => number) & { at: number[] } {
  const at = ring.map(([x, y]) => (lift ? lift(x, y) : 0));
  if (!lift) return Object.assign(() => 0, { at });
  const n = ring.length;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of ring) {
    cx += x / n;
    cy += y / n;
  }
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sxz = 0;
  let syz = 0;
  let sz = 0;
  for (let i = 0; i < n; i++) {
    const dx = (ring[i] as readonly [number, number])[0] - cx;
    const dy = (ring[i] as readonly [number, number])[1] - cy;
    const dz = at[i] as number;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
    sxz += dx * dz;
    syz += dy * dz;
    sz += dz / n;
  }
  const det = sxx * syy - sxy * sxy;
  // A degenerate ring — every point on one line — has no plane; it rides flat at its own mean.
  const gx = Math.abs(det) < 1e-18 ? 0 : (sxz * syy - syz * sxy) / det;
  const gy = Math.abs(det) < 1e-18 ? 0 : (syz * sxx - sxz * sxy) / det;
  return Object.assign((x: number, y: number) => sz + gx * (x - cx) + gy * (y - cy), { at });
}

/**
 * The taper a pocket's rim bead cuts: `bevel` wider at the face than at the bottom of the bead,
 * which is `drop` below it. Taken from the shell rather than from the glyph's own chamfer — the
 * body is stitched, not extruded, so the letter's 0.038 em chamfer never lands on a pocket.
 */
export interface Rim {
  bevel: number;
  drop: number;
}

/** The girdle's width, which the stone's own transmission thickness is scaled against. */
export function girdleWidth(half: number, sink: number, rim: Rim): number {
  return (half + rim.bevel * (1 - sink)) * 2;
}

/** How far a stone's table stands proud of the letter's own face, in em. */
const PROUD = 0.006;
/** How much of the room between girdle and floor a pavilion may use before it shallows. */
const ROOM = 0.94;

/**
 * One stone shaped by its own pocket, in the letter's space.
 *
 * Three rules, each a visible defect first. The crown's height is measured from the letter's face
 * rather than from the girdle, so every table lands on one plane however deep its own pocket sits —
 * deriving it from the cell's width instead sinks the narrow cells below the metal, and the narrow
 * cells are the ones at the edges. A pavilion with no room shallows rather than flattens, because a
 * stone sitting flat on its own floor reads as a tile in a hole. And both caps are triangulated
 * rather than fanned, shrunk toward the seat's point or a sampled interior one rather than the
 * centroid: a clipped cell is not convex, so a fan from one vertex throws triangles outside it.
 */
function setStone(seat: Seat, ctx: FillContext, into: number[]): boolean {
  const outline = seat.outline;
  if (!outline || outline.length < 3) return false;
  const ring = outline.map(([x, y]): [number, number] => [x + seat.x, y + seat.y]);
  // The seat's own point when it is in the pocket: a cutter that shaped a bent cell chose one the
  // whole cell can be seen from, and shrinking toward any other throws the table outside it.
  const c: [number, number] = insideRing(ring, seat.x, seat.y)
    ? [seat.x, seat.y]
    : interiorPoint(ring);
  if (!insideRing(ring, c[0], c[1])) return false;

  const width = Math.sqrt(area(ring));
  const crown = PROUD + Math.max(ctx.faceZ - ctx.girdleZ, 0);
  const drop = Math.min(PAVILION * width, (ctx.girdleZ - ctx.floorZ) * ROOM);

  /**
   * How far a crowned face carried this pocket. The girdle takes it point by point, so it is flush
   * with the metal whatever the metal is doing; the crown and the pavilion ride the plane through
   * those heights instead, because a gem sheared to follow a curve is a smear, not a stone.
   */
  const rode = ride(ring, ctx.lift);

  const at = (k: number, z: number) =>
    ring.map(([x, y]) => [
      c[0] + (x - c[0]) * k,
      c[1] + (y - c[1]) * k,
      z + rode(c[0] + (x - c[0]) * k, c[1] + (y - c[1]) * k),
    ]);
  const girdle = ring.map(([x, y], i) => [x, y, ctx.girdleZ + (rode.at[i] as number)]);
  const table = at(TABLE, ctx.girdleZ + crown);
  // A ring, not a point: the same reason the caps are triangulated.
  const culet = at(0.06, ctx.girdleZ - drop);

  const push = (...ps: number[][]) => {
    for (const p of ps) into.push(p[0] as number, p[1] as number, p[2] as number);
  };
  for (const [lower, upper] of [
    [girdle, table],
    [culet, girdle],
  ] as const) {
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      push(lower[i] as number[], lower[j] as number[], upper[j] as number[]);
      push(lower[i] as number[], upper[j] as number[], upper[i] as number[]);
    }
  }
  const faces = THREE.ShapeUtils.triangulateShape(
    ring.map(([x, y]) => new THREE.Vector2(x, y)),
    [],
  );
  for (const [a, b, d] of faces) {
    push(
      table[a as number] as number[],
      table[b as number] as number[],
      table[d as number] as number[],
    );
    push(
      culet[d as number] as number[],
      culet[b as number] as number[],
      culet[a as number] as number[],
    );
  }
  return true;
}

export const stone: Fill = (seats: readonly Seat[], ctx: FillContext, spec: WellSpec): Filled => {
  // A pocket the cutter shaped is its own stone's girdle, so there is nothing to instance: every
  // stone differs, and they are merged into one buffer instead. Still one draw call.
  if (seats[0]?.outline) {
    const position: number[] = [];
    for (const seat of seats) setStone(seat, ctx, position);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    const material = ctx.material();
    applyLook(material, spec.stone ?? 'gem');
    const width = seats.reduce((n, s) => n + s.half, 0) / (seats.length || 1);
    material.thickness = (spec.tint ?? TINT) * width * 2;
    return { geometry, matrices: [], material, placed: true };
  }

  const sink = spec.sink ?? SINK;
  const facets = spec.facets ?? FACETS;
  const half = spec.size / 2;
  // The drop comes back off the planes the plate was built on; the bead's width does not reach
  // them, so it is read from the same spec field the shell was handed.
  const rim: Rim = {
    bevel: spec.rimBevel ?? DEFAULT_SHELL.rimBevel,
    drop: Math.max(ctx.faceZ - ctx.girdleZ, 0),
  };
  const geometry = brilliant(half, ctx.faceZ, sink, facets, rim);

  const material = ctx.material();
  applyLook(material, spec.stone ?? 'gem');
  // `transmission` attenuates over `thickness` in world units, and the looks are tuned for a volume
  // the size of a letter. A stone is a twentieth of that, so inheriting the look's own thickness
  // absorbs nearly everything and the field renders as black holes in the plate.
  material.thickness = (spec.tint ?? TINT) * girdleWidth(half, sink, rim);

  // A whole diamond is rigid, so it rides its seat's own tangent plane: lifted by what the crown
  // did there, and sheared by the slope, which keeps the girdle in the metal on both sides.
  const step = half / 2;
  const matrices = seats.map((seat) => {
    const to = new THREE.Matrix4().makeTranslation(seat.x, seat.y, 0);
    if (!ctx.lift) return to;
    const lift = ctx.lift;
    const gx = (lift(seat.x + step, seat.y) - lift(seat.x - step, seat.y)) / (2 * step);
    const gy = (lift(seat.x, seat.y + step) - lift(seat.x, seat.y - step)) / (2 * step);
    const tilt = new THREE.Matrix4().set(
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      gx,
      gy,
      1,
      lift(seat.x, seat.y),
      0,
      0,
      0,
      1,
    );
    return to.multiply(tilt);
  });
  return { geometry, matrices, material };
};
