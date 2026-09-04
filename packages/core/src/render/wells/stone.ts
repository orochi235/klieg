import * as THREE from 'three';
import { DEFAULT_GLYPH_OPTIONS } from '../../text/glyphs.js';
import type { WellSpec } from '../decoration.js';
import { applyLook } from '../looks.js';
import type { Seat } from './cutters.js';
import type { Fill, FillContext, Filled } from './fills.js';
import { registerFill } from './fills.js';

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

export const stone: Fill = (seats: readonly Seat[], ctx: FillContext, spec: WellSpec): Filled => {
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

registerFill('stone', stone);
