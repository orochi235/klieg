import type * as THREE from 'three';
import type { WellSpec } from '../decoration.js';
import type { Seat } from './cutters.js';

/** What a fill draws: one geometry and one material for every seat on the letter. */
export interface Filled {
  geometry: THREE.BufferGeometry;
  /** Where each seat puts that geometry, in the same order the seats came in. */
  matrices: THREE.Matrix4[];
  material: THREE.MeshPhysicalMaterial;
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
