import * as THREE from 'three';
import { DEFAULT_GLYPH_OPTIONS } from '../../text/glyphs.js';
import type { WellSpec } from '../decoration.js';
import { applyLook } from '../looks.js';
import type { Seat } from './cutters.js';
// Types only, so `fills.ts` can import this module for value and register it without a cycle.
import type { Fill, FillContext, Filled } from './fills.js';
import { interiorPoint } from './pave.js';
import { area, insideRing } from './rings.js';

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
 * The girdle's width and the height it sits at are one choice, not two: `ExtrudeGeometry` bevels a
 * hole outward toward the face, so a well is `half + bevelSize` wide at the plate's front and only
 * `half` wide once the bevel has run out. `sink` moves the stone along that taper, and the radius
 * follows. Seat it below the collar and the stone sits in a pit with its crown under the letter's
 * own surface, which reads as a field of dimples rather than of stones.
 */
function brilliant(
  half: number,
  faceZ: number,
  sink: number,
  facets: number,
): THREE.BufferGeometry {
  const bevel = DEFAULT_GLYPH_OPTIONS.bevelSize;
  const girdleR = half + bevel * (1 - sink);
  const girdleZ = faceZ - sink * DEFAULT_GLYPH_OPTIONS.bevelThickness;
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

/** The girdle's width, which the stone's own transmission thickness is scaled against. */
export function girdleWidth(half: number, sink: number): number {
  return (half + DEFAULT_GLYPH_OPTIONS.bevelSize * (1 - sink)) * 2;
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
 * rather than fanned, from a sampled interior point rather than the centroid: a clipped cell is not
 * convex, so a fan from one vertex throws triangles clean outside it.
 */
function setStone(seat: Seat, ctx: FillContext, into: number[]): boolean {
  const outline = seat.outline;
  if (!outline || outline.length < 3) return false;
  const ring = outline.map(([x, y]): [number, number] => [x + seat.x, y + seat.y]);
  const c = interiorPoint(ring);
  if (!insideRing(ring, c[0], c[1])) return false;

  const width = Math.sqrt(area(ring));
  const crown = PROUD + Math.max(ctx.faceZ - ctx.girdleZ, 0);
  const drop = Math.min(PAVILION * width, (ctx.girdleZ - ctx.floorZ) * ROOM);

  const at = (k: number, z: number) =>
    ring.map(([x, y]) => [c[0] + (x - c[0]) * k, c[1] + (y - c[1]) * k, z]);
  const girdle = at(1, ctx.girdleZ);
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
  const geometry = brilliant(half, ctx.faceZ, sink, facets);

  const material = ctx.material();
  applyLook(material, spec.stone ?? 'gem');
  // `transmission` attenuates over `thickness` in world units, and the looks are tuned for a volume
  // the size of a letter. A stone is a twentieth of that, so inheriting the look's own thickness
  // absorbs nearly everything and the field renders as black holes in the plate.
  material.thickness = (spec.tint ?? TINT) * girdleWidth(half, sink);

  const at = new THREE.Matrix4();
  const matrices = seats.map((seat) => at.clone().makeTranslation(seat.x, seat.y, 0));
  return { geometry, matrices, material };
};
