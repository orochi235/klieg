import * as THREE from 'three';
import { chamfered, DEFAULT_GLYPH_OPTIONS } from '../../text/glyphs.js';
import type { Cut } from './cutters.js';

/** How finely a contour is sampled for the containment test that hosts a well. */
const CONTOUR_SEGMENTS = 24;

export interface PlateOptions {
  /** The letter's full depth, slab plus plate. */
  depth: number;
  /** How far in from every contour a well stays, in em. Caps the slab's bevel. */
  bezel: number;
}

/**
 * Two extrusions as one geometry. `ExtrudeGeometry` is always non-indexed and carries position,
 * normal and uv, so this is concatenation. Groups are dropped: the body draws on one material, and
 * a group whose material index nothing supplies would render nothing.
 */
export function mergeNonIndexed(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const part of parts) {
    if (part.getIndex()) throw new Error('klieg: mergeNonIndexed was handed indexed geometry');
  }
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const attrs = parts.map((part) => part.getAttribute(name) as THREE.BufferAttribute);
    const total = attrs.reduce((n, attr) => n + attr.array.length, 0);
    const merged = new Float32Array(total);
    let at = 0;
    for (const attr of attrs) {
      merged.set(attr.array as Float32Array, at);
      at += attr.array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(merged, attrs[0]?.itemSize ?? 3));
  }
  out.computeBoundingBox();
  return out;
}

/** Ray casting against one sampled ring. */
function inRing(ring: readonly THREE.Vector2[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as THREE.Vector2;
    const b = ring[j] as THREE.Vector2;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/**
 * The glyph's shapes with each well added as a hole to the outline that contains it.
 *
 * Clones first: the shapes are the cache's, shared by every letter of the same char. Hosting
 * matters because a glyph may draw several outlines — an `i` is a stem and a dot — and a hole
 * pushed onto the wrong one triangulates across the gap between them.
 */
function withWells(shapes: readonly THREE.Shape[], wells: readonly THREE.Path[]): THREE.Shape[] {
  const cut = shapes.map((shape) => {
    const copy = shape.clone();
    copy.holes = shape.holes.map((hole) => hole.clone());
    return copy;
  });
  const rings = cut.map((shape) => shape.getPoints(CONTOUR_SEGMENTS));
  for (const well of wells) {
    const at = well.getPoints(1)[0];
    if (!at) continue;
    const host = cut.findIndex((_, i) => inRing(rings[i] as THREE.Vector2[], at.x, at.y));
    if (host < 0) continue;
    (cut[host] as THREE.Shape).holes.push(well);
  }
  return cut;
}

function extrude(shapes: THREE.Shape[], depth: number, bevelSize: number): THREE.ExtrudeGeometry {
  const full = DEFAULT_GLYPH_OPTIONS.bevelSize;
  return new THREE.ExtrudeGeometry(chamfered(shapes, DEFAULT_GLYPH_OPTIONS), {
    depth,
    curveSegments: DEFAULT_GLYPH_OPTIONS.curveSegments,
    bevelEnabled: bevelSize > 0,
    bevelSize,
    // Kept in proportion, so a reduced bevel is the same profile scaled rather than a steeper one.
    bevelThickness: (DEFAULT_GLYPH_OPTIONS.bevelThickness * bevelSize) / full,
    bevelSegments: DEFAULT_GLYPH_OPTIONS.bevelSegments,
    bevelOffset: 0,
  });
}

/**
 * A letter as a slab with a holed plate on its front face.
 *
 * The slab's bevel is derived from the bezel rather than being its own knob. A bevelled front cap
 * covers only the shape inset by `bevelSize` and ramps down across that width, and that cap is
 * every well's floor — so a well cut closer in than the slab's bevel would sit on a ramp at an
 * unpredictable depth. Deriving it makes that inexpressible. In a stack the plate carries the
 * letter's front bevel anyway, so the slab's only other job is the back edge.
 */
/**
 * The two planes a fill has to sit between: the plate's front face and the well's floor.
 *
 * Neither is where the depth alone would put it. `ExtrudeGeometry` carries a bevelled face
 * `bevelThickness` past the depth it was asked for, so a stone placed at `depth` sits that far
 * inside the letter — and the slab's own bevel is capped by the bezel, which lifts the floor.
 */
export function platePlanes(depth: number, floor: number, bezel: number) {
  const slabDepth = Math.max(depth - floor, 0);
  const slabBevel = Math.min(DEFAULT_GLYPH_OPTIONS.bevelSize, bezel);
  const slabBevelZ =
    (DEFAULT_GLYPH_OPTIONS.bevelThickness * slabBevel) / DEFAULT_GLYPH_OPTIONS.bevelSize;
  return {
    slabDepth,
    slabBevel,
    floorZ: slabDepth + slabBevelZ,
    faceZ: slabDepth + floor + DEFAULT_GLYPH_OPTIONS.bevelThickness,
  };
}

export function buildPlate(
  shapes: readonly THREE.Shape[],
  cut: Cut,
  opts: PlateOptions,
): THREE.BufferGeometry {
  const { slabDepth, slabBevel } = platePlanes(opts.depth, cut.floor, opts.bezel);
  const slab = extrude(shapes as THREE.Shape[], slabDepth, slabBevel);
  const plate = extrude(withWells(shapes, cut.wells), cut.floor, DEFAULT_GLYPH_OPTIONS.bevelSize);
  plate.translate(0, 0, slabDepth);
  const merged = mergeNonIndexed([slab, plate]);
  slab.dispose();
  plate.dispose();
  return merged;
}
