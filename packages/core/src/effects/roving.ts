import { hash01 } from '../motion/types.js';
import { isRest } from './compositor.js';
import type { EffectPiece, FrameCtx, PartInfo, PartOffset } from './types.js';

export interface RovingSpec {
  /** Roughly how long one part holds the fault, in milliseconds. Adjusted so a whole number of
   * epochs fills a pass. */
  dwell?: number;
  /** Fixes which part is afflicted in which epoch, so a pinned frame reproduces. */
  seed?: number;
}

/** Epochs to a wrapper pass. */
const EPOCHS = 8;

const NONE: PartOffset = {};

/**
 * Moves an inner piece's affliction from part to part. Exactly one part of the pool is afflicted at
 * a time and it jumps somewhere unpredictable every few seconds — a travelling fault reads as an
 * effect, a jumping one reads as a defect, which is the point.
 *
 * The holder is drawn from the whole pool of its kind, so this wants `{ amount: 1 }` as its target:
 * against a subset the fault can land on a part the effect does not drive, and nothing lights up.
 */
export function roving(inner: EffectPiece, spec: RovingSpec = {}): EffectPiece {
  const seed = spec.seed ?? 0;
  const innerDuration = inner.duration > 0 ? inner.duration : 1000;
  const wanted = spec.dwell ?? 3200;
  // A whole number of inner passes, so the inner's reconstructed phase is continuous across the
  // wrapper's loop seam — then a whole number of epochs inside that, so no epoch is cut short.
  // Do NOT make the epoch itself a multiple of the inner pass: every handover would then sample the
  // inner at one fixed phase, where its rest is a per-part constant, and the first part that blocks
  // its own handover keeps the fault forever.
  const duration = Math.max(1, Math.round((EPOCHS * wanted) / innerDuration)) * innerDuration;
  const epochs = Math.max(1, Math.round(duration / wanted));
  const epoch = duration / epochs;

  const nominal = (n: number, count: number) =>
    Math.min(count - 1, Math.floor(hash01(n * 1.7 + seed * 91.3) * count));

  /**
   * Who holds the fault in epoch `n`. Two laps over the pass: `t` is normalized within a pass, so
   * the walk has to start somewhere, and the first lap is what finds where the previous pass left
   * the fault. Answering on the second makes the loop seam an ordinary deferred boundary rather
   * than the one handover nothing defers.
   */
  const holderOf = (n: number, part: PartInfo, ctx: FrameCtx) => {
    const count = Math.max(1, part.count);
    let held = nominal(0, count);
    for (let lap = 0; lap < 2; lap++) {
      for (let e = 0; e < epochs; e++) {
        const phase = ((e * epoch) % innerDuration) / innerDuration;
        if (isRest(inner.at(phase, { ...part, index: held }, ctx))) held = nominal(e, count);
        if (lap === 1 && e === n) return held;
      }
    }
    return held;
  };

  // One frame asks the same question once per targeted part, and roving targets every part of its
  // kind. Memoized on `t` so the chain is walked once a frame rather than once a part.
  let memoT = Number.NaN;
  let memoCount = -1;
  let memoHolder = 0;

  return {
    duration,
    at(t, part, ctx) {
      if (t !== memoT || part.count !== memoCount) {
        memoT = t;
        memoCount = part.count;
        memoHolder = holderOf(Math.min(epochs - 1, Math.floor((t * duration) / epoch)), part, ctx);
      }
      if (part.index !== memoHolder) return NONE;
      return inner.at(((t * duration) % innerDuration) / innerDuration, part, ctx);
    },
  };
}
