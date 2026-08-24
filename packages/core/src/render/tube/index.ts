import type * as THREE from 'three';
import type { MaterialSpec } from '../decoration.js';
import { assign, type SelectSpec } from './assign.js';
import { generateConnectors, generatePaths, type PathSource } from './generators.js';
import type { GradientSpec } from './gradient.js';
import { type CornerRecord, type CornerWeights, cutIntoRuns, type Run } from './runs.js';
import type { SurfaceKind } from './surfaces.js';
import { surfacesOf } from './surfaces.js';
import { sweepRun } from './sweep.js';
import { wanderPaths } from './wander.js';

export type { SelectSpec } from './assign.js';
export type { PathSource } from './generators.js';
export type { GradientDomain, GradientSpec } from './gradient.js';
export type { CornerRecord, CornerStrategy, CornerWeights, Run } from './runs.js';
export { ALL_BREAK, ALL_CONNECT } from './runs.js';
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
  /** Weight distribution over what a corner does. Defaults to every corner breaking. */
  corners?: CornerWeights;
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
  lit: THREE.BufferGeometry[];
  dark: THREE.BufferGeometry[];
  dispose(): void;
}

/** Grid cells per side for the face field, and the margin exterior levels need. */
const RESOLUTION = 256;
const PAD = 0.35;

export function buildTubeBlueprint(
  shapes: THREE.Shape[],
  spec: TubeSpec,
  depth: number,
  seed: number,
): TubeBlueprint {
  const surfaces = surfacesOf(shapes, depth);
  const paths = generatePaths(surfaces, spec.surfaces, {
    level: spec.level,
    spacing: spec.spacing,
    wallDepth: spec.wallDepth ?? 0.5,
    wallRise: spec.wallRise,
    resolution: RESOLUTION,
    pad: PAD,
    source: spec.pathSource,
  });
  const links =
    spec.connectors && spec.connectors > 0
      ? generateConnectors(paths, {
          count: spec.connectors,
          overshoot: spec.connectorOvershoot ?? 0.05,
        })
      : [];
  // Before the cut: a bend wander introduces is a bend the corner stage has to see.
  wanderPaths(paths, spec.amplitude ?? 0, seed);
  const cut = cutIntoRuns([...paths, ...links], {
    runs: spec.runs,
    minRun: spec.minRun,
    corners: spec.corners,
    spacing: spec.spacing,
    bend: spec.bend,
    radius: spec.radius,
    blockout: spec.blockout,
    seed,
  });
  const runs = assign(
    cut.runs,
    spec.select,
    spec.colors,
    seed,
    spec.surfaceColors,
    spec.surfaces,
    spec.gradient,
  );
  // Cloned after wander, not before: wander moves run points in place, and every corner interior
  // to a run — every `connect` and `loop` — moves with them.
  const corners = cut.corners.map((c) => ({ ...c, point: c.point.clone() }));

  // The letter domain needs each run's slice of the glyph's lit length, and this is the only
  // place that has the glyph's whole run list.
  const litRuns = runs.filter((r) => r.lit);
  const litTotal = litRuns.reduce((a, r) => a + r.length, 0);
  const spans = new Map<number, { start: number; span: number }>();
  let walked = 0;
  for (const run of litRuns) {
    spans.set(run.index, {
      start: litTotal > 0 ? walked / litTotal : 0,
      span: litTotal > 0 ? run.length / litTotal : 0,
    });
    walked += run.length;
  }

  const lit: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  for (const run of runs) {
    const place = spec.gradient && run.lit ? spans.get(run.index) : undefined;
    const geo = sweepRun(
      run,
      spec.radius,
      spec.segments,
      spec.gradient && place ? { domain: spec.gradient.domain, place } : undefined,
    );
    if (!geo) continue;
    (run.lit ? lit : dark).push(geo);
  }

  return {
    kind: 'tube',
    runs,
    corners,
    lit,
    dark,
    dispose() {
      for (const g of lit) g.dispose();
      for (const g of dark) g.dispose();
      lit.length = 0;
      dark.length = 0;
      runs.length = 0;
      corners.length = 0;
    },
  };
}
