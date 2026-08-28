import * as THREE from 'three';
import { rng } from '../../rng.js';
import {
  biarcBlend,
  type Corner,
  cornersByBend,
  type Fillet,
  filletAt,
  minBendRadius,
  STYLE_FACTOR,
} from './bend.js';
import type { GeneratedPath } from './generators.js';
import {
  apexLoss,
  DEFAULT_HAIRPIN,
  type Hairpin,
  type HairpinShape,
  hairpinAt,
} from './hairpin.js';
import type { CutRepairId, RepairSite } from './repairs.js';
import { popStretch, trimStretch } from './repairs.js';
import { minCurvatureRadius3 } from './resample.js';
import type { SurfaceKind } from './surfaces.js';

/** Where a run vertex came from, before the cut rewrote the path. @internal */
export interface VertexSource {
  /** Index into the path array handed to `cutIntoRuns`. */
  path: number;
  /** Index of the vertex within that path's own `points`. */
  index: number;
}

export interface Run {
  points: THREE.Vector3[];
  /**
   * Index-parallel to `points`: the contour vertex each one came from, or null where the corner
   * stage built it. Not injective — `slice()` reuses the boundary object, so one contour vertex is
   * the last entry of one run and the first entry of the next. @internal
   */
  from: (VertexSource | null)[];
  /**
   * A stretch of tube that carries the run past a corner without lighting it — a bender's blockout
   * over a return bend. Never lit, whatever `select` picks.
   */
  dark?: boolean;
  surface: SurfaceKind;
  length: number;
  /** Position in the run list. Stable across builds, so a post-effect can address a run by it. */
  index: number;
  lit: boolean;
  color: number;
}

export type CornerStrategy = 'break' | 'connect' | 'return' | 'hairpin';

/**
 * What the corner stage does when a fillet's arc cannot join its leg without bending under the
 * material's minimum radius. See `docs/superpowers/specs/2026-08-26-corner-rejoin-design.md`.
 */
export type Rejoin = 'bridge' | 'widen' | 'relax' | 'drop';

export const REJOINS: readonly Rejoin[] = ['bridge', 'widen', 'relax', 'drop'];
/**
 * `drop` — today's behavior. `bridge` measures better only at tube radii finer than either shipped
 * look uses, and at the shipped ones it is a wash, so it is offered rather than imposed. See the
 * numbers in `docs/superpowers/specs/2026-08-26-corner-rejoin-design.md`.
 */
export const DEFAULT_REJOIN: Rejoin = 'drop';

/** What one corner's strategy draw decided, in the path's own coordinates. */
export interface CornerRecord {
  point: THREE.Vector3;
  strategy: CornerStrategy;
  /** Turn angle in radians, the same measure `pickStrategy` biases on. */
  turn: number;
}

export interface CutResult {
  runs: Run[];
  /** Corner points alias the input paths' own vectors; copy before anything mutates a run. */
  corners: CornerRecord[];
}

/** Relative weights over what a corner does; need not sum to 1. */
export interface CornerWeights {
  break: number;
  connect: number;
  /**
   * How often a corner too sharp for a fillet to follow turns the tube around outside the apex
   * instead of cutting it off. Absent or zero is today's behavior — no corner draws one.
   */
  hairpin?: number;
}

/** Every corner cuts — today's only behavior, and the default when a spec sets nothing. */
export const ALL_BREAK: CornerWeights = { break: 1, connect: 0 };
/** Every corner bends through instead of cutting — a continuous cord, what `piping` wants. */
export const ALL_CONNECT: CornerWeights = { break: 0, connect: 1 };

/** What a contour that cannot afford its requested run count does. */
export type ShortRun = 'fit' | 'drop';

export interface CutOptions {
  /** Requested run count per glyph. Cannot go below the corner count. */
  runs: number;
  /** Runs shorter than this are dropped and left dark, in em. */
  minRun: number;
  /**
   * What a contour too short to carry `runs` does. `fit` cuts it into as many runs as clear
   * `minRun`, and is the default. `drop` spends the whole budget and drops every piece under the
   * floor, which leaves a contour shorter than `runs * minRun` empty — small detail falls out of
   * the sign rather than being drawn coarsely.
   */
  shortRun?: ShortRun;
  /** Weight distribution over what each corner does. Defaults to every corner breaking. */
  corners?: CornerWeights;
  /** How a fillet rejoins a leg it cannot meet cleanly. `bridge` by default. */
  rejoin?: Rejoin;
  /** Which hairpin a `hairpin` corner draws. `uturn` by default. */
  hairpin?: HairpinShape;
  /** Requested tube radius in em. */
  radius?: number;
  /** Minimum bend radius as a multiple of `radius`. Floored at 1.25. */
  bend?: number;
  /** Arc length between resampled path points, in em. A fillet's arc is sampled at this. */
  spacing?: number;
  /** Seeds the per-corner strategy draw so a word builds identically twice. */
  seed?: number;
  /**
   * How often a corner that would cut instead carries through unlit — a bender's blockout over a
   * return bend. A cut end is right at a letter's terminus, where an electrode goes, and wrong
   * everywhere else.
   */
  blockout?: number;
  /**
   * Which repairs run. Absent is every repair on, which is what every shipped caller passes. Typed
   * as its own union rather than sharing one set with `TubeStageId`: a caller passing only repair
   * ids into a shared set would switch off all five stages and get an empty blueprint.
   */
  repairs?: ReadonlySet<CutRepairId>;
  /**
   * Fires for every repair considered, switched off ones included, so a lab can ghost them —
   * except the blockout branch's fillet candidate, which surfaces as the span-level `return`
   * report instead.
   */
  onRepair?(id: CutRepairId, site: RepairSite | null, ran: boolean): void;
}

/** A weight factor never fully zeroes an option biasing can't rule out entirely. */
const FLOOR = 0.05;
/** Turn past which glass is treated as unable to bend without kinking. */
const CONNECT_LIMIT = Math.PI * 0.75;
const FALLBACK_RADIUS = 0.03;
const FALLBACK_SPACING = 0.02;
/** Cuts stay cuts unless a look asks for returns: the primitive's default is the plain corner cut. */
const DEFAULT_BLOCKOUT = 0;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Which of a corner's two draws is being taken. */
type Draw = 0 | 1;
const STRATEGY_DRAW: Draw = 0;
const BLOCKOUT_DRAW: Draw = 1;

/**
 * Keyed on the corner's own index rather than on a running counter: a corner that skips a draw
 * would otherwise shift the stream for every corner after it, so switching a repair off would
 * change corners it has nothing to do with.
 */
function cornerSeed(seed: number, corner: number, draw: Draw): number {
  return (Math.round(seed * 2654435761) ^ 0x2f2f6a3d ^ (corner * 2 + draw)) >>> 0;
}

/** @internal */
export function polyLength(points: THREE.Vector3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += (points[i] as THREE.Vector3).distanceTo(points[i - 1] as THREE.Vector3);
  }
  return total;
}

interface CornerDecision extends Corner {
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

interface RawSpans {
  /**
   * Points between consecutive corners. Closed: `arcs[k]` starts at `corners[k]` and ends at
   * `corners[(k + 1) % n]`, so `arcs.length === corners.length`. Open: `arcs[k]` ends at
   * `corners[k]` and `arcs[k + 1]` starts there, so `arcs.length === corners.length + 1`.
   */
  arcs: THREE.Vector3[][];
  corners: Corner[];
}

function rawSpansOf(path: GeneratedPath, rhoMin: number, rhoStyle: number): RawSpans {
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
 * Drops the tail of `span` back past the fillet's tangent point. Measured from the corner rather
 * than accumulated step by step: leaving a point *inside* the setback makes the path run forward to
 * it and then jump back to the tangent point, and that reversal reads as a tighter bend than the
 * corner it replaced.
 */
function trimTail(span: THREE.Vector3[], back: number, corner: THREE.Vector3): void {
  while (span.length > 0 && (span[span.length - 1] as THREE.Vector3).distanceTo(corner) < back) {
    span.pop();
  }
}

/**
 * The first index in `span` at or past `from` that clears `back` of the corner, or `span.length`
 * when none does. Falling back to the last index instead would hand the arc a leg point it has
 * already passed, which is the reversal the trim exists to prevent.
 */
function indexPast(
  span: THREE.Vector3[],
  from: number,
  back: number,
  corner: THREE.Vector3,
): number {
  for (let i = Math.max(1, from); i < span.length; i++) {
    if ((span[i] as THREE.Vector3).distanceTo(corner) >= back) return i;
  }
  return span.length;
}

/** Segments averaged into a leg's direction. Four spans twice the setback at the shipped spacing. */
const LEG_WINDOW = 4;

/**
 * A leg's direction, averaged over several segments rather than taken from the one segment next to
 * the corner. A corner keeps turning past the stretch that detection collapses it to — measured on
 * both the field-traced and the directly-traced contour, that shoulder reaches 20 degrees — and a
 * direction taken there tilts the virtual corner off the leg the fillet has to be tangent to.
 */
function legDirection(span: THREE.Vector3[], at: number, step: 1 | -1): THREE.Vector3 | null {
  const dir = new THREE.Vector3();
  for (let k = 0; k < LEG_WINDOW; k++) {
    const i = step === 1 ? at + k : at - k - 1;
    const a = span[i] as THREE.Vector3 | undefined;
    const b = span[i + 1] as THREE.Vector3 | undefined;
    if (!a || !b) break;
    const d = b.clone().sub(a);
    if (d.lengthSq() < 1e-18) break;
    dir.add(d.normalize());
  }
  return dir.lengthSq() < 1e-18 ? null : dir.normalize();
}

/**
 * Where two leg lines meet, as the midpoint of their mutual perpendicular — the corner the path
 * would have had before resampling rounded it. Null when the legs are parallel and there is none.
 */
function legIntersection(
  a: THREE.Vector3,
  u: THREE.Vector3,
  b: THREE.Vector3,
  v: THREE.Vector3,
): THREE.Vector3 | null {
  const uv = u.dot(v);
  const denom = 1 - uv * uv;
  if (Math.abs(denom) < 1e-9) return null;
  const w = a.clone().sub(b);
  const s = (uv * w.dot(v) - w.dot(u)) / denom;
  const t = w.dot(v) - uv * w.dot(u);
  const p = a.clone().addScaledVector(u, s);
  const q = b.clone().addScaledVector(v, t / denom);
  return p.add(q).multiplyScalar(0.5);
}

/**
 * The fillet for the join between `target` and `next`, or null when there is no room for one.
 * Probes with a synthetic three-point path whose legs are the arc length actually available either
 * side: the room test is against the leg, not against one 0.02 sample step, which every setback
 * would exceed.
 */
function filletFor(
  target: THREE.Vector3[],
  next: THREE.Vector3[],
  corner: Corner,
  rhoMin: number,
  spacing: number,
  rejoin: Rejoin = 'drop',
): Fillet | null {
  // The legs are measured outside the corner's whole stretch, not either side of its tightest
  // vertex: the neighbouring vertices are part of the same rounded corner, and a direction taken
  // across one of them is already turning.
  const iA = target.length - 2 - corner.groupBefore;
  const iB = corner.groupAfter + 1;
  const a = target[iA] as THREE.Vector3 | undefined;
  const b = next[iB] as THREE.Vector3 | undefined;
  if (iA < 1 || !a || !b) return null;

  // Each leg line passes through its anchor vertex, so the fillet's tangent point stays collinear
  // with the path there and the join cannot kink.
  const u = legDirection(target, iA, -1);
  const v = legDirection(next, iB, 1);
  if (!u || !v) return null;

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
    const entry = fillet.points[0] as THREE.Vector3;
    const exit = fillet.points[fillet.points.length - 1] as THREE.Vector3;
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
function hairpinFor(
  target: THREE.Vector3[],
  next: THREE.Vector3[],
  corner: Corner,
  shape: HairpinShape,
  rhoMin: number,
  spacing: number,
): Hairpin | null {
  const iA = target.length - 2 - corner.groupBefore;
  const iB = corner.groupAfter + 1;
  if (iA < 1 || target.length < 2 || !next[iB]) return null;
  const u = legDirection(target, iA, -1);
  const v = legDirection(next, iB, 1);
  if (!u || !v) return null;

  const pin = hairpinAt(target, next, u, v, shape, rhoMin, spacing);
  // A hairpin that reaches back further than the leg it reaches along has nothing to attach to.
  if (!pin) return null;
  if (pin.reach > polyLength(target) || pin.reach > polyLength(next)) return null;
  return pin;
}

/** Radii a `widen` rejoin tries, as multiples of the minimum. */
const WIDEN_LADDER = [1, 1.3, 1.7, 2.2, 3];

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
  const n = fillet.points.length;
  const entry = fillet.points[0] as THREE.Vector3;
  const exit = fillet.points[n - 1] as THREE.Vector3;
  const second = fillet.points[1] as THREE.Vector3;
  const penult = fillet.points[n - 2] as THREE.Vector3;

  const before = target.slice(0, Math.max(0, target.length - 1 - corner.groupBefore));
  trimTail(before, fillet.setback, fillet.corner);
  const keep = resumeAt(
    before,
    before.length - 1,
    -1,
    entry,
    second,
    entry.clone().sub(second).normalize(),
    rhoMin,
    spacing,
  );
  if (keep !== before.length - 1) return false;

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
  return from === start;
}

/**
 * A break cuts the whole corner stretch out, not just the vertex detection collapsed it to. The
 * neighbouring vertices are the same corner; left on a run's end they are tube still bending
 * tighter than rhoMin, with no corner stage left to fix them.
 */
function dropHead(span: THREE.Vector3[], count: number): THREE.Vector3[] {
  return trimStretch(span, count, 'head');
}

function dropTail(span: THREE.Vector3[], count: number): THREE.Vector3[] {
  return trimStretch(span, count, 'tail');
}

/**
 * Splits a span that has just been merged through a return into the lit stretch before it, the dark
 * stretch carrying the corner, and the lit stretch after. The dark stretch is the fillet and one
 * sample either side — the same corner a break used to remove outright, so the lit strokes land
 * where they always did and only the glass between them is new.
 */
function splitReturn(span: THREE.Vector3[], fillet: Fillet, margin: number): [Span, Span, Span] {
  const entry = span.indexOf(fillet.points[0] as THREE.Vector3);
  const exit = span.indexOf(fillet.points[fillet.points.length - 1] as THREE.Vector3);
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

/** How far `point` sits from a tangent point along the leg leaving it. Negative when it is inside. */
function legGap(
  point: THREE.Vector3 | undefined,
  tangent: THREE.Vector3,
  along: THREE.Vector3,
): number {
  return point ? point.clone().sub(tangent).dot(along) : Number.POSITIVE_INFINITY;
}

/**
 * How much leg a corner consumes either side of the vertex it was collapsed to — to the fillet's
 * tangent points when it fillets, and to the end of its stretch when it breaks. A break shortens
 * the leg for the corner at the other end of it just as a fillet does.
 */
function eatenBy(
  corner: Corner,
  fillet: Fillet | null,
  before: THREE.Vector3[],
  after: THREE.Vector3[],
): { before: number; after: number } {
  const vertex = before[before.length - 1] as THREE.Vector3 | undefined;
  if (!vertex) return { before: 0, after: 0 };
  if (fillet) {
    const entry = fillet.points[0] as THREE.Vector3;
    const exit = fillet.points[fillet.points.length - 1] as THREE.Vector3;
    return { before: vertex.distanceTo(entry), after: vertex.distanceTo(exit) };
  }
  return {
    before: polyLength(before.slice(Math.max(0, before.length - corner.groupBefore - 2))),
    after: polyLength(after.slice(0, corner.groupAfter + 2)),
  };
}

/** The bend the path takes at `mid`, in em. */
function bendThrough(a: THREE.Vector3, mid: THREE.Vector3, b: THREE.Vector3): number {
  return minCurvatureRadius3([a, mid, b].map((p) => ({ x: p.x, y: p.y, z: p.z })));
}

/**
 * Where the leg resumes after a fillet: the last vertex whose own bend, taken across the junction
 * into the arc, still clears `rhoMin`.
 *
 * The fit reads the shoulder as straight where it is still turning, so the vertex nearest the
 * tangent point sits off the leg line the arc is tangent to — by up to half a sample step. That
 * offset is worst exactly there: the arc is sampled at half `spacing`, so a junction chord meets a
 * step half as long as its own, and the circumradius of the two is the junction chord over twice
 * the sine of the turn. Stepping back lengthens that chord faster than the offset grows.
 */
function resumeAt(
  leg: THREE.Vector3[],
  from: number,
  step: 1 | -1,
  tangent: THREE.Vector3,
  second: THREE.Vector3,
  along: THREE.Vector3,
  rhoMin: number,
  spacing: number,
): number {
  for (let i = from; i >= 0 && i < leg.length; i += step) {
    const p = leg[i] as THREE.Vector3;
    const before = leg[i - step] as THREE.Vector3 | undefined;
    if (legGap(p, tangent, along) < spacing) continue;
    if (bendThrough(p, tangent, second) < rhoMin) continue;
    // Both vertices of the junction, not only the one on the arc: stepping back moves the residual
    // onto the leg, and a resume that clears at the tangent point can fail at itself.
    if (before && bendThrough(before, p, tangent) < rhoMin) continue;
    return i;
  }
  return step === 1 ? leg.length : -1;
}

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
type Inherit = (copy: THREE.Vector3, source: THREE.Vector3) => void;

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
function mergeArc(
  target: THREE.Vector3[],
  next: THREE.Vector3[],
  decision: CornerDecision,
  fillet: Fillet | null,
  rhoMin: number,
  spacing: number,
  rejoin: Rejoin,
  inherit: Inherit,
  on: (id: CutRepairId) => boolean,
  report: (id: CutRepairId, site: RepairSite | null, ran: boolean) => void,
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
  const entry = fillet.points[0] as THREE.Vector3;
  const exit = fillet.points[n - 1] as THREE.Vector3;
  const second = fillet.points[1] as THREE.Vector3;
  const penult = fillet.points[n - 2] as THREE.Vector3;
  const into = entry.clone().sub(second).normalize();
  const outOf = exit.clone().sub(penult).normalize();

  // Drop the corner's whole stretch before trimming by distance: a shallow turn's setback can be
  // shorter than one sample step, and would leave the stretch's own vertices in the path.
  const stretchSite: RepairSite = { at: target.length - 1, points: [], removed: [] };
  const ranStretch = on('stretch');
  if (ranStretch) popStretch(target, decision.groupBefore + 1);
  report('stretch', stretchSite, ranStretch);
  // Indexes the accumulator before the trim; a consumer must not map it onto the post-trim span.
  const setbackSite: RepairSite = { at: target.length - 1, points: [], removed: [] };
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
  if (bridgedIn) report('resume', { at: target.length - 1, points: bridgedIn, removed: [] }, ranResume);
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
      report('resume', { at: target.length - 1, points: relaxed, removed: [] }, ranResume);
    } else {
      const keep = resumeAt(target, target.length - 1, -1, entry, second, into, rhoMin, spacing);
      report('resume', { at: keep, points: [], removed: [] }, ranResume);
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
  report('setback', { at: pastSetback, points: [], removed: [] }, ranExitSetback);
  const start = ranExitSetback ? pastSetback : decision.groupAfter + 1;
  if (rejoin === 'bridge') {
    const blend = bridgeAfter(next, start, exit, outOf, rhoMin, spacing);
    if (blend) {
      for (let i = 1; i < blend.points.length; i++) target.push(blend.points[i] as THREE.Vector3);
      for (let i = blend.at + 1; i < next.length; i++) target.push(next[i] as THREE.Vector3);
      return;
    }
  }
  if (rejoin === 'relax' && start < next.length) {
    const relaxed = relaxOnto([penult, exit], next, start, 1, rhoMin, inherit);
    if (relaxed) {
      for (const p of relaxed) target.push(p);
      for (let i = start + relaxed.length; i < next.length; i++) {
        target.push(next[i] as THREE.Vector3);
      }
      return;
    }
  }
  const from = resumeAt(next, start, 1, exit, penult, outOf, rhoMin, spacing);
  for (let i = from; i < next.length; i++) target.push(next[i] as THREE.Vector3);
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

/** Draws a strategy for each corner and stitches the raw arcs into final spans accordingly. */
interface Span {
  points: THREE.Vector3[];
  /** Set on the stretch a return carries dark across a corner. */
  dark?: boolean;
}

function stitchPath(
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
  report: (id: CutRepairId, site: RepairSite | null, ran: boolean) => void,
): { spans: Span[]; decisions: CornerDecision[] } {
  const { arcs, corners } = raw;
  if (corners.length === 0) return { spans: arcs.map((points) => ({ points })), decisions: [] };

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
    if (strategy === 'hairpin' && !on('hairpin')) strategy = 'break';
    if (strategy === 'hairpin') {
      hairpin = hairpinFor(before, after, c, shape, rhoMin, spacing);
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
    // A cut end is an electrode, and a letter has two of those rather than thirty. Everywhere else
    // the bender bends the tube out of the plane and paints the return, so the glass carries
    // through and only the light stops — which is the same fillet a connect draws.
    if (strategy === 'break' && drawAt(k, BLOCKOUT_DRAW) < blockout) {
      const blockoutFillet = filletFor(before, after, c, rhoMin, spacing, rejoin);
      fillet = ranFillet ? blockoutFillet : null;
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

  if (!closed) {
    const spans: Span[] = [];
    let current = (arcs[0] as THREE.Vector3[]).slice();
    for (let k = 0; k < decisions.length; k++) {
      const decision = decisions[k] as CornerDecision;
      const next = arcs[k + 1] as THREE.Vector3[];
      if (decision.strategy === 'break') {
        spans.push({ points: dropTail(current, decision.groupBefore + 1) });
        current = dropHead(next.slice(), decision.groupAfter + 1);
      } else {
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
        if (decision.strategy === 'return' && decision.fillet) {
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
          if (ranReturn) {
            const [head, dark, tail] = splitReturn(current, decision.fillet, spacing);
            spans.push(head, dark);
            current = tail.points;
          }
        }
      }
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
    const walk = (decision: CornerDecision, arc: THREE.Vector3[]) => {
      mergeArc(
        current,
        arc,
        decision,
        decision.fillet ?? null,
        rhoMin,
        spacing,
        rejoin,
        inherit,
        on,
        report,
      );
      if (decision.strategy === 'return' && decision.fillet) {
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
        if (ranReturn) {
          const [head, dark, tail] = splitReturn(current, decision.fillet, spacing);
          closedSpans.push(head, dark);
          current = tail.points;
        }
      }
    };
    for (let k = 1; k < n; k++) walk(decisions[k] as CornerDecision, arcs[k] as THREE.Vector3[]);
    walk(decisions[0] as CornerDecision, first.slice(0, mid + 1));
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
  let current = dropHead((arcs[breakIdx] as THREE.Vector3[]).slice(), opening.groupAfter + 1);
  for (let i = 1; i < n; i++) {
    const arcIdx = (breakIdx + i) % n;
    const decision = decisions[arcIdx] as CornerDecision;
    if (decision.strategy === 'break') {
      spans.push({ points: dropTail(current, decision.groupBefore + 1) });
      current = dropHead((arcs[arcIdx] as THREE.Vector3[]).slice(), decision.groupAfter + 1);
    } else {
      mergeArc(
        current,
        arcs[arcIdx] as THREE.Vector3[],
        decision,
        decision.fillet ?? null,
        rhoMin,
        spacing,
        rejoin,
        inherit,
        on,
        report,
      );
      if (decision.strategy === 'return' && decision.fillet) {
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
        if (ranReturn) {
          const [head, dark, tail] = splitReturn(current, decision.fillet, spacing);
          spans.push(head, dark);
          current = tail.points;
        }
      }
    }
  }
  spans.push({ points: dropTail(current, opening.groupBefore + 1) });
  return { spans, decisions };
}

/**
 * Cuts `span` into `pieces` runs by arc length. A span needs at least 2 vertices per piece, so
 * a request beyond `span.length - 1` is capped rather than honored.
 */
function slice(span: THREE.Vector3[], pieces: number): THREE.Vector3[][] {
  const n = Math.min(Math.max(1, pieces), Math.max(1, span.length - 1));
  if (n <= 1) return [span];

  const total = polyLength(span);
  const out: THREE.Vector3[][] = [];
  let cur: THREE.Vector3[] = [span[0] as THREE.Vector3];
  let acc = 0;
  let next = 1;
  for (let i = 1; i < span.length; i++) {
    acc += (span[i] as THREE.Vector3).distanceTo(span[i - 1] as THREE.Vector3);
    cur.push(span[i] as THREE.Vector3);
    // Absolute target (next * total / n), not accumulate-and-reset: resetting acc to 0 after
    // each cut discards the previous piece's overshoot, and that loss compounds over many pieces.
    if (next < n && i < span.length - 1 && acc >= (next * total) / n) {
      out.push(cur);
      cur = [span[i] as THREE.Vector3];
      next++;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Corners are detected the same way regardless of strategy; `runs` inserts the rest of the cuts,
 * distributed across spans by length with largest remainder. The count is a request, not a
 * guarantee — it cannot go below the count of spans a corner's `break` draws produce, and the
 * floor can take the result lower still.
 */
export function cutIntoRuns(paths: GeneratedPath[], opts: CutOptions): CutResult {
  const weights = opts.corners ?? ALL_BREAK;
  const radius = opts.radius ?? FALLBACK_RADIUS;
  const rhoMin = minBendRadius(radius, opts.bend);
  const rhoStyle = radius * STYLE_FACTOR;
  const spacing = opts.spacing ?? FALLBACK_SPACING;
  const rejoin = opts.rejoin ?? DEFAULT_REJOIN;
  const shape = opts.hairpin ?? DEFAULT_HAIRPIN;
  const seed = opts.seed ?? 0;
  const enabled = opts.repairs;
  const on = (id: CutRepairId) => !enabled || enabled.has(id);
  const report = (id: CutRepairId, site: RepairSite | null, ran: boolean) =>
    opts.onRepair?.(id, site, ran);
  // Corner indices run across the whole glyph, so the order paths are concatenated in is what
  // keeps a word building identically twice.
  let cornerBase = 0;
  const drawAt = (corner: number, draw: Draw) => rng(cornerSeed(seed, cornerBase + corner, draw))();

  // Resolvable in one pass because the only stitch primitive that copies, `relaxOnto`, registers
  // each copy here: everything else slices the input's own objects or pushes geometry the corner
  // stage built, so identity survives the whole cut.
  const origin = new Map<THREE.Vector3, VertexSource>();
  paths.forEach((path, p) => {
    path.points.forEach((point, index) => {
      if (!origin.has(point)) origin.set(point, { path: p, index });
    });
  });

  const inherit: Inherit = (copy, source) => {
    const from = origin.get(source);
    if (from) origin.set(copy, from);
  };

  const cornerRecords: CornerRecord[] = [];
  const spans: { points: THREE.Vector3[]; surface: SurfaceKind; dark?: boolean }[] = [];
  for (const path of paths) {
    const raw = rawSpansOf(path, rhoMin, rhoStyle);
    const { spans: stitched, decisions } = stitchPath(
      raw,
      weights,
      rhoMin,
      spacing,
      opts.blockout ?? DEFAULT_BLOCKOUT,
      rejoin,
      shape,
      drawAt,
      inherit,
      on,
      report,
    );
    cornerBase += decisions.length;
    for (const d of decisions) {
      cornerRecords.push({
        point: d.at ?? (path.points[d.index] as THREE.Vector3),
        strategy: d.strategy,
        turn: d.turn,
      });
    }
    for (const span of stitched) {
      if (span.points.length > 1) {
        spans.push({ points: span.points, surface: path.surface, dark: span.dark });
      }
    }
  }
  if (spans.length === 0) return { runs: [], corners: cornerRecords };

  const lengths = spans.map((s) => polyLength(s.points));
  const total = lengths.reduce((a, b) => a + b, 0);
  const extra = Math.max(0, opts.runs - spans.length);
  // A dark span is one piece of blockout, never several: slicing it would light its middle.
  const want = lengths.map((l, i) => (total > 0 && !spans[i]?.dark ? (extra * l) / total : 0));
  // Extra cuts a span cannot afford: every piece has to clear `minRun` or it is dropped below,
  // and a span sliced past its own budget loses all of them rather than some.
  const fitting = (opts.shortRun ?? 'fit') === 'fit';
  const room = lengths.map((l, i) =>
    !fitting || spans[i]?.dark || !(opts.minRun > 0)
      ? Number.POSITIVE_INFINITY
      : Math.floor(l / opts.minRun) - 1,
  );
  const base = want.map((w, i) => Math.max(0, Math.min(Math.floor(w), room[i] as number)));
  let left = extra - base.reduce((a, b) => a + b, 0);
  for (const [, i] of want
    .map((w, i) => [w - (base[i] as number), i] as const)
    .sort((a, b) => b[0] - a[0])) {
    if (left <= 0) break;
    if ((base[i] as number) >= (room[i] as number)) continue;
    base[i] = (base[i] as number) + 1;
    left--;
  }

  const out: Run[] = [];
  spans.forEach((span, i) => {
    for (const piece of slice(span.points, 1 + (base[i] as number))) {
      const length = polyLength(piece);
      // A dark span is never dropped: dropping it would leave the gap the return exists to avoid.
      if (length < opts.minRun && !span.dark) continue;
      out.push({
        points: piece,
        from: piece.map((p) => origin.get(p) ?? null),
        surface: span.surface,
        length,
        index: out.length,
        lit: true,
        dark: span.dark,
        color: 0,
      });
    }
  });
  return { runs: out, corners: cornerRecords };
}
