import type * as THREE from 'three';
import { type Corner, cornersByBend, endsOf, type Fillet } from './bend.js';
import { type CornerDecision, type Draw, decideCorners } from './decide.js';
import type { GeneratedPath } from './generators.js';
import type { HairpinShape } from './hairpin.js';
import { legGap } from './legs.js';
import { type Inherit, mergeArc } from './rejoin.js';
import { type CutRepairId, type RepairReport, type RepairSite, trimStretch } from './repairs.js';
import type { CornerWeights, Rejoin } from './runs.js';

/**
 * The points from index `start` to `end` (inclusive), walking forward and wrapping through 0 on
 * a closed path. `start === end` (a single corner) walks the whole loop back to itself.
 */
function arc(points: THREE.Vector3[], start: number, end: number): THREE.Vector3[] {
  const n = points.length;
  const steps = end > start ? end - start : n - start + end;
  const span: THREE.Vector3[] = [];
  for (let s = 0; s <= steps; s++) {
    span.push(points[(start + s) % n] as THREE.Vector3);
  }
  return span;
}

export interface RawSpans {
  /**
   * Points between consecutive corners. Closed: `arcs[k]` starts at `corners[k]` and ends at
   * `corners[(k + 1) % n]`, so `arcs.length === corners.length`. Open: `arcs[k]` ends at
   * `corners[k]` and `arcs[k + 1]` starts there, so `arcs.length === corners.length + 1`.
   */
  arcs: THREE.Vector3[][];
  corners: Corner[];
}

export function rawSpansOf(path: GeneratedPath, rhoMin: number, rhoStyle: number): RawSpans {
  const { points, closed } = path;
  const corners = cornersByBend(points, closed, rhoMin, rhoStyle);

  if (corners.length === 0) {
    const whole = closed ? [...points, points[0] as THREE.Vector3] : points.slice();
    return { arcs: [whole], corners: [] };
  }

  if (closed) {
    const arcs: THREE.Vector3[][] = [];
    for (let k = 0; k < corners.length; k++) {
      const start = corners[k] as Corner;
      const end = corners[(k + 1) % corners.length] as Corner;
      arcs.push(arc(points, start.index, end.index));
    }
    return { arcs, corners };
  }

  const arcs: THREE.Vector3[][] = [];
  const cuts = [0, ...corners.map((c) => c.index), points.length - 1];
  for (let k = 0; k < cuts.length - 1; k++) {
    const start = cuts[k] as number;
    const end = cuts[k + 1] as number;
    arcs.push(points.slice(start, end + 1));
  }
  return { arcs, corners };
}

/**
 * A break cuts the whole corner stretch out, not just the vertex detection collapsed it to. The
 * neighbouring vertices are the same corner; left on a run's end they are tube still bending
 * tighter than rhoMin, with no corner stage left to fix them.
 *
 * Returns the site alongside the trimmed span so the caller can gate one and report the other; the
 * floor is two vertices, unlike the corner-side `popStretch`, because a break's product still has
 * to sweep.
 */
function dropEnd(
  span: THREE.Vector3[],
  count: number,
  end: 'head' | 'tail',
): { points: THREE.Vector3[]; site: RepairSite } {
  const kept = trimStretch(span, count, end);
  const removed =
    end === 'tail' ? span.slice(kept.length) : span.slice(0, span.length - kept.length);
  return {
    points: kept,
    site: { at: end === 'tail' ? kept.length - 1 : 0, points: [], removed },
  };
}

/**
 * Splits a span that has just been merged through a return into the lit stretch before it, the dark
 * stretch carrying the corner, and the lit stretch after. The dark stretch is the fillet and one
 * sample either side — the same corner a break used to remove outright, so the lit strokes land
 * where they always did and only the glass between them is new.
 */
function splitReturn(span: THREE.Vector3[], fillet: Fillet, margin: number): [Span, Span, Span] {
  const ends = endsOf(fillet);
  const entry = span.indexOf(ends.entry);
  const exit = span.indexOf(ends.exit);
  const back = (from: number) => {
    let along = 0;
    for (let i = from; i > 0; i--) {
      along += (span[i] as THREE.Vector3).distanceTo(span[i - 1] as THREE.Vector3);
      if (along >= margin) return i - 1;
    }
    return 0;
  };
  const forward = (from: number) => {
    let along = 0;
    for (let i = from; i + 1 < span.length; i++) {
      along += (span[i] as THREE.Vector3).distanceTo(span[i + 1] as THREE.Vector3);
      if (along >= margin) return i + 1;
    }
    return span.length - 1;
  };
  const a = entry < 0 ? 0 : back(entry);
  const b = exit < 0 ? span.length - 1 : forward(exit);
  return [
    { points: span.slice(0, a + 1) },
    { points: span.slice(a, b + 1), dark: true },
    { points: span.slice(b) },
  ];
}

const EPS = 1e-9;

/**
 * Closes a walk that began mid-leg, onto the span that starts there. The last corner's fillet can
 * reach past the point the walk started at, and closing onto it anyway runs the path back along the
 * arc it has just left; the head advances instead, moving the seam rather than reversing at it.
 */
function closeLoop(current: THREE.Vector3[], head: THREE.Vector3[], spacing: number): void {
  const last = current[current.length - 1] as THREE.Vector3 | undefined;
  const prev = current[current.length - 2] as THREE.Vector3 | undefined;
  const origin = head[0] as THREE.Vector3 | undefined;
  if (!last || !prev || !origin || last.distanceTo(origin) <= EPS) return;
  const along = last.clone().sub(prev).normalize();
  while (head.length > 2 && legGap(head[0], last, along) < spacing) head.shift();
  // A seam still inside the arc leaves the cord a gap of at most one sample; a reversal there
  // would read as a bend tighter than anything the fillet was drawn to avoid.
  if (legGap(head[0], last, along) > 0) current.push(head[0] as THREE.Vector3);
}

export interface Span {
  points: THREE.Vector3[];
  /** Set on the stretch a return carries dark across a corner. */
  dark?: boolean;
}

/** Draws a strategy for each corner and stitches the raw arcs into final spans accordingly. */
export function stitchPath(
  raw: RawSpans,
  weights: CornerWeights,
  rhoMin: number,
  spacing: number,
  blockout: number,
  rejoin: Rejoin,
  shape: HairpinShape,
  drawAt: (corner: number, draw: Draw) => number,
  inherit: Inherit,
  on: (id: CutRepairId) => boolean,
  report: RepairReport,
): { spans: Span[]; decisions: CornerDecision[] } {
  const { arcs, corners } = raw;
  if (corners.length === 0) return { spans: arcs.map((points) => ({ points })), decisions: [] };

  const closed = arcs.length === corners.length;
  const decisions = decideCorners(
    raw,
    weights,
    rhoMin,
    spacing,
    blockout,
    rejoin,
    shape,
    drawAt,
    on,
    report,
  );

  // Each step of a walk returns the span it continues on; finished spans go to `out`.
  const cut = (
    current: THREE.Vector3[],
    next: THREE.Vector3[],
    decision: CornerDecision,
    out: Span[],
  ) => {
    const ranStretch = on('stretch');
    const tail = dropEnd(current, decision.groupBefore + 1, 'tail');
    report('stretch', tail.site, ranStretch);
    out.push({ points: ranStretch ? tail.points : current });
    const head = dropEnd(next.slice(), decision.groupAfter + 1, 'head');
    report('stretch', head.site, ranStretch);
    return ranStretch ? head.points : next.slice();
  };
  const merge = (
    current: THREE.Vector3[],
    next: THREE.Vector3[],
    decision: CornerDecision,
    out: Span[],
  ) => {
    mergeArc(
      current,
      next,
      decision,
      decision.fillet ?? null,
      rhoMin,
      spacing,
      rejoin,
      inherit,
      on,
      report,
    );
    if (decision.strategy !== 'return' || !decision.fillet) return current;
    const ranReturn = on('return');
    report(
      'return',
      {
        at: current.indexOf(decision.fillet.points[0] as THREE.Vector3),
        points: decision.fillet.points,
        removed: [],
      },
      ranReturn,
    );
    if (!ranReturn) return current;
    const [head, dark, tail] = splitReturn(current, decision.fillet, spacing);
    out.push(head, dark);
    return tail.points;
  };
  const step = (
    current: THREE.Vector3[],
    next: THREE.Vector3[],
    decision: CornerDecision,
    out: Span[],
  ) =>
    decision.strategy === 'break'
      ? cut(current, next, decision, out)
      : merge(current, next, decision, out);

  if (!closed) {
    const spans: Span[] = [];
    let current = (arcs[0] as THREE.Vector3[]).slice();
    for (let k = 0; k < decisions.length; k++) {
      current = step(
        current,
        arcs[k + 1] as THREE.Vector3[],
        decisions[k] as CornerDecision,
        spans,
      );
    }
    spans.push({ points: current });
    return { spans, decisions };
  }

  const n = arcs.length;
  const breakIdx = decisions.findIndex((d) => d.strategy === 'break');

  if (breakIdx === -1) {
    // No break anywhere: one closed span, cut only where a return goes dark. The walk starts in the
    // *middle* of the first leg rather than on corner 0 — starting on a corner is starting and
    // ending on the same one, and it would be the only corner in the glyph never merged, keeping
    // its raw vertex.
    const closedSpans: Span[] = [];
    const first = arcs[0] as THREE.Vector3[];
    const mid = Math.max(1, Math.min(first.length - 2, first.length >> 1));
    let current = first.slice(mid);
    for (let k = 1; k < n; k++) {
      current = merge(
        current,
        arcs[k] as THREE.Vector3[],
        decisions[k] as CornerDecision,
        closedSpans,
      );
    }
    current = merge(current, first.slice(0, mid + 1), decisions[0] as CornerDecision, closedSpans);
    // A return has already split the span the walk started on off from `current`; the loop closes
    // onto whichever span still begins at the seam.
    const head = closedSpans[0]?.points ?? current;
    const ranClose = on('close');
    // The seam vertex the loop closes onto — closeLoop may shift it or skip the join entirely.
    report('close', { at: current.length - 1, points: head.slice(0, 1), removed: [] }, ranClose);
    if (ranClose) closeLoop(current, head, spacing);
    closedSpans.push({ points: current });
    return { spans: closedSpans, decisions };
  }

  // Rotate so the walk starts right after a break, reducing this to the open-path case.
  const spans: Span[] = [];
  const opening = decisions[breakIdx] as CornerDecision;
  const opened = dropEnd(
    (arcs[breakIdx] as THREE.Vector3[]).slice(),
    opening.groupAfter + 1,
    'head',
  );
  report('stretch', opened.site, on('stretch'));
  let current = on('stretch') ? opened.points : (arcs[breakIdx] as THREE.Vector3[]).slice();
  for (let i = 1; i < n; i++) {
    const arcIdx = (breakIdx + i) % n;
    current = step(
      current,
      arcs[arcIdx] as THREE.Vector3[],
      decisions[arcIdx] as CornerDecision,
      spans,
    );
  }
  const closing = dropEnd(current, opening.groupBefore + 1, 'tail');
  report('stretch', closing.site, on('stretch'));
  spans.push({ points: on('stretch') ? closing.points : current });
  return { spans, decisions };
}
