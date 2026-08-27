import type * as THREE from 'three';
import { assign } from './assign.js';
import { type GeneratedPath, generateConnectors, generatePaths } from './generators.js';
import type { TubeSpec } from './index.js';
import { type CornerRecord, cutIntoRuns, polyLength, type Run } from './runs.js';
import { surfacesOf } from './surfaces.js';
import { sweepRun } from './sweep.js';
import { wanderPaths } from './wander.js';

/** Grid cells per side for the face field, and the margin exterior levels need. */
const RESOLUTION = 256;
const PAD = 0.35;

/** @internal */
export type TubeStageId = 'generate' | 'wander' | 'cut' | 'assign' | 'sweep';

/** @internal */
export interface TubeStageContext {
  readonly shapes: readonly THREE.Shape[];
  readonly spec: TubeSpec;
  readonly depth: number;
  readonly seed: number;
}

/**
 * What the pipeline carries from one stage to the next. `buildTubeBlueprint` returns these arrays
 * and disposes through them, so a stage pushes and splices — it never reassigns.
 * @internal
 */
export interface TubeStageState {
  readonly paths: GeneratedPath[];
  readonly runs: Run[];
  readonly corners: CornerRecord[];
  readonly lit: THREE.BufferGeometry[];
  readonly dark: THREE.BufferGeometry[];
}

/** @internal */
export interface TubeStage {
  id: TubeStageId;
  label: string;
  run(state: TubeStageState, ctx: TubeStageContext): void;
  /**
   * Runs in `run`'s place when the stage is switched off, to pass the pipeline through. Without
   * one the stage is simply skipped and the pipeline carries on with whatever state it has.
   */
  bypass?(state: TubeStageState, ctx: TubeStageContext): void;
}

/** @internal */
export const TUBE_STAGES: readonly TubeStage[] = [
  {
    id: 'generate',
    label: 'paths',
    run(state, { shapes, spec, depth }) {
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
      // Connectors last: `wanderPaths` seeds from the array index, so putting them first would
      // shift every face path's seed and silently re-render every wandered look.
      state.paths.push(...paths, ...links);
    },
  },
  {
    id: 'wander',
    label: 'wander',
    run(state, { spec, seed }) {
      wanderPaths(state.paths, spec.amplitude ?? 0, seed);
    },
  },
  {
    id: 'cut',
    label: 'runs',
    run(state, { spec, seed }) {
      const cut = cutIntoRuns(state.paths, {
        runs: spec.runs,
        minRun: spec.minRun,
        corners: spec.corners,
        spacing: spec.spacing,
        bend: spec.bend,
        radius: spec.radius,
        blockout: spec.blockout,
        shortRun: spec.shortRun,
        rejoin: spec.rejoin,
        hairpin: spec.hairpin,
        seed,
      });
      state.runs.push(...cut.runs);
      // Cloned after wander, not before: wander moves path points in place, and every corner
      // interior to a run — every `connect` and `loop` — moves with them.
      state.corners.push(...cut.corners.map((c) => ({ ...c, point: c.point.clone() })));
    },
    bypass(state) {
      state.paths.forEach((path, index) => {
        if (path.points.length < 2) return;
        state.runs.push({
          points: path.points,
          from: path.points.map((_, i) => ({ path: index, index: i })),
          surface: path.surface,
          length: polyLength(path.points),
          index: state.runs.length,
          lit: true,
          color: 0,
        });
      });
    },
  },
  {
    id: 'assign',
    label: 'light and colour',
    run(state, { spec, seed }) {
      assign(
        state.runs,
        spec.select,
        spec.colors,
        seed,
        spec.surfaceColors,
        spec.surfaces,
        spec.gradient,
      );
    },
  },
  {
    id: 'sweep',
    label: 'geometry',
    run(state, { spec }) {
      // The letter domain needs each run's slice of the glyph's lit length, and this is the only
      // place that has the glyph's whole run list.
      const litRuns = state.runs.filter((r) => r.lit);
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

      for (const run of state.runs) {
        const place = spec.gradient && run.lit ? spans.get(run.index) : undefined;
        const geo = sweepRun(
          run,
          spec.radius,
          spec.segments,
          spec.gradient && place ? { domain: spec.gradient.domain, place } : undefined,
        );
        if (!geo) continue;
        (run.lit ? state.lit : state.dark).push(geo);
      }
    },
  },
];
