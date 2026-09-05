import polygonClipping from 'polygon-clipping';
import * as THREE from 'three';
import type { WellSpec } from '../decoration.js';
import { type Field, isoContours } from '../tube/field.js';
import type { Cut, Cutter, Seat } from './cutters.js';
import {
  area,
  centroid,
  clipHalf,
  fromPoints,
  insideRing,
  nest,
  orient,
  type Point,
  type Ring,
  resample,
  shrink,
  smooth,
} from './rings.js';

/** Row pitch as a fraction of column pitch, so the lattice the seeds start on is equilateral. */
const ROW = Math.sqrt(3) / 2;

/** How coarsely the region's own outline is walked, in em. */
const SPACING = 0.006;

/** Lloyd passes stop mattering well before this; a seed that owns almost nothing never moves. */
const TINY = 0.05;

/** How many times a cull pass runs before the field is taken as settled. */
const CULL_PASSES = 8;

export interface PaveOptions {
  /** Seed spacing, in em. With no gaps this is very nearly a cell's width. */
  pitch: number;
  /** Metal left standing between two cells, in em. Half of it comes off each cell. */
  wall: number;
  /** How far a seed may wander off the lattice, as a fraction of the pitch. */
  jitter: number;
  /** Lloyd passes: each free seed walks to the centroid of what it owns inside the region. */
  relax: number;
  /** A cell holding less than this fraction of a whole one loses its seed. */
  minArea: number;
  seed: number;
  /** How the field meets the region's edge. */
  edge: 'absorb' | 'grade';
  /** How far in from the region's edge a pinned row sits, and how far behind it the lattice does. */
  edgeInset: number;
  edgeStep: number;
  clearance: number;
}

export const DEFAULT_PAVE: PaveOptions = {
  pitch: 0.055,
  wall: 0.009,
  jitter: 0,
  relax: 4,
  minArea: 0.18,
  seed: 7,
  edge: 'absorb',
  edgeInset: 0.42,
  edgeStep: 0.95,
  clearance: 0.62,
};

const optionsOf = (spec: WellSpec): PaveOptions => ({
  ...DEFAULT_PAVE,
  pitch: spec.pitch,
  wall: spec.wall ?? DEFAULT_PAVE.wall,
  jitter: spec.jitter ?? DEFAULT_PAVE.jitter,
  relax: spec.relax ?? DEFAULT_PAVE.relax,
  minArea: spec.minArea ?? DEFAULT_PAVE.minArea,
  seed: spec.seed ?? DEFAULT_PAVE.seed,
  edge: spec.edge ?? DEFAULT_PAVE.edge,
});

/** One connected piece the region left of a cell. A cell is one pocket, so only the biggest is set. */
interface Piece {
  ring: Ring;
}

/**
 * Every piece of `cell` the region leaves.
 *
 * Against the region as one multipolygon, never one polygon at a time: asking for the part of a
 * cell inside each polygon separately answers nothing at all for a letter whose bezel leaves two
 * pieces, which is every `i` and every `j`.
 */
function clipTo(cell: Ring, region: Ring[][]): Piece[] {
  if (cell.length < 3) return [];
  try {
    const pieces = polygonClipping.intersection([cell] as never, region as never) ?? [];
    return pieces
      .filter((piece) => piece[0] && piece[0].length >= 4)
      .map((piece) => ({ ring: (piece[0] as number[][]).slice(0, -1) as Ring }));
  } catch {
    return [];
  }
}

/** Bilinear, unlike `Field.sample`, which rounds — the inward push needs a smooth gradient. */
function depthAt(field: Field, x: number, y: number): number {
  const { data, size, emPerCell, originX, originY } = field;
  const gx = Math.min(Math.max((x - originX) / emPerCell, 0), size - 1.0001);
  const gy = Math.min(Math.max((y - originY) / emPerCell, 0), size - 1.0001);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const d00 = data[y0 * size + x0] as number;
  const d10 = data[y0 * size + x0 + 1] as number;
  const d01 = data[(y0 + 1) * size + x0] as number;
  const d11 = data[(y0 + 1) * size + x0 + 1] as number;
  return (d00 * (1 - fx) + d10 * fx) * (1 - fy) + (d01 * (1 - fx) + d11 * fx) * fy;
}

/**
 * A point moved `dist` further inside the letter, along the field's own gradient. Off the field
 * rather than off a ring's normal is what makes a counter behave like the outer edge: inward is
 * wherever the metal is, and the field already knows.
 */
function pushInward(field: Field, x: number, y: number, dist: number): Point {
  const h = field.emPerCell;
  const gx = (depthAt(field, x + h, y) - depthAt(field, x - h, y)) / (2 * h);
  const gy = (depthAt(field, x, y + h) - depthAt(field, x, y - h)) / (2 * h);
  const len = Math.hypot(gx, gy) || 1e-9;
  return [x - (gx / len) * dist, y - (gy / len) * dist];
}

/**
 * The Voronoi cell of `seeds[i]`, before the wall comes off it.
 *
 * The box it starts as reaches `2.2 * pitch` along an axis and √2 of that into a corner, so a seed
 * is bisected against anything whose own box could reach it — cull a seed and its neighbours grow
 * into exactly what it held. A shorter cutoff leaves two cells overlapping wherever the lattice has
 * a gap, and culling seeds is what makes the gaps. Two pockets sharing floor is a hole in the
 * shell, which no render shows.
 */
function voronoiCell(i: number, seeds: Point[], pitch: number): Ring {
  const [sx, sy] = seeds[i] as Point;
  const r = pitch * 2.2;
  const reach = 2 * r * Math.SQRT2;
  let cell: Ring = [
    [sx - r, sy - r],
    [sx + r, sy - r],
    [sx + r, sy + r],
    [sx - r, sy + r],
  ];
  for (let j = 0; j < seeds.length; j++) {
    if (j === i) continue;
    const s = seeds[j] as Point;
    const dx = s[0] - sx;
    const dy = s[1] - sy;
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-12 || d2 > reach * reach) continue;
    const len = Math.sqrt(d2);
    cell = clipHalf(cell, sx + dx / 2, sy + dy / 2, dx / len, dy / len);
    if (cell.length < 3) break;
  }
  return cell;
}

const toPath = (ring: Ring): THREE.Path => {
  const path = new THREE.Path();
  const head = ring[0] as Point;
  path.moveTo(head[0], head[1]);
  for (let i = 1; i < ring.length; i++) {
    const p = ring[i] as Point;
    path.lineTo(p[0], p[1]);
  }
  path.closePath();
  return path;
};

/**
 * A field of Voronoi cells covering the letter inset by the bezel — pavé, where the stones are the
 * surface and the metal is what is left between them.
 *
 * Unlike `lattice` this places no whole shape: every cell that meets the outline is shaped by it,
 * which is the point. The seeds start on a staggered lattice and relax into what the letter leaves.
 */
export const pave: Cutter = (shapes, region, spec): Cut => {
  const opts = optionsOf(spec);
  const field = region.field;

  /** The glyph inset by `ins`, cleaned the way a level's outline is, as a multipolygon. */
  const regionAt = (ins: number): Ring[][] =>
    nest(isoContours(field, -ins).map((r) => smooth(resample(fromPoints(r), SPACING), 3)));

  const base = regionAt(spec.bezel);
  if (base.length === 0) {
    throw new Error(`klieg: a ${spec.bezel} em bezel leaves nothing of the letter to pave`);
  }

  const box = new THREE.Box2();
  for (const shape of shapes) {
    for (const p of shape.getPoints(24)) box.expandByPoint(p);
  }

  let rand = opts.seed;
  const random = () => {
    rand = (rand * 1664525 + 1013904223) % 4294967296;
    return rand / 4294967296;
  };

  // `grade` pins a row along the region's own edge, so the boundary is a place stones are laid
  // rather than a place they are cut off. The pinned row never relaxes: let it and it migrates
  // inward, taking the grading with it.
  const pinned: Point[] = [];
  if (opts.edge === 'grade') {
    const step = opts.pitch * opts.edgeStep;
    for (const group of base) {
      for (const ring of group) {
        let carry = 0;
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i] as Point;
          const b = ring[(i + 1) % ring.length] as Point;
          const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
          for (let t = carry; t < seg; t += step) {
            const u = t / seg;
            pinned.push(
              pushInward(
                field,
                a[0] + (b[0] - a[0]) * u,
                a[1] + (b[1] - a[1]) * u,
                opts.edgeInset * opts.pitch,
              ),
            );
          }
          carry = seg > 0 ? (((carry - seg) % step) + step) % step : carry;
        }
      }
    }
  }

  const free: Point[] = [];
  const rowStep = opts.pitch * ROW;
  const clear =
    opts.edge === 'grade'
      ? spec.bezel + opts.edgeInset * opts.pitch + opts.pitch * opts.clearance
      : 0;
  for (let r = -1; r * rowStep + box.min.y <= box.max.y + rowStep; r++) {
    const y = box.min.y + r * rowStep;
    const stagger = r % 2 ? opts.pitch / 2 : 0;
    for (let x = box.min.x - opts.pitch + stagger; x <= box.max.x + opts.pitch; x += opts.pitch) {
      const jx = x + (random() - 0.5) * opts.pitch * opts.jitter;
      const jy = y + (random() - 0.5) * opts.pitch * opts.jitter;
      if (depthAt(field, jx, jy) < -clear) free.push([jx, jy]);
    }
  }

  const whole = opts.pitch * opts.pitch * ROW;

  // Lloyd: each free seed walks to the centroid of what it actually owns inside the region, which
  // is what turns a lattice clipped by an outline into a field that fits it.
  for (let pass = 0; pass < opts.relax; pass++) {
    const all = [...pinned, ...free];
    for (let i = 0; i < free.length; i++) {
      const pieces = clipTo(voronoiCell(pinned.length + i, all, opts.pitch), base);
      if (pieces.length === 0) continue;
      const biggest = pieces.reduce((a, b) => (area(a.ring) > area(b.ring) ? a : b)).ring;
      if (area(biggest) < whole * TINY) continue;
      free[i] = centroid(biggest);
    }
  }

  // Cull the seed, never the cell. Every point belongs to its nearest seed, so there is no dead
  // space to fill — leftover exists only once a cell is deleted. Take the seed away instead and
  // every point it held goes to whichever seed is next nearest.
  let seeds = [...pinned, ...free];
  for (let pass = 0; pass < CULL_PASSES; pass++) {
    const doomed = new Set<number>();
    for (let i = pinned.length; i < seeds.length; i++) {
      const held = clipTo(shrink(voronoiCell(i, seeds, opts.pitch), opts.wall / 2), base).reduce(
        (n, p) => n + area(p.ring),
        0,
      );
      if (held < whole * opts.minArea) doomed.add(i);
    }
    if (doomed.size === 0) break;
    seeds = seeds.filter((_, i) => !doomed.has(i));
  }

  /**
   * Every surviving cell re-derived at each growth. A bead step is the cell built with that much
   * less wall taken off it, inside the region grown by the same amount — the same generator run
   * again, never an offset, because a clipped cell is not convex and the convex thing it was
   * clipped from is still here to rebuild from.
   *
   * One ring per seed per growth, and the seed is dropped outright if any growth has nothing for
   * it: `pair` matches a band's two ends by count first, so a cell that arrives at one step and not
   * the next is a band that cannot be stitched at all.
   */
  const derive = (growths: readonly number[]): Ring[][] => {
    const regions = growths.map((g) => regionAt(spec.bezel - g));
    const out: Ring[][] = growths.map(() => []);
    for (let i = 0; i < seeds.length; i++) {
      const cell = voronoiCell(i, seeds, opts.pitch);
      const perStep = growths.map((g, s) => {
        const pieces = clipTo(shrink(cell, opts.wall / 2 - g), regions[s] as Ring[][]);
        if (pieces.length === 0) return null;
        return pieces.reduce((a, b) => (area(a.ring) > area(b.ring) ? a : b));
      });
      const first = perStep[0];
      if (perStep.some((p) => p === null) || !first || area(first.ring) < whole * opts.minArea) {
        continue;
      }
      // Symbolic perturbation, a millionth of a cell wide. A lattice puts whole rows of cells on
      // one line, and three points from two rings on one line is a zero-area ear whose edge nothing
      // walks back — the floor they sit in then reads as open. Nudged by its own amount, no two
      // cells have a line to share.
      const nudge = 1 - (i + 1) * 4e-9;
      perStep.forEach((p, s) => {
        const ring = (p as Piece).ring;
        const c = centroid(ring);
        const shrunk = ring.map(
          ([x, y]): Point => [c[0] + (x - c[0]) * nudge, c[1] + (y - c[1]) * nudge],
        );
        (out[s] as Ring[]).push(orient(shrunk, false));
      });
    }
    if ((out[0] as Ring[]).length === 0) {
      throw new Error('klieg: no pave cell survived — try a smaller wall or a smaller pitch');
    }
    return out;
  };

  // The pockets themselves are the field at no growth, which is what the stones sit in.
  const pockets = derive([0])[0] as Ring[];
  const seats: Seat[] = pockets.map((ring) => {
    const c = interiorPoint(ring);
    let half = 0;
    for (const [x, y] of ring) half = Math.max(half, Math.hypot(x - c[0], y - c[1]));
    return { x: c[0], y: c[1], half, outline: ring.map(([x, y]): Point => [x - c[0], y - c[1]]) };
  });

  return {
    wells: pockets.map(toPath),
    // Transposed to one entry per pocket, because that is how a bead is stitched: each pocket's
    // own rings from the face down. `derive` works a growth at a time, which is how they are built.
    bead: (growths) => {
      const byGrowth = derive(growths);
      const first = byGrowth[0] as Ring[];
      return first.map((_, p) => byGrowth.map((rings) => toPath((rings as Ring[])[p] as Ring)));
    },
    seats,
    floor: spec.floor,
  };
};

/**
 * A point the whole cell can be seen from, which the centroid is not once the outline has taken a
 * bite out of it. Scaling a ring toward a point outside it turns the ring inside out, and a cap
 * drawn from one throws triangles clean outside the cell.
 */
export function interiorPoint(poly: Ring): Point {
  const c = centroid(poly);
  if (insideRing(poly, c[0], c[1])) return c;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of poly) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  let best = poly[0] as Point;
  let bestD = -1;
  const N = 14;
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < N; j++) {
      const x = minX + ((maxX - minX) * i) / N;
      const y = minY + ((maxY - minY) * j) / N;
      if (!insideRing(poly, x, y)) continue;
      let d = Number.POSITIVE_INFINITY;
      for (let k = 0, l = poly.length - 1; k < poly.length; l = k++) {
        const a = poly[l] as Point;
        const b = poly[k] as Point;
        const ex = b[0] - a[0];
        const ey = b[1] - a[1];
        const len2 = ex * ex + ey * ey || 1e-24;
        const t = Math.min(Math.max(((x - a[0]) * ex + (y - a[1]) * ey) / len2, 0), 1);
        d = Math.min(d, Math.hypot(x - (a[0] + t * ex), y - (a[1] + t * ey)));
      }
      if (d > bestD) {
        bestD = d;
        best = [x, y];
      }
    }
  }
  return best;
}
