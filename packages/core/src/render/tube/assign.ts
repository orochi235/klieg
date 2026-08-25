import * as THREE from 'three';
import { type SelectSpec, selectIndices } from '../../select.js';
import { type GradientSpec, perRunT, rampAt } from './gradient.js';
import type { Run } from './runs.js';
import type { SurfaceKind } from './surfaces.js';

export type { SelectSpec } from '../../select.js';

/**
 * Sets `lit` and `color` in place of the incoming order. The run list order never changes —
 * a post-effects layer addresses runs by index, so reordering here would silently retarget it.
 */
export function assign(
  runs: Run[],
  select: SelectSpec,
  colors: number[],
  seed: number,
  surfaceColors?: Partial<Record<SurfaceKind, number[]>>,
  surfaces: readonly SurfaceKind[] = [],
  gradient?: GradientSpec,
): Run[] {
  if (runs.length === 0) return runs;
  // Blockout is paint, not selection: a return carries the tube past a corner unlit whatever
  // `select` picked, and it must not spend that selection's budget on the way.
  const lightable = runs.filter((r) => !r.dark);

  const chosen = selectIndices(lightable, select, seed);
  for (const run of runs) run.lit = chosen.has(run.index);

  for (const run of runs) if (run.dark) run.lit = false;

  const palette = colors.length > 0 ? colors : [0xffffff];
  if (!surfaceColors) {
    let n = 0;
    for (const run of runs) {
      if (!run.lit) continue;
      run.color = palette[n % palette.length] as number;
      n++;
    }
    return applyPerRunGradient(runs, surfaces, surfaceColors, gradient);
  }

  // A per-surface palette cycles on its own cursor, so a layer's colours run in order rather than
  // being dealt from a shared deck. Reached only when a spec asks for one: sharing the cursor is
  // what every published look was assigned with, and a multi-colour palette would notice.
  const cursors = new Map<SurfaceKind, number>();
  for (const run of runs) {
    if (!run.lit) continue;
    const own = surfaceColors[run.surface];
    const use = own && own.length > 0 ? own : palette;
    const n = cursors.get(run.surface) ?? 0;
    run.color = use[n % use.length] as number;
    cursors.set(run.surface, n + 1);
  }
  return applyPerRunGradient(runs, surfaces, surfaceColors, gradient);
}

/**
 * Per-run domains only. A per-vertex or positional domain returns the runs untouched: its colour
 * is resolved in the sweep or the shader, and the dealt colour is what `modulate` multiplies there.
 */
function applyPerRunGradient(
  runs: Run[],
  surfaces: readonly SurfaceKind[],
  surfaceColors: Partial<Record<SurfaceKind, number[]>> | undefined,
  gradient?: GradientSpec,
): Run[] {
  if (!gradient) return runs;
  // A per-layer palette names colours directly; the surface domain is the coarser way of asking
  // for the same thing, so it yields rather than overwriting them.
  if (gradient.domain.of === 'surface' && surfaceColors !== undefined) return runs;
  const lit = runs.filter((r) => r.lit);
  const scratch = new THREE.Color();
  for (let n = 0; n < lit.length; n++) {
    const run = lit[n] as Run;
    const t = perRunT(
      gradient.domain,
      { litOrdinal: n, litCount: lit.length, surface: run.surface },
      surfaces,
    );
    if (t === null) return runs;
    const ramp = rampAt(gradient.stops, t);
    if (gradient.mode === 'replace') {
      run.color = ramp.getHex();
    } else {
      scratch.setHex(run.color).multiply(ramp);
      run.color = scratch.getHex();
    }
  }
  return runs;
}
