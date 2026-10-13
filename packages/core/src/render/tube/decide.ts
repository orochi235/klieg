import type * as THREE from 'three';
import type { Corner, Fillet } from './bend.js';
import { filletFor, hairpinFor, wipesALeg } from './fit.js';
import { apexLoss, type Hairpin, type HairpinShape } from './hairpin.js';
import { eatenBy, polyLength } from './legs.js';
import type { CutRepairId, RepairReport } from './repairs.js';
import type { CornerStrategy, CornerWeights, Rejoin } from './runs.js';
import type { RawSpans } from './stitch.js';

/** A weight factor never fully zeroes an option biasing can't rule out entirely. */
const FLOOR = 0.05;
/** Turn past which glass is treated as unable to bend without kinking. */
const CONNECT_LIMIT = Math.PI * 0.75;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Which of a corner's two draws is being taken. */
export type Draw = 0 | 1;
const STRATEGY_DRAW: Draw = 0;
const BLOCKOUT_DRAW: Draw = 1;

/**
 * Keyed on the corner's own index rather than on a running counter: a corner that skips a draw
 * would otherwise shift the stream for every corner after it, so switching a repair off would
 * change corners it has nothing to do with.
 */
export function cornerSeed(seed: number, corner: number, draw: Draw): number {
  return (Math.round(seed * 2654435761) ^ 0x2f2f6a3d ^ (corner * 2 + draw)) >>> 0;
}

export interface CornerDecision extends Corner {
  strategy: CornerStrategy;
  /** How far back along each leg a fillet here would cut, when one is drawn. */
  setback: number;
  /**
   * Where the drawn path actually passes, once a fillet has cut the corner vertex away. Aliases a
   * point of the run, so wander carries it, and the lab's markers stay on the tube.
   */
  at?: THREE.Vector3;
  /** The fillet decided for this corner, measured off the untouched legs. */
  fillet?: Fillet | null;
  /** The hairpin decided for this corner, when it draws one instead. */
  hairpin?: Hairpin | null;
}

/**
 * Which strategy a corner draws, biased toward what the geometry can plausibly carry: a sharp
 * turn favors break and a shallow one favors connect. A pure distribution (one weight nonzero)
 * always picks that one — the bias multiplies a weight, and multiplying zero by anything stays zero.
 */
function pickStrategy(turn: number, weights: CornerWeights, draw: () => number): CornerStrategy {
  const wHairpin = (weights.hairpin ?? 0) * clamp(turn / Math.PI, FLOOR, 1);
  const wBreak = weights.break * clamp(turn / Math.PI, FLOOR, 1);
  const wConnect = weights.connect * clamp(1 - turn / CONNECT_LIMIT, FLOOR, 1);

  const total = wBreak + wConnect + wHairpin;
  if (total <= 0) return 'break';
  const roll = draw() * total;
  if (roll < wHairpin) return 'hairpin';
  return roll < wHairpin + wBreak ? 'break' : 'connect';
}

/**
 * Draws a strategy for each corner, then breaks fillets until every leg has room for the cuts at
 * both its ends.
 */
export function decideCorners(
  raw: RawSpans,
  weights: CornerWeights,
  rhoMin: number,
  spacing: number,
  blockout: number,
  rejoin: Rejoin,
  shape: HairpinShape,
  drawAt: (corner: number, draw: Draw) => number,
  on: (id: CutRepairId) => boolean,
  report: RepairReport,
): CornerDecision[] {
  const { arcs, corners } = raw;
  const closed = arcs.length === corners.length;
  // `before` ends at the corner and `after` starts there, in both the open and closed layouts.
  const legsOf = (k: number) => ({
    before: closed
      ? (arcs[(k - 1 + arcs.length) % arcs.length] as THREE.Vector3[])
      : (arcs[k] as THREE.Vector3[]),
    after: closed ? (arcs[k] as THREE.Vector3[]) : (arcs[k + 1] as THREE.Vector3[]),
  });

  const decisions: CornerDecision[] = corners.map((c, k) => {
    const { before, after } = legsOf(k);
    let strategy: CornerStrategy = pickStrategy(c.turn, weights, () => drawAt(k, STRATEGY_DRAW));
    // A hard corner drawn `connect` must fillet, and a fillet that will not fit breaks instead.
    // `CONNECT_LIMIT` used to guess this from the angle; now it is measured.
    let hairpin: Hairpin | null = null;
    if (strategy === 'hairpin') {
      const ranHairpin = on('hairpin');
      hairpin = hairpinFor(before, after, c, shape, rhoMin, spacing);
      if (hairpin) {
        report('hairpin', { at: c.index, points: hairpin.points, removed: [] }, ranHairpin);
      }
      if (!ranHairpin) {
        strategy = 'break';
        hairpin = null;
      }
    }
    if (strategy === 'hairpin') {
      // Nothing worth turning around for: a hairpin leaves the contour on both approaches to buy
      // the apex back, so it only pays where a fillet would cut more than a bend radius away.
      // One that cannot be built has to cut like any other corner.
      if (!hairpin || apexLoss(c, rhoMin) <= rhoMin) strategy = 'break';
    }
    const wantsFillet = strategy === 'connect' && c.hard;
    const filletSite = wantsFillet ? filletFor(before, after, c, rhoMin, spacing, rejoin) : null;
    const ranFillet = on('fillet');
    if (wantsFillet) {
      report(
        'fillet',
        filletSite ? { at: c.index, points: filletSite.points, removed: [] } : null,
        ranFillet,
      );
    }
    let fillet = ranFillet ? filletSite : null;
    if (wantsFillet && !fillet) strategy = 'break';
    // The material cannot take this bend without giving up the stroke it is bending, which is what
    // a break already means: cut here and keep both legs.
    if (fillet && wipesALeg(before, after, c, fillet, rhoMin, spacing)) {
      strategy = 'break';
      fillet = null;
    }
    // A cut end is an electrode, and a letter has two of those rather than thirty. Everywhere else
    // the bender bends the tube out of the plane and paints the return, so the glass carries
    // through and only the light stops — which is the same fillet a connect draws.
    if (strategy === 'break' && drawAt(k, BLOCKOUT_DRAW) < blockout) {
      const blockoutFillet = filletFor(before, after, c, rhoMin, spacing, rejoin);
      if (blockoutFillet) {
        report('fillet', { at: c.index, points: blockoutFillet.points, removed: [] }, ranFillet);
        // The return this fillet would carry, named whether or not the fillet is there to carry it:
        // with `fillet` off the strategy stays `break` and the span-level report below never runs.
        if (!ranFillet) {
          report('return', { at: c.index, points: blockoutFillet.points, removed: [] }, false);
        }
      }
      fillet = ranFillet ? blockoutFillet : null;
      if (fillet && wipesALeg(before, after, c, fillet, rhoMin, spacing)) fillet = null;
      if (fillet) strategy = 'return';
    }
    if (strategy === 'hairpin' && hairpin) {
      return { ...c, strategy, setback: Math.max(0, hairpin.reach), fillet: null, hairpin };
    }
    if (strategy === 'break') return { ...c, strategy, setback: 0, fillet: null };
    return { ...c, strategy, setback: fillet?.setback ?? 0, fillet };
  });

  // Both ends of a leg consume it, and the two cuts have to fit in it together. Measured from the
  // tangent points rather than from the setback: a setback runs from the virtual corner, which is
  // not on the path, so two fillets can overlap while their setbacks still appear to fit.
  const eatsAt = (k: number) => {
    const { before, after } = legsOf(k);
    const decision = decisions[k];
    if (decision?.hairpin) {
      const reach = Math.max(0, decision.hairpin.reach);
      return { before: reach, after: reach };
    }
    return eatenBy(corners[k] as Corner, decision?.fillet ?? null, before, after);
  };
  // To a fixed point: breaking a corner cuts its own stretch out of the same leg, so the survivor
  // has less room than the pass that spared it measured, not more.
  for (let pass = 0; pass < corners.length; pass++) {
    let settled = true;
    for (let k = 0; k < corners.length; k++) {
      const kNext = k + 1 < corners.length ? k + 1 : 0;
      const here = decisions[k] as CornerDecision;
      const next = decisions[kNext] as CornerDecision;
      if (next === here || (!closed && kNext === 0)) continue;
      // One sample of straight leg has to survive between the two: meeting end to end leaves a
      // join with no shared tangent, which bends tighter than either arc does.
      const room = polyLength(legsOf(k).after) - spacing;
      if (eatsAt(k).after + eatsAt(kNext).before <= room) continue;
      const loser = here.fillet && (!next.fillet || here.setback >= next.setback) ? here : next;
      if (!loser.fillet) continue;
      loser.strategy = 'break';
      loser.setback = 0;
      loser.fillet = null;
      settled = false;
    }
    if (settled) break;
  }

  return decisions;
}
