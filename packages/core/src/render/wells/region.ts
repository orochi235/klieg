import type * as THREE from 'three';
import { type Point2, signedDistanceField } from '../tube/field.js';

/**
 * Grid cells per side. At a letter's scale this puts a cell at about 0.003 em, an order finer than
 * the smallest bezel worth cutting, and the field is built once per glyph.
 */
const RESOLUTION = 256;

/** Room around the silhouette so a point outside it still lands on the grid. */
const PAD = 0.05;

/** How finely a contour is sampled into the polygon the field rasterises. */
const CONTOUR_SEGMENTS = 64;

export interface Region {
  /** Whether `(x, y)` in em sits at least `clearance` em inside every contour of the glyph. */
  contains(x: number, y: number, clearance: number): boolean;
}

/**
 * The glyph as a region a cutter may place wells in.
 *
 * A signed distance field rather than an offset contour: nothing in the tree offsets a contour,
 * the field already ships as the tube pipeline's own, and it counts a counter as boundary — so one
 * sample answers "far enough inside everything" without separate hole handling.
 */
export function regionOf(shapes: readonly THREE.Shape[]): Region {
  const polygons: Point2[][] = [];
  for (const shape of shapes) {
    polygons.push(shape.getPoints(CONTOUR_SEGMENTS).map((p) => ({ x: p.x, y: p.y })));
    for (const hole of shape.holes) {
      polygons.push(hole.getPoints(CONTOUR_SEGMENTS).map((p) => ({ x: p.x, y: p.y })));
    }
  }
  if (polygons.length === 0) throw new Error('klieg: regionOf needs a glyph that drew ink');
  const field = signedDistanceField(polygons, { resolution: RESOLUTION, pad: PAD });
  return {
    // Inside is negative, so "at least `clearance` in" is one comparison. A point off the grid
    // samples +Infinity, which fails for every clearance.
    contains: (x, y, clearance) => field.sample(x, y) <= -clearance,
  };
}
