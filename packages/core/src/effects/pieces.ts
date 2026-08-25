import { hash01 } from '../motion/types.js';
import type { EffectName, EffectPiece } from './types.js';

export interface FlickerSpec {
  duration?: number;
  /** How dark the stutter goes, as the floor of `gain`. 0 is fully out. */
  depth?: number;
  /** Share of the pass spent stuttering. The rest is held lit. */
  unrest?: number;
}

/** Steps per pass. One step is ~58ms at the default duration, so the shortest drop covers about
 * three frames at 60fps; a one-frame drop reads as noise rather than as a failing tube. */
const STEPS = 24;

/** How far above `depth` a drop is allowed to sit, so a stutter lands near dark, not half-lit. */
const BITE = 0.35;

function clamp01(n: number): number {
  return Math.min(Math.max(n, 0), 1);
}

/** A tube on its way out: mostly lit, with short irregular stutters. */
export function flicker(spec: FlickerSpec = {}): EffectPiece {
  const duration = spec.duration ?? 1400;
  const depth = clamp01(spec.depth ?? 0);
  const unrest = clamp01(spec.unrest ?? 0.18);

  return {
    duration,
    at(t, part) {
      const step = Math.floor(t * STEPS) % STEPS;
      if (hash01(step + part.index * 977.3) > unrest) return { gain: 1 };
      const bite = hash01(step * 3.7 + part.index * 131.1);
      return { gain: depth + (1 - depth) * bite * BITE };
    },
  };
}

// `satisfies` rather than an annotation: it holds every name to a factory usable with no spec,
// which is all a name lookup can supply, without binding the next piece to `FlickerSpec`.
export const EFFECTS = { flicker } satisfies Record<EffectName, () => EffectPiece>;
