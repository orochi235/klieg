import type * as THREE from 'three';
import type { MaterialSpec } from '../decoration.js';
import type { SelectSpec } from './assign.js';
import type { GeneratedPath, PathSource } from './generators.js';
import type { GradientSpec } from './gradient.js';
import type { HairpinShape } from './hairpin.js';
import type { CornerRecord, CornerWeights, Rejoin, Run, ShortRun } from './runs.js';
import type { TubeStageId, TubeStageState } from './stages.js';
import { TUBE_STAGES } from './stages.js';
import type { SurfaceKind } from './surfaces.js';

export type { SelectSpec } from './assign.js';
export type { PathSource } from './generators.js';
export type { GradientDomain, GradientSpec } from './gradient.js';
export type { HairpinShape } from './hairpin.js';
export { DEFAULT_HAIRPIN, HAIRPIN_SHAPES } from './hairpin.js';
export type { CornerRecord, CornerStrategy, CornerWeights, Rejoin, Run, ShortRun } from './runs.js';
export { ALL_BREAK, ALL_CONNECT, DEFAULT_REJOIN, REJOINS } from './runs.js';
export type { TubeStageId, TubeStageState } from './stages.js';
export type { SurfaceKind } from './surfaces.js';

export interface TubeSpec {
  kind: 'tube';
  /** Tube radius in em. Held exactly: the corner stage bends the path to carry it. */
  radius: number;
  /**
   * Minimum bend radius as a multiple of `radius` — how tightly this material bends relative to its
   * own thickness. Floored at 1.25, below which the swept mesh self-intersects whatever a look asks.
   */
  bend?: number;
  /**
   * How often a corner that would cut instead carries through unlit, as a bender's blockout over a
   * return bend. Defaults to zero — a cut at every one — and a look opts in.
   */
  blockout?: number;
  /** Ring segments around the tube. */
  segments: number;
  /** Arc length in em between resampled path points. */
  spacing: number;
  surfaces: SurfaceKind[];
  /** Isocontour level in em: negative insets, zero rides the outline, positive stands off. */
  level: number;
  /** Where front/back paths come from. Defaults to tracing the glyph's own contour. */
  pathSource?: PathSource;
  /** Requested runs per glyph. Bounded below by the corner count, above by `minRun`. */
  runs: number;
  minRun: number;
  /** What a contour too short to carry `runs` does; `fit` by default. See `ShortRun`. */
  shortRun?: ShortRun;
  /** Weight distribution over what a corner does. Defaults to every corner breaking. */
  corners?: CornerWeights;
  /**
   * What the corner stage does when a fillet cannot meet its leg without bending under the
   * minimum radius. `drop` by default; see `Rejoin`.
   */
  rejoin?: Rejoin;
  /**
   * Which hairpin a corner drawing one turns around with. `uturn` by default; only consulted when
   * `corners.hairpin` is nonzero. See `HairpinShape`.
   */
  hairpin?: HairpinShape;
  /** Depth fraction the wall generator runs at, 0 back to 1 front. */
  wallDepth?: number;
  /** Peak-to-peak depth swing along a wall path, as a fraction of depth. */
  wallRise?: number;
  /**
   * How far a front/back run wanders off its flat plane, in em. Zero (the default) keeps today's
   * flat behavior exactly. One or two slow undulations along the run's length, pinned to zero at
   * both ends so adjacent runs still meet cleanly.
   */
  amplitude?: number;
  select: SelectSpec;
  colors: number[];
  /** Per-surface palettes, each falling back to `colors`. Omit for one palette across every layer. */
  surfaceColors?: Partial<Record<SurfaceKind, number[]>>;
  /** A colour sweep across the sign. Omit for a flat colour per run, which is the default. */
  gradient?: GradientSpec;
  look: MaterialSpec;
  /** Unlit glass. Present so a dark run is visibly there rather than missing. */
  dark: MaterialSpec;
  /** Connectors emitted per front path when both faces are enabled. 0 disables them. */
  connectors?: number;
  /** How far a connector continues past the back plane, in em. */
  connectorOvershoot?: number;
}

export interface TubeBlueprint {
  kind: 'tube';
  runs: Run[];
  /** One entry per corner the cut walked, in draw order. Diagnostic; nothing renders it. */
  corners: CornerRecord[];
  /** The paths `Run.from` indexes into, in the order the cut received them. @internal */
  paths: readonly GeneratedPath[];
  lit: THREE.BufferGeometry[];
  dark: THREE.BufferGeometry[];
  dispose(): void;
}

/** @internal */
export interface TubeBuildOptions {
  /**
   * Which stages run. Absent runs all five, which is what every shipped caller passes. A stage
   * left out runs its `bypass` instead, where it has one.
   */
  stages?: ReadonlySet<TubeStageId>;
  /** Called after each stage that ran, with the live state — nothing is cloned. */
  onStage?(id: TubeStageId, state: TubeStageState): void;
}

export function buildTubeBlueprint(
  shapes: THREE.Shape[],
  spec: TubeSpec,
  depth: number,
  seed: number,
  opts?: TubeBuildOptions,
): TubeBlueprint {
  const ctx = { shapes, spec, depth, seed };
  const state: TubeStageState = { paths: [], runs: [], corners: [], lit: [], dark: [] };

  for (const stage of TUBE_STAGES) {
    if (opts?.stages && !opts.stages.has(stage.id)) {
      stage.bypass?.(state, ctx);
      continue;
    }
    stage.run(state, ctx);
    opts?.onStage?.(stage.id, state);
  }

  return {
    kind: 'tube',
    runs: state.runs,
    corners: state.corners,
    paths: state.paths,
    lit: state.lit,
    dark: state.dark,
    dispose() {
      for (const g of state.lit) g.dispose();
      for (const g of state.dark) g.dispose();
      state.lit.length = 0;
      state.dark.length = 0;
      state.runs.length = 0;
      state.corners.length = 0;
    },
  };
}
