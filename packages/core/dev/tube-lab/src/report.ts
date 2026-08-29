import { minBendRadius } from '@core/render/tube/bend.js';
import type { SurfaceKind, TubeBlueprint } from '@core/render/tube/index.js';
import { tightestBend } from '@core/render/tube/sweep.js';

export interface RunReport {
  index: number;
  surface: SurfaceKind;
  length: number;
  lit: boolean;
  /** The run's tightest bend radius, in em. */
  tightest: number;
  /** `rhoMin` for this spec — the bend radius the material is allowed to take. */
  minimum: number;
  /** Tighter than `minimum`: the corner stage failed to make this run bendable. */
  unresolved: boolean;
  /** `sweepRun` returned null, so this run is absent from `lit` and `dark` but present in `runs`. */
  dropped: boolean;
}

export interface Report {
  runs: RunReport[];
  unresolved: number;
  dropped: number;
  summary: string;
}

export function reportOf(blueprint: TubeBlueprint, requested: number, bend?: number): Report {
  const minimum = minBendRadius(requested, bend);
  const runs = blueprint.runs.map((run) => {
    // The same two conditions `sweepRun` returns null on, so `dropped` cannot drift from it.
    const drawable = run.points.length >= 2 && requested > 0;
    const tightest = drawable ? tightestBend(run) : 0;
    return {
      index: run.index,
      surface: run.surface,
      length: run.length,
      lit: run.lit,
      tightest,
      minimum,
      // Against rhoMin, never against the tube radius: those are different quantities under the
      // bend model, and comparing the wrong pair returns plausible booleans rather than failing.
      unresolved: drawable && tightest < minimum,
      dropped: !drawable,
    };
  });
  const unresolved = runs.filter((r) => r.unresolved).length;
  const dropped = runs.filter((r) => r.dropped).length;
  return {
    runs,
    unresolved,
    dropped,
    summary: `${runs.length} runs · ${unresolved} unresolved · ${dropped} dropped`,
  };
}
