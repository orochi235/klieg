import type * as THREE from 'three';
import { type Field, type Point2, signedDistanceField } from '../tube/field.js';

/**
 * Grid cells per side. At a letter's scale this puts a cell at about 0.003 em, an order finer than
 * the smallest bezel worth cutting, and the field is built once per glyph.
 */
const RESOLUTION = 256;

/** Room around the silhouette so a point outside it still lands on the grid. */
const PAD = 0.05;

/** How finely a contour is sampled into the polygon the field rasterises. */
const CONTOUR_SEGMENTS = 64;

/**
 * How a clearance is measured. `uniform` is the same absolute amount off every stroke; with
 * `proportional` the amount named is what comes off the **thickest** stroke and every thinner one
 * loses the same fraction of itself.
 */
export type Insets = 'uniform' | 'proportional';

export interface Region {
  /** Whether `(x, y)` in em sits at least `clearance` em inside every contour of the glyph. */
  contains(x: number, y: number, clearance: number): boolean;
  /**
   * The field the region measures on. A cutter that lays out a field of cells needs more than a
   * containment test: which way is further in, and where the metal at a given inset actually is.
   * Under `proportional` this is the glyph's distance divided through by the local stroke width, so
   * read it through `levelFor` rather than as em.
   */
  field: Field;
  /** The level of `field` at which the region has inset by `clearance` em. */
  levelFor(clearance: number): number;
}

/**
 * The glyph as a region a cutter may place wells in.
 *
 * A signed distance field rather than an offset contour: nothing in the tree offsets a contour,
 * the field already ships as the tube pipeline's own, and it counts a counter as boundary — so one
 * sample answers "far enough inside everything" without separate hole handling.
 */
export function regionOf(shapes: readonly THREE.Shape[], insets: Insets = 'uniform'): Region {
  const polygons: Point2[][] = [];
  for (const shape of shapes) {
    polygons.push(shape.getPoints(CONTOUR_SEGMENTS).map((p) => ({ x: p.x, y: p.y })));
    for (const hole of shape.holes) {
      polygons.push(hole.getPoints(CONTOUR_SEGMENTS).map((p) => ({ x: p.x, y: p.y })));
    }
  }
  if (polygons.length === 0) throw new Error('klieg: regionOf needs a glyph that drew ink');
  const plain = signedDistanceField(polygons, { resolution: RESOLUTION, pad: PAD });
  // Divided through by the local half-width, the field's levels run 0 at the outline to -1 at the
  // ridge whatever a stroke is worth, so a clearance of `c` is level `-c / widest`: `c` off the
  // thickest stroke and the same fraction off every thinner one. Both cutters read the same pair,
  // so a proportional bezel reaches the cell field as well as the containment test.
  const widest = insets === 'proportional' ? strokeWidths(plain).widest : 1;
  const field = insets === 'proportional' ? scaleByWidth(plain) : plain;
  const levelFor = (clearance: number) => -clearance / widest;
  return {
    // Inside is negative, so "at least `clearance` in" is one comparison. A point off the grid
    // samples +Infinity, which fails for every clearance.
    contains: (x, y, clearance) => field.sample(x, y) <= levelFor(clearance),
    field,
    levelFor,
  };
}

/** A region built on first read, so a cutter that never reads it never pays for the field. */
export function lazyRegion(shapes: readonly THREE.Shape[], insets: Insets = 'uniform'): Region {
  let built: Region | undefined;
  const get = () => {
    built ??= regionOf(shapes, insets);
    return built;
  };
  return {
    contains: (x, y, clearance) => get().contains(x, y, clearance),
    get field() {
      return get().field;
    },
    levelFor: (clearance) => get().levelFor(clearance),
  };
}

/** The same field with every cell divided by the width of the stroke it belongs to. */
function scaleByWidth(field: Field): Field {
  const { width } = strokeWidths(field);
  const data = new Float64Array(field.data.length);
  for (let i = 0; i < data.length; i++) data[i] = (field.data[i] as number) / (width[i] as number);
  const { size, emPerCell, originX, originY } = field;
  return {
    data,
    size,
    emPerCell,
    originX,
    originY,
    // `Field.sample` closes over the array it was built with, so a spread of the original samples
    // the original — the one thing about this that reads correct and answers the wrong number.
    sample(x, y) {
      const gx = Math.round((x - originX) / emPerCell);
      const gy = Math.round((y - originY) / emPerCell);
      if (gx < 0 || gy < 0 || gx >= size || gy >= size) return Number.POSITIVE_INFINITY;
      return data[gy * size + gx] as number;
    },
  };
}

/** How far a jump in width at a junction is spread, in em, so the inset ramps rather than steps. */
const WIDTH_SMOOTH = 0.02;

/**
 * The half-width of the stroke each cell belongs to, and the widest the letter has.
 *
 * A ridge cell — a local maximum of the depth — sits equidistant from both sides of its stroke, so
 * its own depth is that stroke's half-width; every other cell inherits from its steepest uphill
 * neighbour, which is the ridge it drains to.
 *
 * The pointwise value is then **snapped to the two or three widths the letter really has**, and a
 * straight edge is why: the raw value climbs wherever a stroke runs into a wider one, so an inset
 * that follows it eats a straight edge unevenly and bows it — an R's counter came out a lopsided
 * lens rather than a rounded rectangle. A corner's own inflated ridge snaps back to the stroke it
 * belongs to for the same reason. Only then is the step at a junction smoothed into a ramp.
 */
export function strokeWidths(field: Field): { width: Float64Array; widest: number } {
  const { data, size, emPerCell } = field;
  const n = size * size;
  const depth = new Float64Array(n);
  for (let i = 0; i < n; i++) depth[i] = Math.max(0, -(data[i] as number));

  const inside: number[] = [];
  for (let i = 0; i < n; i++) if ((depth[i] as number) > 0) inside.push(i);
  inside.sort((a, b) => (depth[b] as number) - (depth[a] as number));

  const w = new Float64Array(n);
  for (const i of inside) {
    const ix = i % size;
    const iy = (i - ix) / size;
    let parent = -1;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const jx = ix + dx;
        const jy = iy + dy;
        if (jx < 0 || jy < 0 || jx >= size || jy >= size) continue;
        const j = jy * size + jx;
        const up = depth[j] as number;
        if (up > (depth[i] as number) && (parent === -1 || up > (depth[parent] as number))) {
          parent = j;
        }
      }
    }
    w[i] = parent === -1 ? (depth[i] as number) : (w[parent] as number);
  }

  const peaks: number[] = [];
  for (const i of inside) if (w[i] === depth[i]) peaks.push(depth[i] as number);
  peaks.sort((a, b) => a - b);
  const classes: number[][] = [];
  for (const d of peaks) {
    const run = classes[classes.length - 1];
    const last = run?.[run.length - 1];
    if (run && last !== undefined && d - last <= Math.max(3 * emPerCell, 0.03 * d)) run.push(d);
    else classes.push([d]);
  }
  const widths = classes
    .filter((run) => run.length >= Math.max(3, 0.004 * peaks.length))
    .map((run) => run[Math.floor(run.length / 2)] as number);
  if (widths.length > 0) {
    for (const i of inside) {
      let best = widths[0] as number;
      for (const v of widths) {
        if (Math.abs(v - (w[i] as number)) < Math.abs(best - (w[i] as number))) best = v;
      }
      w[i] = best;
    }
  }

  const passes = Math.min(400, Math.round(1.5 * (WIDTH_SMOOTH / emPerCell) ** 2));
  let cur = w;
  for (let p = 0; p < passes; p++) {
    const next = new Float64Array(cur);
    for (const i of inside) {
      const ix = i % size;
      const iy = (i - ix) / size;
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const jx = ix + dx;
          const jy = iy + dy;
          if (jx < 0 || jy < 0 || jx >= size || jy >= size) continue;
          const j = jy * size + jx;
          if ((depth[j] as number) <= 0) continue;
          sum += cur[j] as number;
          count++;
        }
      }
      if (count > 0) next[i] = sum / count;
    }
    cur = next;
  }

  let widest = 0;
  for (const i of inside) widest = Math.max(widest, cur[i] as number);
  // Outside the metal there is no stroke to be a fraction of, so it scales with the thickest.
  for (let i = 0; i < n; i++) if ((depth[i] as number) <= 0) cur[i] = widest;
  return { width: cur, widest: widest || 1 };
}
