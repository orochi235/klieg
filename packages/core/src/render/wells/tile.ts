import type * as THREE from 'three';
import { chamfered, DEFAULT_GLYPH_OPTIONS } from '../../text/glyphs.js';
import type { WellSpec } from '../decoration.js';
import { type Field, isoContours } from '../tube/field.js';
import type { Cut, Cutter, Seat } from './cutters.js';
import { toPath } from './pave.js';
import {
  area,
  centroid,
  clipHalf,
  dedupe,
  fromPoints,
  insideRing,
  nest,
  orient,
  type Point,
  type Ring,
} from './rings.js';

const COS30 = Math.sqrt(3) / 2;

/** Grid steps per pitch in a straddling cell's own field. */
const RES = 24;

/** How much of half the wall a rim bead may take, so neighboring rims never meet on the face. */
const REACH = 0.8;

export interface TileOptions {
  /** Center-to-center spacing of neighboring cells, in em — a whole cell's width across flats. */
  pitch: number;
  /** Metal left standing between two cells, in em. Half of it comes off each. */
  wall: number;
  /** How far in from the outline a pocket stays, in em. */
  bezel: number;
  /** A piece holding less than this fraction of a whole pocket is dropped. */
  minArea: number;
}

export const DEFAULT_TILE = { wall: 0.009, minArea: 0.1 };

/**
 * The glyph's outline as segments, bucketed on a grid at `bucket` em so a cell reads only the
 * outline near it. With no bucket every segment is near everything, which is what the bucketed
 * answer is tested against.
 */
export class Outline {
  private readonly seg: Float64Array;
  readonly count: number;
  private readonly buckets: Map<number, number[]> | null;
  private readonly stamp: Int32Array;
  private generation = 0;

  constructor(
    rings: readonly Ring[],
    private readonly bucket: number | null,
  ) {
    const segs: number[] = [];
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i] as Point;
        const b = ring[(i + 1) % ring.length] as Point;
        segs.push(a[0], a[1], b[0], b[1]);
      }
    }
    this.seg = Float64Array.from(segs);
    this.count = segs.length / 4;
    this.stamp = new Int32Array(this.count);
    if (bucket === null) {
      this.buckets = null;
      return;
    }
    this.buckets = new Map();
    for (let s = 0; s < this.count; s++) {
      const [x0, y0, x1, y1] = this.boxOf(s);
      for (let ix = Math.floor(x0 / bucket); ix <= Math.floor(x1 / bucket); ix++) {
        for (let iy = Math.floor(y0 / bucket); iy <= Math.floor(y1 / bucket); iy++) {
          const key = keyOf(ix, iy);
          const list = this.buckets.get(key);
          if (list) list.push(s);
          else this.buckets.set(key, [s]);
        }
      }
    }
  }

  private boxOf(s: number): [number, number, number, number] {
    const q = this.seg;
    const ax = q[s * 4] as number;
    const ay = q[s * 4 + 1] as number;
    const bx = q[s * 4 + 2] as number;
    const by = q[s * 4 + 3] as number;
    return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
  }

  /** Every segment whose box meets the given one — or, unbucketed, every segment there is. */
  near(x0: number, y0: number, x1: number, y1: number): number[] {
    const out: number[] = [];
    const meets = (s: number) => {
      const [sx0, sy0, sx1, sy1] = this.boxOf(s);
      return sx1 >= x0 && sx0 <= x1 && sy1 >= y0 && sy0 <= y1;
    };
    if (!this.buckets || this.bucket === null) {
      for (let s = 0; s < this.count; s++) out.push(s);
      return out;
    }
    const gen = ++this.generation;
    for (let ix = Math.floor(x0 / this.bucket); ix <= Math.floor(x1 / this.bucket); ix++) {
      for (let iy = Math.floor(y0 / this.bucket); iy <= Math.floor(y1 / this.bucket); iy++) {
        for (const s of this.buckets.get(keyOf(ix, iy)) ?? []) {
          if (this.stamp[s] === gen) continue;
          this.stamp[s] = gen;
          if (meets(s)) out.push(s);
        }
      }
    }
    return out.sort((a, b) => a - b);
  }

  /** Even-odd over every ring, so a counter is outside and an island standing in one is inside. */
  contains(px: number, py: number): boolean {
    let hit = false;
    for (let s = 0; s < this.count; s++) {
      const x = this.crossing(s, py);
      if (x !== null && px < x) hit = !hit;
    }
    return hit;
  }

  /** Where each of `among` crosses the horizontal line through `py`, ascending. */
  crossings(py: number, among: readonly number[]): number[] {
    const xs: number[] = [];
    for (const s of among) {
      const x = this.crossing(s, py);
      if (x !== null) xs.push(x);
    }
    return xs.sort((a, b) => a - b);
  }

  /** The same half-open rule as `insideRing`, so a partial count composes with `contains`. */
  private crossing(s: number, py: number): number | null {
    const q = this.seg;
    const ax = q[s * 4] as number;
    const ay = q[s * 4 + 1] as number;
    const bx = q[s * 4 + 2] as number;
    const by = q[s * 4 + 3] as number;
    if (ay > py === by > py) return null;
    return ((bx - ax) * (py - ay)) / (by - ay) + ax;
  }

  /** Distance from a point to the nearest of `among`, or `cap` if none is closer. */
  distance(px: number, py: number, among: readonly number[], cap: number): number {
    const q = this.seg;
    let best = cap * cap;
    for (const s of among) {
      const ax = q[s * 4] as number;
      const ay = q[s * 4 + 1] as number;
      const ex = (q[s * 4 + 2] as number) - ax;
      const ey = (q[s * 4 + 3] as number) - ay;
      const len2 = ex * ex + ey * ey;
      const t = len2 > 0 ? Math.min(Math.max(((px - ax) * ex + (py - ay) * ey) / len2, 0), 1) : 0;
      const dx = px - (ax + t * ex);
      const dy = py - (ay + t * ey);
      const d2 = dx * dx + dy * dy;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  }
}

const keyOf = (ix: number, iy: number) => (ix + 32768) * 65536 + (iy + 32768);

/** What the cutter kept of one cell. */
export interface Pocket {
  ring: Ring;
  /** A point inside the pocket, which every bead ring grown from it also encloses. */
  at: Point;
  /** The lattice cell it came from. */
  cx: number;
  cy: number;
  /** Whether the cell cleared the outline and is the plain hexagon. */
  whole: boolean;
}

export interface Tiling {
  pockets: Pocket[];
  /** Cells kept whole, and pieces kept clipped by the outline. */
  whole: number;
  clipped: number;
  /** Pieces dropped for holding a hole, or for having no point the whole piece can be seen from. */
  holed: number;
  bent: number;
  /** Each pocket's ring at every growth, one entry per pocket in the same order. */
  bead(growths: readonly number[]): Ring[][];
}

/** A flat-top hexagon on `(cx, cy)` with apothem `a`, counter-clockwise from its right corner. */
export function hexagon(cx: number, cy: number, a: number): Ring {
  const r = a / COS30;
  const ring: Ring = [];
  for (let i = 0; i < 6; i++) {
    const t = (Math.PI / 3) * i;
    ring.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
  }
  return ring;
}

/**
 * How far outside a flat-top hexagon of apothem `a` the point `(dx, dy)` from its center lies,
 * measured to the nearest edge's line. Its level sets are the hexagon offset with mitered corners,
 * which is exactly what a lattice cell grown or shrunk by a wall is.
 */
const hexDistance = (dx: number, dy: number, a: number) =>
  Math.max(Math.abs(dy), Math.abs(dx) * COS30 + Math.abs(dy) * 0.5) - a;

/**
 * Where the whole ring can be seen from, or null if nowhere can. A stone's table and culet are its
 * girdle shrunk toward one point, and shrunk toward a point outside this they cross the pocket.
 */
function kernelPoint(ring: Ring): Point | null {
  const ccw = orient(ring, true);
  let kernel: Ring = [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of ccw) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  kernel = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
  for (let i = 0; i < ccw.length && kernel.length >= 3; i++) {
    const a = ccw[i] as Point;
    const b = ccw[(i + 1) % ccw.length] as Point;
    kernel = clipHalf(kernel, a[0], a[1], b[1] - a[1], a[0] - b[0]);
  }
  if (kernel.length < 3 || area(kernel) < 1e-12) return null;
  return centroid(kernel);
}

/**
 * A hexagon field laid over the glyph and cut back to `bezel` inside its outline.
 *
 * A cell with no outline segment within reach is kept as a hexagon or dropped on one point test.
 * Only a cell the outline passes near is worked, and it is worked on a small distance field of its
 * own, built from the segments in its buckets: the pocket is where both the hexagon less half the
 * wall and the glyph less the bezel are, so it is one level of `max` of their two distances, and a
 * rim bead grown by `g` is the same field read at level `g`.
 */
export function tile(outline: Outline, box: THREE.Box2, o: TileOptions): Tiling {
  const A = o.pitch / 2;
  const R = A / COS30;
  const h = o.pitch / RES;
  const inner = A - o.wall / 2;
  const whole = 2 * Math.sqrt(3) * inner * inner;
  const cap = (o.wall / 2) * REACH;
  // Every pocket at every growth the bead is allowed lies inside the cell's circumcircle.
  const clear = R + o.bezel;

  const cells: { cx: number; cy: number; kind: 'whole' | 'edge' }[] = [];
  const midX = (box.min.x + box.max.x) / 2;
  const midY = (box.min.y + box.max.y) / 2;
  const cols = Math.ceil((box.max.x - box.min.x) / 2 / (1.5 * R)) + 1;
  const rows = Math.ceil((box.max.y - box.min.y) / 2 / o.pitch) + 1;
  for (let i = -cols; i <= cols; i++) {
    const cx = midX + i * 1.5 * R;
    const shift = i % 2 ? A : 0;
    for (let j = -rows; j <= rows; j++) {
      const cy = midY + j * o.pitch + shift;
      const near = outline.near(cx - clear, cy - clear, cx + clear, cy + clear);
      if (outline.distance(cx, cy, near, clear + 1) > clear) {
        if (outline.contains(cx, cy)) cells.push({ cx, cy, kind: 'whole' });
      } else {
        cells.push({ cx, cy, kind: 'edge' });
      }
    }
  }

  /** The cell's own field: `max` of its hexagon's distance less half the wall and the glyph's less the bezel. */
  const fieldOf = (cx: number, cy: number): Field => {
    const half = R + 2 * h;
    const size = Math.ceil((2 * half) / h) + 1;
    const x0 = cx - half;
    const y0 = cy - half;
    const x1 = x0 + (size - 1) * h;
    const reach = o.bezel + o.wall + 2 * h;
    const near = outline.near(x0 - reach, y0 - reach, x1 + reach, y0 + (size - 1) * h + reach);
    const data = new Float64Array(size * size);
    for (let j = 0; j < size; j++) {
      const y = y0 + j * h;
      // Inside-ness walked in from the row's right end, which is the only full test the row needs:
      // every crossing between there and a grid point is a segment inside the grid, so it is near.
      let inside = outline.contains(x1, y);
      const xs = outline.crossings(y, near);
      let k = xs.length - 1;
      while (k >= 0 && (xs[k] as number) > x1) k--;
      for (let i = size - 1; i >= 0; i--) {
        const x = x0 + i * h;
        for (; k >= 0 && (xs[k] as number) > x; k--) inside = !inside;
        const hex = hexDistance(x - cx, y - cy, A) + o.wall / 2;
        // Above every level a bead reads, and more than a step from any crossing of one.
        if (hex > cap + 2 * h) {
          data[j * size + i] = hex;
          continue;
        }
        const d = outline.distance(x, y, near, reach);
        data[j * size + i] = Math.max(hex, (inside ? -d : d) + o.bezel);
      }
    }
    return {
      data,
      size,
      emPerCell: h,
      originX: x0,
      originY: y0,
      sample: () => Number.NaN,
    };
  };

  /** Closed rings at `level`, with the closing point `isoContours` repeats taken off. */
  const ringsAt = (field: Field, level: number): Ring[] =>
    isoContours(field, level)
      .map((line) => dedupe(fromPoints(line)))
      .filter((ring) => ring.length >= 3);

  /** The smallest ring that encloses `p` — the component `p` lies in, not one around it. */
  const around = (rings: Ring[], p: Point): Ring | null => {
    let best: Ring | null = null;
    let bestArea = Number.POSITIVE_INFINITY;
    for (const ring of rings) {
      if (!insideRing(ring, p[0], p[1])) continue;
      const a = area(ring);
      if (a < bestArea) {
        best = ring;
        bestArea = a;
      }
    }
    return best;
  };

  // Kept from the cut for the first bead, which is almost always the only one, then let go.
  const fields = new Map<string, Field>();
  const pockets: Pocket[] = [];
  let kept = 0;
  let clipped = 0;
  let holed = 0;
  let bent = 0;
  for (const cell of cells) {
    if (cell.kind === 'whole') {
      pockets.push({
        ring: hexagon(cell.cx, cell.cy, inner),
        at: [cell.cx, cell.cy],
        cx: cell.cx,
        cy: cell.cy,
        whole: true,
      });
      kept++;
      continue;
    }
    const field = fieldOf(cell.cx, cell.cy);
    fields.set(`${cell.cx},${cell.cy}`, field);
    const pieces: Pocket[] = [];
    for (const group of nest(ringsAt(field, 0))) {
      if (group.length > 1) {
        holed++;
        continue;
      }
      const ring = group[0] as Ring;
      if (area(ring) < whole * o.minArea) continue;
      const at = kernelPoint(ring);
      if (!at) {
        bent++;
        continue;
      }
      pieces.push({ ring, at, cx: cell.cx, cy: cell.cy, whole: false });
    }
    // Two pieces of one cell that the widest bead would join share a rim, which no stitch closes.
    // The field's levels nest, so a join at any growth shows up at the widest one.
    if (pieces.length === 1) {
      pockets.push(pieces[0] as Pocket);
      clipped++;
      continue;
    }
    const widest = ringsAt(field, cap);
    const claimed = new Map<Ring, Pocket>();
    for (const piece of pieces.sort((a, b) => area(b.ring) - area(a.ring))) {
      const rim = around(widest, piece.at);
      if (!rim || claimed.has(rim)) continue;
      claimed.set(rim, piece);
      pockets.push(piece);
      clipped++;
    }
  }

  const bead = (growths: readonly number[]): Ring[][] => {
    const reach = growths.map((g) => Math.min(g, cap));
    const rings = pockets.map((pocket) => {
      if (pocket.whole) return reach.map((g) => hexagon(pocket.cx, pocket.cy, inner + g));
      const k = `${pocket.cx},${pocket.cy}`;
      let field = fields.get(k);
      if (!field) {
        field = fieldOf(pocket.cx, pocket.cy);
        fields.set(k, field);
      }
      return reach.map((g) => {
        if (g === 0) return pocket.ring;
        const ring = around(ringsAt(field as Field, g), pocket.at);
        return ring ?? pocket.ring;
      });
    });
    fields.clear();
    return rings;
  };

  return { pockets, whole: kept, clipped, holed, bent, bead };
}

/** The glyph's rings as the shell's front face sees them: sampled the way the face is, corners cut. */
export function outlineRings(shapes: readonly THREE.Shape[]): Ring[] {
  const rings: Ring[] = [];
  for (const shape of chamfered(shapes as THREE.Shape[], DEFAULT_GLYPH_OPTIONS)) {
    rings.push(dedupe(fromPoints(shape.getPoints())));
    for (const hole of shape.holes) rings.push(dedupe(fromPoints(hole.getPoints())));
  }
  return rings.filter((ring) => ring.length >= 3);
}

/**
 * Symbolic perturbation, a millionth of a cell. A lattice puts whole rows of pockets on one line,
 * and three points from two rings on one line is a zero-area ear the face's triangulation cannot
 * walk back — `pave.ts` does the same for the same reason.
 */
const nudge = (ring: Ring, at: Point, i: number): Ring => {
  const k = 1 - (i + 1) * 4e-9;
  return orient(
    ring.map(([x, y]): Point => [at[0] + (x - at[0]) * k, at[1] + (y - at[1]) * k]),
    false,
  );
};

/**
 * A regular hexagon field clipped to the letter, rather than a field derived from it. It needs no
 * `Region` — the one argument every cutter takes and this one ignores — which is the distance
 * field whose build is most of what a `pave` letter costs.
 */
export const tileCutter: Cutter = (shapes, _region, spec: WellSpec): Cut => {
  const opts: TileOptions = {
    pitch: spec.pitch,
    wall: spec.wall ?? DEFAULT_TILE.wall,
    bezel: spec.bezel,
    minArea: spec.minArea ?? DEFAULT_TILE.minArea,
  };
  const rings = outlineRings(shapes);
  const box = { min: { x: Infinity, y: Infinity }, max: { x: -Infinity, y: -Infinity } };
  for (const ring of rings) {
    for (const [x, y] of ring) {
      box.min.x = Math.min(box.min.x, x);
      box.min.y = Math.min(box.min.y, y);
      box.max.x = Math.max(box.max.x, x);
      box.max.y = Math.max(box.max.y, y);
    }
  }
  if (rings.length === 0) return { wells: [], seats: [], floor: spec.floor };
  const tiling = tile(new Outline(rings, opts.pitch), box as THREE.Box2, opts);
  const pockets = tiling.pockets.map((p, i) => nudge(p.ring, p.at, i));
  const seats: Seat[] = tiling.pockets.map((pocket, i) => {
    const ring = pockets[i] as Ring;
    const [x, y] = pocket.at;
    let half = 0;
    for (const [px, py] of ring) half = Math.max(half, Math.hypot(px - x, py - y));
    return { x, y, half, outline: ring.map(([px, py]): Point => [px - x, py - y]) };
  });
  return {
    wells: pockets.map(toPath),
    bead: (growths) =>
      tiling
        .bead(growths)
        .map((steps, i) =>
          steps.map((ring) => toPath(nudge(ring, (tiling.pockets[i] as Pocket).at, i))),
        ),
    seats,
    floor: spec.floor,
  };
};
