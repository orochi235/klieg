import type * as THREE from 'three';
import { biarcBlend, endsOf, type Fillet } from './bend.js';
import type { CornerDecision } from './decide.js';
import type { Hairpin } from './hairpin.js';
import { bendThrough, indexPast, keptByTail, legDirection, resumeAt, trimTail } from './legs.js';
import { type CutRepairId, popStretch, type RepairReport, type RepairSite } from './repairs.js';
import type { Rejoin } from './runs.js';

/** Whether the junction where a blend meets the leg's own next vertex clears the floor. */
function clearsInto(
  a: THREE.Vector3 | undefined,
  mid: THREE.Vector3,
  b: THREE.Vector3 | undefined,
  rhoMin: number,
): boolean {
  return !a || !b || bendThrough(a, mid, b) >= rhoMin;
}

/** How far along a leg a bridge may reach for room, as a multiple of the minimum bend radius. */
const BRIDGE_REACH = 3;
/** Window of leg vertices a relax may move, and the ceiling on how far it may move one. */
const RELAX_WINDOW = 6;
const RELAX_TRAVEL = 0.5;

/**
 * A blend from the leg onto the arc's entry, reaching back along the leg until one clears `rhoMin`.
 * Every candidate is tested rather than stopping at the first failure, because a blend's tightest
 * radius is not monotone in the room it is given.
 */
function bridgeBefore(
  leg: THREE.Vector3[],
  entry: THREE.Vector3,
  into: THREE.Vector3,
  rhoMin: number,
  spacing: number,
): { points: THREE.Vector3[]; at: number } | null {
  const from = leg.length - 1;
  let along = 0;
  for (let i = from; i >= 1; i--) {
    const p = leg[i] as THREE.Vector3;
    if (i < from) along += p.distanceTo(leg[i + 1] as THREE.Vector3);
    if (along > BRIDGE_REACH * rhoMin) break;
    const t = legDirection(leg, i, -1);
    if (!t) continue;
    const blend = biarcBlend(p, t, entry, into, rhoMin, spacing);
    // The blend holds `rhoMin` across its own two arcs by construction, but the vertex the leg
    // arrives on is not one of them: the junction into it is the same bend `resumeAt` walks for.
    if (blend && clearsInto(leg[i - 1], p, blend[1], rhoMin)) return { points: blend, at: i };
  }
  return null;
}

/** The same blend on the outgoing side, from the arc's exit onto the leg. */
function bridgeAfter(
  leg: THREE.Vector3[],
  from: number,
  exit: THREE.Vector3,
  outOf: THREE.Vector3,
  rhoMin: number,
  spacing: number,
): { points: THREE.Vector3[]; at: number } | null {
  let along = 0;
  for (let i = Math.max(1, from); i < leg.length; i++) {
    const p = leg[i] as THREE.Vector3;
    if (i > from) along += p.distanceTo(leg[i - 1] as THREE.Vector3);
    if (along > BRIDGE_REACH * rhoMin) break;
    const t = legDirection(leg, i, 1);
    if (!t) continue;
    const blend = biarcBlend(exit, outOf, p, t, rhoMin, spacing);
    if (blend && clearsInto(blend[blend.length - 2], p, leg[i + 1], rhoMin)) {
      // The blend's own last point is a copy of `p`; the leg's vector carries the provenance.
      blend[blend.length - 1] = p;
      return { points: blend, at: i };
    }
  }
  return null;
}

/**
 * Records that `copy` stands in for `source`, so a vertex copied out of a leg keeps the leg's
 * provenance instead of resolving to null and reading as geometry the corner stage built.
 */
export type Inherit = (copy: THREE.Vector3, source: THREE.Vector3) => void;

/**
 * Pushes the leg vertices next to the arc away from their own centre of curvature until the chain
 * through them clears `rhoMin`. Copies rather than moving the path's own vectors: a leg is shared
 * with the span on its other side, and with the provenance map that `from` is resolved through.
 *
 * Null when clearing would cost more than `RELAX_TRAVEL` of a bend radius — past that the contour
 * has been redrawn rather than nudged, and the caller is better off with its own fallback.
 */
function relaxOnto(
  anchor: THREE.Vector3[],
  leg: THREE.Vector3[],
  from: number,
  step: 1 | -1,
  rhoMin: number,
  inherit: Inherit,
): THREE.Vector3[] | null {
  const moved: THREE.Vector3[] = [];
  for (let k = 0; k < RELAX_WINDOW; k++) {
    const p = leg[from + k * step] as THREE.Vector3 | undefined;
    if (!p) break;
    const copy = p.clone();
    inherit(copy, p);
    moved.push(copy);
  }
  if (moved.length < 2) return null;

  // The chain the invariant is measured over: the arc's last two points, then the leg's own.
  const chain = [...anchor, ...moved];
  const fixed = anchor.length;
  const nudge = rhoMin * 0.004;
  let travel = 0;
  for (let pass = 0; pass < 400; pass++) {
    let worst = Number.POSITIVE_INFINITY;
    let worstAt = -1;
    for (let i = 1; i + 1 < chain.length; i++) {
      const rho = bendThrough(
        chain[i - 1] as THREE.Vector3,
        chain[i] as THREE.Vector3,
        chain[i + 1] as THREE.Vector3,
      );
      if (rho < worst) {
        worst = rho;
        worstAt = i;
      }
    }
    if (worst >= rhoMin) return moved;
    // Only the copied leg vertices move; the arc is what the whole stage exists to hold.
    if (worstAt < fixed) worstAt = fixed;
    if (worstAt + 1 >= chain.length) return null;
    const cur = chain[worstAt] as THREE.Vector3;
    const away = cur.clone().sub(
      (chain[worstAt - 1] as THREE.Vector3)
        .clone()
        .add(chain[worstAt + 1] as THREE.Vector3)
        .multiplyScalar(0.5),
    );
    if (away.lengthSq() < 1e-18) return null;
    cur.addScaledVector(away.normalize(), nudge);
    travel += nudge;
    if (travel > RELAX_TRAVEL * rhoMin * RELAX_WINDOW) return null;
  }
  return null;
}

/**
 * Swaps a hairpin in for the corner. `bisector` is tangent to the legs past the apex and takes over
 * none of them, so the apex vertex itself stays; `uturn` blends from `reach` back along each leg and
 * the stretch between is dropped.
 */
function spliceHairpin(
  target: THREE.Vector3[],
  next: THREE.Vector3[],
  decision: CornerDecision,
  pin: Hairpin,
): void {
  const apex = target[target.length - 1] as THREE.Vector3;
  const head = pin.points[0] as THREE.Vector3;
  const tail = pin.points[pin.points.length - 1] as THREE.Vector3;
  // Cut exactly where the hairpin picked up, not by distance from the apex: a `uturn` blends from a
  // named leg vertex, and a trim that stops one vertex short of it doubles back over the blend.
  const from = target.lastIndexOf(head);
  if (from >= 0) target.length = from;
  else {
    for (let i = 0; i < decision.groupBefore && target.length > 1; i++) target.pop();
    if (pin.reach > 0) trimTail(target, pin.reach, apex);
  }
  decision.at = pin.points[pin.points.length >> 1];
  for (const p of pin.points) target.push(p);

  const to = next.indexOf(tail);
  const start =
    to >= 0
      ? to + 1
      : pin.reach > 0
        ? indexPast(next, decision.groupAfter + 1, pin.reach, apex)
        : 1;
  for (let i = start; i < next.length; i++) target.push(next[i] as THREE.Vector3);
}

/**
 * Appends `next` onto `target`, which already ends at the shared corner.
 *
 * `rejoin` chooses what happens on each side when the leg cannot meet the arc without bending under
 * `rhoMin`. Every strategy falls back to `drop`'s walk, so none is ever worse than it.
 */
export function mergeArc(
  target: THREE.Vector3[],
  next: THREE.Vector3[],
  decision: CornerDecision,
  fillet: Fillet | null,
  rhoMin: number,
  spacing: number,
  rejoin: Rejoin,
  inherit: Inherit,
  on: (id: CutRepairId) => boolean,
  report: RepairReport,
): void {
  if (decision.hairpin && decision.strategy === 'hairpin') {
    spliceHairpin(target, next, decision, decision.hairpin);
    return;
  }
  if (!fillet) {
    for (let i = 1; i < next.length; i++) target.push(next[i] as THREE.Vector3);
    return;
  }
  const n = fillet.points.length;
  const { entry, exit, second, penult } = endsOf(fillet);
  const into = entry.clone().sub(second).normalize();
  const outOf = exit.clone().sub(penult).normalize();

  // Drop the corner's whole stretch before trimming by distance: a shallow turn's setback can be
  // shorter than one sample step, and would leave the stretch's own vertices in the path.
  const stretchCount = Math.min(decision.groupBefore + 1, target.length);
  const stretchSite: RepairSite = {
    at: target.length - 1,
    points: [],
    removed: target.slice(target.length - stretchCount),
    side: 'entry',
  };
  const ranStretch = on('stretch');
  if (ranStretch) popStretch(target, decision.groupBefore + 1);
  report('stretch', stretchSite, ranStretch);
  // Indexes the accumulator before the trim; a consumer must not map it onto the post-trim span.
  const setbackKeep = keptByTail(target, fillet.setback, fillet.corner);
  const setbackSite: RepairSite = {
    at: target.length - 1,
    points: [],
    removed: target.slice(setbackKeep),
    side: 'entry',
  };
  const ranSetback = on('setback');
  if (ranSetback) trimTail(target, fillet.setback, fillet.corner);
  report('setback', setbackSite, ranSetback);

  let bridgedIn: THREE.Vector3[] | null = null;
  if (rejoin === 'bridge') {
    const blend = bridgeBefore(target, entry, second.clone().sub(entry), rhoMin, spacing);
    if (blend) {
      target.length = blend.at + 1;
      bridgedIn = blend.points;
    }
  }
  // Gates only the walk's trim below: bridge and relax apply their own geometry regardless, so a
  // `ran: false` report under either still describes points that are actually in the target.
  const ranResume = on('resume');
  if (bridgedIn) {
    report(
      'resume',
      { at: target.length - 1, points: bridgedIn, removed: [], side: 'entry' },
      ranResume,
    );
  }
  if (!bridgedIn) {
    let relaxed: THREE.Vector3[] | null = null;
    if (rejoin === 'relax') {
      relaxed = relaxOnto([second, entry], target, target.length - 1, -1, rhoMin, inherit);
      if (relaxed) {
        target.length = Math.max(0, target.length - relaxed.length);
        for (let i = relaxed.length - 1; i >= 0; i--) target.push(relaxed[i] as THREE.Vector3);
      }
    }
    if (relaxed) {
      report(
        'resume',
        { at: target.length - 1, points: relaxed, removed: [], side: 'entry' },
        ranResume,
      );
    } else {
      const keep = resumeAt(target, target.length - 1, -1, entry, second, into, rhoMin, spacing);
      report(
        'resume',
        { at: keep, points: [], removed: target.slice(keep + 1), side: 'entry' },
        ranResume,
      );
      if (ranResume) target.length = keep + 1;
    }
  }

  decision.at = fillet.points[n >> 1];
  // Never the blend's own last point: it is a copy of the arc's entry, and `splitReturn` finds the
  // fillet in a span by identity.
  if (bridgedIn) {
    for (let i = 1; i + 1 < bridgedIn.length; i++) target.push(bridgedIn[i] as THREE.Vector3);
  }
  for (const p of fillet.points) target.push(p);

  // `at` is the first vertex of `next` kept past the setback — the far-side boundary, opposite end
  // from the entry-side site above.
  const pastSetback = indexPast(next, decision.groupAfter + 1, fillet.setback, fillet.corner);
  const ranExitSetback = on('setback');
  // The vertices the walk skips are exactly the two starts below it: switching the repair off
  // resumes at `groupAfter + 1` instead, so the span between them is what running it removes.
  report(
    'setback',
    {
      at: pastSetback,
      points: [],
      removed: next.slice(decision.groupAfter + 1, pastSetback),
      side: 'exit',
    },
    ranExitSetback,
  );
  const start = ranExitSetback ? pastSetback : decision.groupAfter + 1;
  const ranExitResume = on('resume');
  if (rejoin === 'bridge') {
    const blend = bridgeAfter(next, start, exit, outOf, rhoMin, spacing);
    if (blend) {
      report(
        'resume',
        { at: start, points: blend.points, removed: [], side: 'exit' },
        ranExitResume,
      );
      for (let i = 1; i < blend.points.length; i++) target.push(blend.points[i] as THREE.Vector3);
      for (let i = blend.at + 1; i < next.length; i++) target.push(next[i] as THREE.Vector3);
      return;
    }
  }
  if (rejoin === 'relax' && start < next.length) {
    const relaxed = relaxOnto([penult, exit], next, start, 1, rhoMin, inherit);
    if (relaxed) {
      report('resume', { at: start, points: relaxed, removed: [], side: 'exit' }, ranExitResume);
      for (const p of relaxed) target.push(p);
      for (let i = start + relaxed.length; i < next.length; i++) {
        target.push(next[i] as THREE.Vector3);
      }
      return;
    }
  }
  const from = resumeAt(next, start, 1, exit, penult, outOf, rhoMin, spacing);
  report(
    'resume',
    { at: from, points: [], removed: next.slice(start, from), side: 'exit' },
    ranExitResume,
  );
  const walkFrom = ranExitResume ? from : start;
  for (let i = walkFrom; i < next.length; i++) target.push(next[i] as THREE.Vector3);
}
