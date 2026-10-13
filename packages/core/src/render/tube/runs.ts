import type * as THREE from 'three';
import { rng } from '../../rng.js';
import { BEND_FLOOR, DEFAULT_BEND, minBendRadius, STYLE_FACTOR, vertexBends } from './bend.js';
import { type ContourPolicies, type ContourRole, DEFAULT_FLOOR } from './contours.js';
import { cornerSeed, type Draw } from './decide.js';
import { easeShallowCorners } from './ease.js';
import type { GeneratedPath } from './generators.js';
import { DEFAULT_HAIRPIN, type HairpinShape } from './hairpin.js';
import { polyLength } from './legs.js';
import type { Inherit } from './rejoin.js';
import type { CutRepairId, RepairReport, RepairSite } from './repairs.js';
import { rawSpansOf, type Span, stitchPath } from './stitch.js';
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
  /** Which contour this run traces. Set only where the spec has a policy for that role. */
  role?: ContourRole;
  /** The radius this run sweeps at, when a rescue thinned the glass. Absent is the spec's own. */
  radius?: number;
  /** The path this run was cut from, beside `role`. @internal */
  path?: number;
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
  /** Per-role treatment of contours whose path knows its role. Absent treats every path alike. */
  contours?: ContourPolicies;
}

const FALLBACK_RADIUS = 0.03;
const FALLBACK_SPACING = 0.02;
/** Cuts stay cuts unless a look asks for returns: the primitive's default is the plain corner cut. */
const DEFAULT_BLOCKOUT = 0;

type Stitched = ReturnType<typeof stitchPath>;

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

/** How many cuts each span takes past its first piece, sharing out what `runs` asks for beyond one per span. */
function extraCuts(
  spans: readonly { points: THREE.Vector3[]; dark?: boolean }[],
  opts: Pick<CutOptions, 'runs' | 'minRun' | 'shortRun'>,
): number[] {
  const lengths = spans.map((s) => polyLength(s.points));
  const total = lengths.reduce((a, b) => a + b, 0);
  const extra = Math.max(0, opts.runs - spans.length);
  // A dark span is one piece of blockout, never several: slicing it would light its middle.
  const want = lengths.map((l, i) => (total > 0 && !spans[i]?.dark ? (extra * l) / total : 0));
  // Extra cuts a span cannot afford: every piece has to clear `minRun` or it is dropped,
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

  return base;
}

/** Repairs held back until an attempt is known to be the one kept. */
function listen(): { report: RepairReport; replay(to: RepairReport): void } {
  const heard: Parameters<RepairReport>[] = [];
  return {
    report: (id, site, ran) => {
      heard.push([id, site, ran]);
    },
    replay: (to) => {
      for (const [id, site, ran] of heard) to(id, site, ran);
    },
  };
}

/** Whether any span could light and clear the `minRun` floor: whether the contour reaches the screen. */
function lightable(spans: readonly Span[], minRun: number): boolean {
  return spans.some((s) => !s.dark && s.points.length > 1 && polyLength(s.points) >= minRun);
}

/** Glass thin enough that the path's tightest bend clears the material's limit, never thicker than `radius`. */
function fitRadius(path: GeneratedPath, radius: number, bend: number | undefined): number {
  let tightest = Number.POSITIVE_INFINITY;
  for (const b of vertexBends(path.points, path.closed)) tightest = Math.min(tightest, b.rho);
  return Math.min(radius, tightest / Math.max(BEND_FLOOR, bend ?? DEFAULT_BEND));
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
  const report: RepairReport = (id, site, ran) => opts.onRepair?.(id, site, ran);
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
  const spans: {
    points: THREE.Vector3[];
    surface: SurfaceKind;
    dark?: boolean;
    role?: ContourRole;
    radius?: number;
    path?: number;
  }[] = [];
  const blockout = opts.blockout ?? DEFAULT_BLOCKOUT;
  for (const [p, path] of paths.entries()) {
    easeShallowCorners(path.points, path.closed, rhoMin, radius / 2);
    const stitchAt = (r: number, b: number, heard: RepairReport): Stitched => {
      const min = r === radius ? rhoMin : minBendRadius(r, opts.bend);
      const style = r === radius ? rhoStyle : r * STYLE_FACTOR;
      return stitchPath(
        rawSpansOf(path, min, style),
        weights,
        min,
        spacing,
        b,
        rejoin,
        shape,
        drawAt,
        inherit,
        on,
        heard,
      );
    };

    const policy = path.role === undefined ? undefined : opts.contours?.[path.role];
    let thinned: number | undefined;
    let stitched: Stitched;
    if (!policy?.rescue?.length) {
      stitched = stitchAt(radius, blockout, report);
    } else {
      // A discarded attempt's repairs never happened, so only the kept attempt's reach the caller.
      let kept = listen();
      stitched = stitchAt(radius, blockout, kept.report);
      if (!lightable(stitched.spans, opts.minRun)) {
        const floor = radius * (policy.floor ?? DEFAULT_FLOOR);
        for (const rung of policy.rescue) {
          const r =
            rung.radius === 'fit'
              ? fitRadius(path, radius, opts.bend)
              : radius * (rung.radius ?? 1);
          if (!(r >= floor)) continue;
          const tried = listen();
          const attempt = stitchAt(r, rung.blockout ?? blockout, tried.report);
          if (!lightable(attempt.spans, opts.minRun)) continue;
          stitched = attempt;
          kept = tried;
          if (r !== radius) thinned = r;
          break;
        }
      }
      kept.replay(report);
    }

    cornerBase += stitched.decisions.length;
    for (const d of stitched.decisions) {
      cornerRecords.push({
        point: d.at ?? (path.points[d.index] as THREE.Vector3),
        strategy: d.strategy,
        turn: d.turn,
      });
    }
    for (const span of stitched.spans) {
      if (span.points.length > 1) {
        spans.push({
          points: span.points,
          surface: path.surface,
          dark: span.dark,
          ...(policy ? { role: path.role, path: p } : {}),
          ...(thinned === undefined ? {} : { radius: thinned }),
        });
      }
    }
  }
  if (spans.length === 0) return { runs: [], corners: cornerRecords };

  const base = extraCuts(spans, opts);

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
        ...(span.role ? { role: span.role, path: span.path } : {}),
        ...(span.radius === undefined ? {} : { radius: span.radius }),
      });
    }
  });
  return { runs: out, corners: cornerRecords };
}
