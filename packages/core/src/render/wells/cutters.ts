import * as THREE from 'three';
import type { WellSpec } from '../decoration.js';
import type { Region } from './region.js';

/** How finely a contour is sampled when measuring the glyph's extent. */
const CONTOUR_SEGMENTS = 24;

/** Row pitch as a fraction of column pitch, so a staggered lattice is equilateral. */
const ROW = Math.sqrt(3) / 2;

/** What one cut produces: the well outlines, and the one floor they share. */
export interface Cut {
  /** Closed well outlines in the glyph's own em space. */
  wells: THREE.Path[];
  /** How far below the plate's front face the floor sits, in em. */
  floor: number;
}

export type Cutter = (shapes: readonly THREE.Shape[], region: Region, spec: WellSpec) => Cut;

const CUTTERS = new Map<string, Cutter>();

export function registerCutter(name: string, cut: Cutter): void {
  CUTTERS.set(name, cut);
}

export function cutterFor(name: string): Cutter {
  const cut = CUTTERS.get(name);
  if (!cut) throw new Error(`klieg: no well cutter registered for '${name}'`);
  return cut;
}

/** Diamonds on a staggered lattice, clipped to the region. */
const lattice: Cutter = (shapes, region, spec) => {
  const box = new THREE.Box2();
  for (const shape of shapes) {
    for (const p of shape.getPoints(CONTOUR_SEGMENTS)) box.expandByPoint(p);
  }
  const half = spec.size / 2;
  const wells: THREE.Path[] = [];
  const rowStep = spec.pitch * ROW;
  const rows = Math.ceil((box.max.y - box.min.y) / rowStep);
  for (let r = 0; r <= rows; r++) {
    const y = box.min.y + r * rowStep;
    const stagger = r % 2 ? spec.pitch / 2 : 0;
    for (let x = box.min.x + stagger; x <= box.max.x; x += spec.pitch) {
      // Every corner, not the centre. A centre that clears the bezel by less than the
      // half-diagonal still leaves the well breaking the letter's edge.
      if (
        !region.contains(x, y + half, spec.bezel) ||
        !region.contains(x + half, y, spec.bezel) ||
        !region.contains(x, y - half, spec.bezel) ||
        !region.contains(x - half, y, spec.bezel)
      ) {
        continue;
      }
      const path = new THREE.Path();
      path.moveTo(x, y + half);
      path.lineTo(x + half, y);
      path.lineTo(x, y - half);
      path.lineTo(x - half, y);
      path.closePath();
      wells.push(path);
    }
  }
  return { wells, floor: spec.floor };
};

registerCutter('lattice', lattice);
