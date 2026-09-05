import type { Point2 } from '../tube/field.js';

export type Point = [number, number];
export type Ring = Point[];

/** A ring and the rings it encloses — a letter and its counters, or a well and the islands in it. */
export interface Nested {
  outer: Ring;
  holes: Ring[];
}

const at = (ring: Ring, i: number): Point =>
  ring[((i % ring.length) + ring.length) % ring.length] as Point;

export function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = ring[i] as Point;
    const q = ring[j] as Point;
    a += q[0] * p[1] - p[0] * q[1];
  }
  return a / 2;
}

/**
 * Coincident points dropped, then every point on the line between its neighbours.
 *
 * The straight one matters as much as the duplicate. `triangulateShape` filters a collinear point
 * out before triangulating, so a cap's boundary skips it while the wall stitched off the same ring
 * walks it — the two edges cannot cancel and the shell is open all along that side.
 */
export function dedupe(ring: Ring): Ring {
  let out = ring.filter((p, i) => {
    const q = at(ring, i - 1);
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9;
  });
  for (let again = true; again && out.length > 3; ) {
    again = false;
    const keep = out.filter((p, i) => {
      const a = at(out, i - 1);
      const b = at(out, i + 1);
      const cross = (p[1] - a[1]) * (b[0] - p[0]) - (p[0] - a[0]) * (b[1] - p[1]);
      return Math.abs(cross) > 1e-14;
    });
    if (keep.length !== out.length && keep.length >= 3) {
      out = keep;
      again = true;
    }
  }
  return out;
}

/**
 * Wound so the metal is on the ring's left, which is what lets one stitch serve a letter, a
 * counter, a well and an island standing in one. `metalInside` is whether the material is enclosed
 * by the ring or surrounds it.
 */
export function orient(ring: Ring, metalInside: boolean): Ring {
  const clean = dedupe(ring);
  return signedArea(clean) > 0 === metalInside ? clean : clean.slice().reverse();
}

/**
 * A ring walked at a fixed spacing. An iso-contour arrives at the field's own resolution and its
 * staircase is finer than any bead the letter carries: a level outline on an R goes from 1,964
 * points to 300 and reads the same.
 */
export function resample(ring: Ring, spacing: number): Ring {
  const n = ring.length;
  if (n < 2) return ring.slice();
  let total = 0;
  for (let i = 0; i < n; i++) {
    const p = ring[i] as Point;
    const q = at(ring, i + 1);
    total += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  const steps = Math.max(8, Math.round(total / spacing));
  const step = total / steps;
  const out: Ring = [];
  let carried = 0;
  let want = 0;
  for (let i = 0; i < n && out.length < steps; i++) {
    const a = ring[i] as Point;
    const b = at(ring, i + 1);
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (want < carried + seg && out.length < steps) {
      const t = (want - carried) / (seg || 1);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      want += step;
    }
    carried += seg;
  }
  return out;
}

/** Three passes of the same filter the tube pipeline runs, against the same staircase. */
export function smooth(ring: Ring, passes: number): Ring {
  let out = ring;
  for (let k = 0; k < passes && out.length > 0; k++) {
    const from = out;
    out = from.map((p, i): Point => {
      const a = at(from, i - 1);
      const b = at(from, i + 1);
      return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
    });
  }
  return out;
}

export function insideRing(ring: Ring, px: number, py: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as Point;
    const b = ring[j] as Point;
    if (a[1] > py !== b[1] > py && px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]) {
      hit = !hit;
    }
  }
  return hit;
}

/**
 * Loops grouped into contours and their holes by containment depth. `isoContours` answers rings
 * with no nesting at all, and a well inside a letter can hold an island holding a counter — four
 * deep, which a flat contour-with-holes cannot say.
 */
export function nest(loops: Ring[]): Ring[][] {
  const head = (r: Ring) => r[0] as Point;
  const depth = loops.map((r, i) =>
    loops.reduce(
      (n, other, j) => (i !== j && insideRing(other, head(r)[0], head(r)[1]) ? n + 1 : n),
      0,
    ),
  );
  const parent = loops.map((r, i) => {
    let best = -1;
    for (let j = 0; j < loops.length; j++) {
      if (i === j || !insideRing(loops[j] as Ring, head(r)[0], head(r)[1])) continue;
      if (best === -1 || (depth[j] as number) > (depth[best] as number)) best = j;
    }
    return best;
  });
  return loops
    .map((loop, i) => ({ loop, i }))
    .filter(({ i }) => (depth[i] as number) % 2 === 0)
    .map(({ loop, i }) => [
      loop,
      ...loops.filter((_, j) => (depth[j] as number) % 2 === 1 && parent[j] === i),
    ]);
}

/** Clip a convex polygon by the line through `(ax, ay)` with normal `(nx, ny)`, keeping behind. */
export function clipHalf(poly: Ring, ax: number, ay: number, nx: number, ny: number): Ring {
  const out: Ring = [];
  const side = (p: Point) => (p[0] - ax) * nx + (p[1] - ay) * ny;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Point;
    const b = at(poly, i + 1);
    const da = side(a);
    const db = side(b);
    if (da <= 0) out.push(a);
    if (da <= 0 !== db <= 0) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/**
 * Every edge of a convex polygon pushed in by `d`, or out by it when `d` is negative.
 *
 * The line moves *against* its own outward normal, because `clipHalf` keeps what is behind it:
 * pushing it the way the normal points grows the polygon instead, which leaves neighbouring cells
 * sharing the wall they were meant to be separated by.
 */
export function shrink(poly: Ring, d: number): Ring {
  let out = poly;
  for (let i = 0; i < poly.length && out.length >= 3; i++) {
    const a = poly[i] as Point;
    const b = at(poly, i + 1);
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1e-12;
    const nx = ey / len;
    const ny = -ex / len;
    out = clipHalf(out, a[0] - nx * d, a[1] - ny * d, nx, ny);
  }
  return out;
}

export const toPoints = (ring: Ring): Point2[] => ring.map(([x, y]) => ({ x, y }));
export const fromPoints = (points: readonly Point2[]): Ring => points.map((p): Point => [p.x, p.y]);
