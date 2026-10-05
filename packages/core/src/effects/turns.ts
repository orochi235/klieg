import { isRest } from './compositor.js';
import { EFFECTS } from './patches.js';
import type { EffectName, EffectPatch, PartDelta, PartInfo, Setting } from './types.js';

export interface TurnsSpec {
  /** Run one at a time, in this order. A name from the registry, or a patch from a factory. */
  patches: readonly (EffectName | EffectPatch)[];
  /** Milliseconds one patch holds before handing over. */
  every?: number;
  /** Milliseconds a part may be overdue before it is made to swap mid-flight. */
  deadline?: number;
  /**
   * How far the handover is spread across the word, as a share of one step. 0 switches the whole
   * sign at once. This is the patch's own, deliberately not `EffectSpec.stagger`: the frame planner
   * spends that one before the patch is called, and it ramps `phase` rather than offsetting it.
   */
  stagger?: number;
}

const EVERY = 3000;
const DEADLINE = 400;
const STAGGER = 0.6;

/**
 * A deadline at a whole step lets a part fall more than one step behind, and the patch it was
 * overdue for is skipped outright — the chase never happens on that letter. Held below one step
 * so the walk below can read a part's patch straight off its step count.
 */
const DEADLINE_CAP = 0.9;

/** Probes across the deferral window. Rest is sampled, not solved: a patch answers only "am I at
 * rest right now", and the window is one step at most. */
const PROBES = 12;

const NONE: PartDelta = {};

function clamp01(n: number): number {
  return Math.min(Math.max(n, 0), 1);
}

/**
 * Runs a list of patches one at a time instead of layering them: a sign flickers for a few seconds,
 * then chases, then shifts hue, forever. An ordinary `EffectPatch`, so the compositor is unchanged
 * and it composes with everything already written.
 *
 * A part swaps at the first moment the outgoing patch reports itself at rest, and is made to swap
 * once it has been overdue by `deadline`. Deferring to rest is what makes a clean handover need no
 * crossfade — at rest there is nothing on screen to cut away from — and the deadline is what keeps
 * a patch that never rests, `hue` being one, from holding its part for good.
 *
 * Pure in `phase`: the walk is rebuilt every frame from the phase alone, as `roving`'s is, because a
 * patch is handed a wrapped `phase` and never absolute time.
 */
export function turns(spec: TurnsSpec): EffectPatch {
  const patches = spec.patches.map((p) => (typeof p === 'string' ? EFFECTS[p]() : p));
  const count = patches.length;
  const every = Math.max(1, spec.every ?? EVERY);
  const deadline = Math.min(Math.max(0, spec.deadline ?? DEADLINE), every * DEADLINE_CAP);
  const spread = clamp01(spec.stagger ?? STAGGER);
  const period = count * every;

  /** One patch's own delta at an absolute point of the wrapper's pass. */
  const sample = (patch: EffectPatch, ms: number, part: PartInfo, setting: Setting): PartDelta => {
    if (patch.period <= 0) return patch.at(0, part, setting);
    return patch.at((ms % patch.period) / patch.period, part, setting);
  };

  /** Spread over one step rather than the whole pass, so the last part to turn is at most one step
   * behind the first however many patches the list holds. */
  const delayOf = (part: PartInfo): number => {
    const pool = Math.max(1, part.count);
    return pool < 2 ? 0 : (part.index / (pool - 1)) * spread * every;
  };

  /** When the swap into step `k` actually lands: the first rest of the outgoing patch inside the
   * window, else the far end of it. */
  const swapAt = (k: number, delay: number, part: PartInfo, setting: Setting): number => {
    const nominal = k * every + delay;
    if (deadline <= 0) return nominal;
    const outgoing = patches[(k - 1 + count) % count] as EffectPatch;
    for (let i = 0; i < PROBES; i++) {
      const at = nominal + (deadline * i) / PROBES;
      if (isRest(sample(outgoing, at, part, setting))) return at;
    }
    return nominal + deadline;
  };

  return {
    period,
    at(phase, part, setting) {
      if (count === 0) return NONE;
      const now = phase * period;
      const delay = delayOf(part);
      let step = 0;
      for (let k = 1; k <= count; k++) {
        if (swapAt(k, delay, part, setting) > now) break;
        step = k;
      }
      return sample(patches[step % count] as EffectPatch, now, part, setting);
    },
  };
}
