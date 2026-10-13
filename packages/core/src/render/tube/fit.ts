import type * as THREE from 'three';
import { type Corner, endsOf, type Fillet, filletAt } from './bend.js';
import { type Hairpin, type HairpinShape, hairpinAt } from './hairpin.js';
import {
  indexPast,
  legDirection,
  legIntersection,
  polyLength,
  resumeAt,
  trimTail,
} from './legs.js';
import type { Rejoin } from './runs.js';

/**
 * Where the legs either side of a corner start, and which way each runs away from it. Measured
 * outside the corner's whole stretch, not either side of its tightest vertex: the neighbouring
 * vertices are part of the same rounded corner, and a direction taken across one of them is
 * already turning.
 */
function legsAround(
  target: THREE.Vector3[],
  next: THREE.Vector3[],
  corner: Corner,
): {
  iA: number;
  iB: number;
  a: THREE.Vector3;
  b: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
} | null {
  const iA = target.length - 2 - corner.groupBefore;
  const iB = corner.groupAfter + 1;
  const a = target[iA] as THREE.Vector3 | undefined;
  const b = next[iB] as THREE.Vector3 | undefined;
  if (iA < 1 || !a || !b) return null;
  const u = legDirection(target, iA, -1);
  const v = legDirection(next, iB, 1);
  if (!u || !v) return null;
  return { iA, iB, a, b, u, v };
}

/**
 * The fillet for the join between `target` and `next`, or null when there is no room for one.
 * Probes with a synthetic three-point path whose legs are the arc length actually available either
 * side: the room test is against the leg, not against one 0.02 sample step, which every setback
 * would exceed.
 */
export function filletFor(
  target: THREE.Vector3[],
  next: THREE.Vector3[],
  corner: Corner,
  rhoMin: number,
  spacing: number,
  rejoin: Rejoin = 'drop',
): Fillet | null {
  const legs = legsAround(target, next, corner);
  if (!legs) return null;
  // Each leg line passes through its anchor vertex, so the fillet's tangent point stays collinear
  // with the path there and the join cannot kink.
  const { iA, iB, a, b, u, v } = legs;

  const virtual = legIntersection(a, u, b, v);
  if (!virtual) return null;
  // Near-parallel legs put the apex a long way from where the path actually turns, and the arc
  // built there splices in somewhere the corner is not. A fit that disagrees with detection by
  // more than a bend radius is not describing this corner.
  const vertex = target[target.length - 1] as THREE.Vector3;
  if (virtual.distanceTo(vertex) > rhoMin) return null;

  // Room runs from the virtual corner: back to `a` and then down the rest of the leg.
  const back = Math.max(0, virtual.clone().sub(a).dot(u)) + polyLength(target.slice(0, iA + 1));
  const fwd = Math.max(0, b.clone().sub(virtual).dot(v)) + polyLength(next.slice(iB));

  const probe = [
    virtual.clone().addScaledVector(u, -back),
    virtual.clone(),
    virtual.clone().addScaledVector(v, fwd),
  ];
  const at = (radius: number): Fillet | null => {
    const fillet = filletAt(probe, false, 1, radius, spacing);
    if (!fillet) return null;
    // A fillet cuts the corner back on both sides. One whose tangent point lands past the corner
    // vertex instead is inverted: the leg would run out to it and reverse, and the room test reads
    // that consumption as near zero rather than as the overrun it is.
    const { entry, exit } = endsOf(fillet);
    if (entry.clone().sub(vertex).dot(u) > 0 || exit.clone().sub(vertex).dot(v) < 0) return null;
    return fillet;
  };

  const base = at(rhoMin);
  if (rejoin !== 'widen') return base;
  // A wider arc reaches its tangent points further down the leg, past the shoulder the fit reads as
  // straight. The first radius whose own neighbours clear is taken; failing all of them, the
  // minimum arc is still the right answer, and the join falls back to the walk.
  for (const factor of WIDEN_LADDER) {
    const fillet = at(rhoMin * factor);
    if (fillet && joinsAtOnce(target, next, corner, fillet, rhoMin, spacing)) return fillet;
  }
  return base;
}

/**
 * The hairpin for the join between `target` and `next`, built off the same averaged leg directions
 * a fillet is. The apex is the corner's own vertex rather than the legs' intersection: a hairpin
 * turns around the point the reader sees, and the virtual corner a fillet is fitted to can sit a
 * bend radius away from it.
 */
export function hairpinFor(
  target: THREE.Vector3[],
  next: THREE.Vector3[],
  corner: Corner,
  shape: HairpinShape,
  rhoMin: number,
  spacing: number,
): Hairpin | null {
  const legs = legsAround(target, next, corner);
  if (!legs) return null;
  const { u, v } = legs;

  const pin = hairpinAt(target, next, u, v, shape, rhoMin, spacing);
  // A hairpin that reaches back further than the leg it reaches along has nothing to attach to.
  if (!pin) return null;
  if (pin.reach > polyLength(target) || pin.reach > polyLength(next)) return null;
  return pin;
}

/** Radii a `widen` rejoin tries, as multiples of the minimum. */
const WIDEN_LADDER = [1, 1.3, 1.7, 2.2, 3];

/**
 * Where each leg picks up again around a fillet, on both sides at once. `keep` is the entry-side
 * leg's last surviving index and `from` the exit-side leg's first; `at` and `start` are where each
 * walk began, so a walk that never moved is `keep === at` and `from === start`.
 */
function rejoinWalk(
  target: THREE.Vector3[],
  next: THREE.Vector3[],
  corner: Corner,
  fillet: Fillet,
  rhoMin: number,
  spacing: number,
): { keep: number; at: number; from: number; start: number } {
  const { entry, exit, second, penult } = endsOf(fillet);

  const before = target.slice(0, Math.max(0, target.length - 1 - corner.groupBefore));
  trimTail(before, fillet.setback, fillet.corner);
  const at = before.length - 1;
  const keep = resumeAt(
    before,
    at,
    -1,
    entry,
    second,
    entry.clone().sub(second).normalize(),
    rhoMin,
    spacing,
  );

  const start = indexPast(next, corner.groupAfter + 1, fillet.setback, fillet.corner);
  const from = resumeAt(
    next,
    start,
    1,
    exit,
    penult,
    exit.clone().sub(penult).normalize(),
    rhoMin,
    spacing,
  );
  return { keep, at, from, start };
}

/**
 * Whether both legs meet this fillet at the first vertex clear of its setback — the test a `widen`
 * grows the arc to satisfy, and the condition under which `resumeAt` would not walk at all.
 */
function joinsAtOnce(
  target: THREE.Vector3[],
  next: THREE.Vector3[],
  corner: Corner,
  fillet: Fillet,
  rhoMin: number,
  spacing: number,
): boolean {
  const walk = rejoinWalk(target, next, corner, fillet, rhoMin, spacing);
  return walk.keep === walk.at && walk.from === walk.start;
}

/**
 * Whether joining through this fillet would cost a whole leg. `resumeAt` answers "nowhere on this
 * leg clears the floor" with an out-of-range index, and the stitch applies it literally: the entry
 * side truncates to nothing and the exit side copies nothing, leaving a stub of fillet where the
 * stroke was. Cinzel's `C` loses 2.4 em of a 3.8 em contour that way and renders as a gap.
 */
export function wipesALeg(
  target: THREE.Vector3[],
  next: THREE.Vector3[],
  corner: Corner,
  fillet: Fillet,
  rhoMin: number,
  spacing: number,
): boolean {
  const walk = rejoinWalk(target, next, corner, fillet, rhoMin, spacing);
  return walk.keep < 0 || walk.from >= next.length;
}
