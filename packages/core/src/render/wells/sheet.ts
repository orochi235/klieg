import * as THREE from 'three';
import { DEFAULT_GLYPH_OPTIONS } from '../../text/glyphs.js';
import type { SheetSpec, WellSpec } from '../decoration.js';
import { createMaterial } from '../looks.js';
import { cutterFor } from './cutters.js';
import { fillFor } from './fills.js';
import { regionOf } from './region.js';
import { buildShell, DEFAULT_SHELL, shellPlanes } from './shell.js';

const DEPTH = DEFAULT_GLYPH_OPTIONS.depth;

/**
 * Which surface a vertex of a sheet letter's metal belongs to. The body, the sheet and the rim all
 * draw on the body's one material, so its shader tells them apart by this.
 */
export const SHEET_ATTRIBUTE = 'aSheet';
export const SHEET_BODY = 0;
export const SHEET_METAL = 1;
export const SHEET_RIM = 2;

/** Each copy of the sheet keeps only what is in front of this plane, in its own z. */
export const CLIP_Z = DEPTH / 2;

export function markSheet(geometry: THREE.BufferGeometry, role: number): void {
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute(
    SHEET_ATTRIBUTE,
    new THREE.BufferAttribute(new Float32Array(count).fill(role), 1),
  );
}

export interface BakedSheet {
  /** The em rectangle the sheet covers, in a letter's own space before any slide. */
  readonly box: THREE.Box2;
  /** The plate and its wells, every vertex marked `SHEET_METAL`. */
  readonly shell: THREE.BufferGeometry;
  /** Every stone as one geometry, or null where the spec names no fill. */
  readonly stones: THREE.BufferGeometry | null;
  /** The transmission thickness the fill chose for its stones. */
  readonly thickness: number;
  dispose(): void;
}

/**
 * A pavé plate over `box`, through the same cutter, shell and fill the carved wells use. Baked once
 * per spec and shared by every letter, each of which shows its own patch of it.
 */
export function bakeSheet(box: THREE.Box2, spec: SheetSpec): BakedSheet {
  const well: WellSpec = { ...spec, kind: 'well' };
  const planes = shellPlanes(DEPTH, well.floor, well.bezel);
  if (planes.floorZ <= CLIP_Z) {
    throw new Error(
      `klieg: a sheet's floor of ${well.floor} em reaches past the letter's middle, where it is clipped`,
    );
  }

  const shapes = [
    new THREE.Shape([
      new THREE.Vector2(box.min.x, box.min.y),
      new THREE.Vector2(box.max.x, box.min.y),
      new THREE.Vector2(box.max.x, box.max.y),
      new THREE.Vector2(box.min.x, box.max.y),
    ]),
  ];
  const cut = cutterFor(well.cutter)(shapes, regionOf(shapes, 'uniform'), well);
  const rimDrop = well.rimDrop ?? well.rimBevel ?? DEFAULT_SHELL.rimDrop;
  const shell = buildShell(shapes, cut, {
    ...DEFAULT_SHELL,
    depth: DEPTH,
    bezel: well.bezel,
    rimBevel: well.rimBevel ?? DEFAULT_SHELL.rimBevel,
    rimDrop,
    round: well.round ?? 0,
    roundOuter: well.roundOuter ?? 0,
    crease: well.crease ?? DEFAULT_SHELL.crease,
  }).geometry;
  markSheet(shell, SHEET_METAL);

  let stones: THREE.BufferGeometry | null = null;
  let thickness = 0;
  if (well.fill && cut.seats.length > 0) {
    const filled = fillFor(well.fill)(
      cut.seats,
      {
        material: () => createMaterial(null),
        faceZ: planes.faceZ,
        floorZ: planes.floorZ,
        girdleZ: planes.faceZ - rimDrop,
      },
      well,
    );
    // Only the number is kept: every letter makes its own stone material, to carry its own mask.
    thickness = filled.material.thickness;
    filled.material.dispose();
    if (!filled.placed) {
      filled.geometry.dispose();
      shell.dispose();
      throw new Error(
        `klieg: a sheet needs a fill that places its stones; '${well.fill}' does not`,
      );
    }
    stones = filled.geometry;
  }

  return {
    box: box.clone(),
    shell,
    stones,
    thickness,
    dispose() {
      shell.dispose();
      stones?.dispose();
    },
  };
}
