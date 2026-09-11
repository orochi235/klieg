import polygonClipping from 'polygon-clipping';
import * as THREE from 'three';
import { DEFAULT_GLYPH_OPTIONS } from '../../text/glyphs.js';
import type { SheetSpec, WellSpec } from '../decoration.js';
import { createMaterial } from '../looks.js';
import { type Field, isoContours } from '../tube/field.js';
import { cutterFor } from './cutters.js';
import { fillFor } from './fills.js';
import { regionOf } from './region.js';
import { fromPoints, nest, type Ring, resample, smooth } from './rings.js';
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

/**
 * Where the sheet starts, in em in from the outline: just past the glyph's own rounded bevel. That
 * bevel is 0.038 em wide, wider than `pave`'s bezel, so a sheet starting any sooner floats over it.
 */
export const MASK = DEFAULT_GLYPH_OPTIONS.bevelSize + 0.004;
/** The rim's half-width either side of the seam, before its own bevel rounds it outward. */
const RIM_HALF = 0.002;
const RIM_BEVEL = 0.005;
const RIM_HEIGHT = 0.004;

export interface SheetLetter {
  /** The glyph's signed distance in em, negative inside. */
  readonly mask: THREE.DataTexture;
  /** originX, originY, emPerCell, size: where the mask's texel centers sit in the letter's em. */
  readonly xf: THREE.Vector4;
  /** The bead over the seam between the letter's own face and the sheet, marked `SHEET_RIM`. */
  readonly rim: THREE.BufferGeometry;
  dispose(): void;
}

/** A letter's mask and rim, from its contours. Built once per (font, char); see `WordCaches`. */
export function sheetLetterOf(shapes: readonly THREE.Shape[]): SheetLetter {
  const { field } = regionOf(shapes, 'uniform');
  const half = new Uint16Array(field.data.length);
  for (let i = 0; i < half.length; i++) {
    half[i] = THREE.DataUtils.toHalfFloat(field.data[i] as number);
  }
  const mask = new THREE.DataTexture(
    half,
    field.size,
    field.size,
    THREE.RedFormat,
    THREE.HalfFloatType,
  );
  mask.magFilter = THREE.LinearFilter;
  mask.minFilter = THREE.LinearFilter;
  mask.needsUpdate = true;
  const rim = rimOf(field);
  return {
    mask,
    xf: new THREE.Vector4(field.originX, field.originY, field.emPerCell, field.size),
    rim,
    dispose() {
      mask.dispose();
      rim.dispose();
    },
  };
}

const clean = (ring: { x: number; y: number }[]): Ring =>
  smooth(resample(fromPoints(ring), 0.006), 3);

/** The letter inset by `by` em, as the multipolygon `polygon-clipping` takes. */
function insetOf(field: Field, by: number): Ring[][] {
  return nest(isoContours(field, -by).map(clean));
}

/** The band between two insets either side of the seam, extruded thin and beveled round. */
function rimOf(field: Field): THREE.BufferGeometry {
  const band = polygonClipping.difference(
    insetOf(field, MASK - RIM_HALF) as never,
    insetOf(field, MASK + RIM_HALF) as never,
  );
  const shapes: THREE.Shape[] = [];
  for (const poly of band) {
    const [outer, ...holes] = poly as number[][][];
    if (!outer) continue;
    const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
    shape.holes = holes.map((h) => new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
    shapes.push(shape);
  }
  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth: RIM_HEIGHT,
    bevelEnabled: true,
    bevelThickness: RIM_BEVEL,
    bevelSize: RIM_BEVEL * 0.8,
    bevelSegments: 4,
    curveSegments: 1,
  });
  geometry.translate(0, 0, DEPTH + DEFAULT_GLYPH_OPTIONS.bevelThickness);
  markSheet(geometry, SHEET_RIM);
  return geometry;
}
