import { isRest } from './compositor.js';
import { EFFECTS } from './pieces.js';
import type { EffectName, EffectPiece, FrameCtx, PartInfo, PartOffset } from './types.js';

export interface TurnsSpec {
  /** Run one at a time, in this order. A name from the registry, or a piece from a factory. */
  pieces: readonly (EffectName | EffectPiece)[];
  /** Milliseconds one piece holds before handing over. */
  every?: number;
  /** Milliseconds a part may be overdue before it is made to swap mid-flight. */
  deadline?: number;
  /**
   * How far the handover is spread across the word, as a share of one step. 0 switches the whole
   * sign at once. This is the piece's own, deliberately not `EffectSpec.stagger`: the frame planner
   * spends that one before the piece is called, and it ramps `t` rather than offsetting it.
   */
  stagger?: number;
}

const EVERY = 3000;
const DEADLINE = 400;
const STAGGER = 0.6;

/**
 * A deadline at a whole step lets a part fall more than one step behind, and the piece it was
 * overdue for is skipped outright — the chase never happens on that letter. Held below one step
 * so the walk below can read a part's piece straight off its step count.
 */
const DEADLINE_CAP = 0.9;

/** Probes across the deferral window. Rest is sampled, not solved: a piece answers only "am I at
 * rest right now", and the window is one step at most. */
const PROBES = 12;

const NONE: PartOffset = {};

function clamp01(n: number): number {
  return Math.min(Math.max(n, 0), 1);
}

/**
 * Runs a list of pieces one at a time instead of layering them: a sign flickers for a few seconds,
 * then chases, then shifts hue, forever. An ordinary `EffectPiece`, so the compositor is unchanged
 * and it composes with everything already written.
 *
 * A part swaps at the first moment the outgoing piece reports itself at rest, and is made to swap
 * once it has been overdue by `deadline`. Deferring to rest is what makes a clean handover need no
 * crossfade — at rest there is nothing on screen to cut away from — and the deadline is what keeps
 * a piece that never rests, `hue` being one, from holding its part for good.
 *
 * Pure in `t`: the walk is rebuilt every frame from the phase alone, as `roving`'s is, because a
 * piece is handed a wrapped `t` and never absolute time.
 */
export function turns(spec: TurnsSpec): EffectPiece {
  const pieces = spec.pieces.map((p) => (typeof p === 'string' ? EFFECTS[p]() : p));
  const count = pieces.length;
  const every = Math.max(1, spec.every ?? EVERY);
  const deadline = Math.min(Math.max(0, spec.deadline ?? DEADLINE), every * DEADLINE_CAP);
  const spread = clamp01(spec.stagger ?? STAGGER);
  const duration = count * every;

  /** One piece's own offset at an absolute point of the wrapper's pass. */
  const sample = (piece: EffectPiece, ms: number, part: PartInfo, ctx: FrameCtx): PartOffset => {
    if (piece.duration <= 0) return piece.at(0, part, ctx);
    return piece.at((ms % piece.duration) / piece.duration, part, ctx);
  };

  /** Spread over one step rather than the whole pass, so the last part to turn is at most one step
   * behind the first however many pieces the list holds. */
  const phaseOf = (part: PartInfo): number => {
    const pool = Math.max(1, part.count);
    return pool < 2 ? 0 : (part.index / (pool - 1)) * spread * every;
  };

  /** When the swap into step `k` actually lands: the first rest of the outgoing piece inside the
   * window, else the far end of it. */
  const swapAt = (k: number, phase: number, part: PartInfo, ctx: FrameCtx): number => {
    const nominal = k * every + phase;
    if (deadline <= 0) return nominal;
    const outgoing = pieces[(k - 1 + count) % count] as EffectPiece;
    for (let i = 0; i < PROBES; i++) {
      const at = nominal + (deadline * i) / PROBES;
      if (isRest(sample(outgoing, at, part, ctx))) return at;
    }
    return nominal + deadline;
  };

  return {
    duration,
    at(t, part, ctx) {
      if (count === 0) return NONE;
      const now = t * duration;
      const phase = phaseOf(part);
      let step = 0;
      for (let k = 1; k <= count; k++) {
        if (swapAt(k, phase, part, ctx) > now) break;
        step = k;
      }
      return sample(pieces[step % count] as EffectPiece, now, part, ctx);
    },
  };
}
