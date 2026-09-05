import type * as THREE from 'three';
import type { WellSpec } from '../decoration.js';
import type { Seat } from './cutters.js';
import { stone } from './stone.js';

/** What a fill draws: one geometry and one material for every seat on the letter. */
export interface Filled {
  geometry: THREE.BufferGeometry;
  /** Where each seat puts that geometry, in the same order the seats came in. */
  matrices: THREE.Matrix4[];
  material: THREE.MeshPhysicalMaterial;
  /**
   * Whether the geometry already holds every stone in the letter's own space, which a field of
   * differently-shaped pockets has to: a pavé cell is its stone's girdle, so there is no one
   * geometry to instance. `matrices` is then empty and the field draws as a plain mesh — still one
   * draw call, because the stones are merged.
   */
  placed?: boolean;
}

/**
 * What a fill may reach for beyond its seats. The two planes come from the plate, not the cutter:
 * a seat is where a well is, and how far the front face stands above the floor is the plate's.
 */
export interface FillContext {
  /** A fresh material carrying the studio's environment settings. */
  material(): THREE.MeshPhysicalMaterial;
  /** The plate's front face, and the well's floor, in the body's own z. */
  faceZ: number;
  floorZ: number;
  /** Where a pocket's wall goes vertical — the face less the rim bead's drop. */
  girdleZ: number;
}

export type Fill = (seats: readonly Seat[], ctx: FillContext, spec: WellSpec) => Filled;

const FILLS = new Map<string, Fill>();

export function registerFill(name: string, fill: Fill): void {
  FILLS.set(name, fill);
}

export function fillFor(name: string): Fill {
  const fill = FILLS.get(name);
  if (!fill) throw new Error(`klieg: no well fill registered for '${name}'`);
  return fill;
}

// Registered here rather than by `stone.ts` registering itself, which is how `cutters.ts` does it
// and for the same reason: the package declares a narrow `sideEffects` list, so a module imported
// only for its registration is dropped from the bundle. Nothing fails — the unit tests import the
// module directly and pass — and the shipped path then cannot find the fill by name.
registerFill('stone', stone);
