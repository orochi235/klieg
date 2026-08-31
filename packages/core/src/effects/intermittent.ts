import type { EffectPiece, PartInfo, PartOffset } from './types.js';

export interface IntermittentSpec {
  /**
   * Milliseconds of one bout, where the inner shows through. Adjusted so a whole number of bouts
   * fills a pass. Must cover at least one inner pass, or the bout shows a sliver of the inner and
   * reads as a glitch rather than a spell.
   */
  spell?: number;
  /** Milliseconds held quiet between bouts. 0, the default, is a pass-through. */
  calm?: number;
  /** Bouts to a pass, and so how long the wrapper's own loop runs before it repeats. */
  bouts?: number;
}

const NONE: PartOffset = {};

/**
 * Runs an inner piece in bouts, swallowing its output between them. The inner is never reset — it
 * keeps running against the wall clock and the gate only decides whether anything reaches the
 * part, so a bout opens wherever the inner happens to be.
 *
 * Which is the whole difficulty, and it lives in two periods that must be tuned against each other
 * rather than together. The **pass** is a whole number of inner passes, so the inner's phase is
 * continuous across the wrapper's loop seam. The **bout** deliberately is not: tie that to the
 * inner as well and every bout opens on phase 0, so they all look identical while the inner
 * genuinely never resets — the failure is invisible in the code and obvious on screen.
 * `spikes/intermittent-phase.mjs` reproduces both readings.
 *
 * `flicker`'s own `spell`/`calm` cover the same ground for flicker alone, deriving both scales from
 * one `t`; this is for the wrappers that cannot, `roving` and `hue` among them.
 */
export function intermittent(inner: EffectPiece, spec: IntermittentSpec = {}): EffectPiece {
  const innerDuration = inner.duration > 0 ? inner.duration : 1000;
  const calm = Math.max(0, spec.calm ?? 0);
  if (calm === 0) return inner;

  const spell = Math.max(0, spec.spell ?? innerDuration * 3);
  if (spell < innerDuration) {
    throw new Error(
      `intermittent: spell ${spell}ms is under one inner pass (${innerDuration}ms), which shows a ` +
        'sliver of the inner rather than a bout',
    );
  }

  const wantedBouts = Math.max(1, Math.round(spec.bouts ?? 4));
  const wantedCycle = spell + calm;
  // A whole number of inner passes for the seam; then a whole number of bouts inside it, which
  // leaves the bout length off the inner's period and walks the opening phase. Do NOT round the
  // cycle itself onto the inner — see above.
  const duration =
    Math.max(1, Math.round((wantedBouts * wantedCycle) / innerDuration)) * innerDuration;
  const bouts = Math.max(1, Math.round(duration / wantedCycle));
  const cycle = duration / bouts;
  const lit = cycle * (spell / wantedCycle);

  return {
    duration,
    at(t: number, part: PartInfo, ctx) {
      const ms = t * duration;
      if (ms % cycle >= lit) return NONE;
      return inner.at((ms % innerDuration) / innerDuration, part, ctx);
    },
  };
}
