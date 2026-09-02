import { hash01 } from '../motion/types.js';
import { isRest } from './compositor.js';
import type { EffectPiece, FrameCtx, PartInfo, PartOffset } from './types.js';

export interface RovingSpec {
  /** Roughly how long one part holds the fault, in milliseconds. Adjusted so a whole number of
   * epochs fills a pass. */
  dwell?: number;
  /** Fixes which part is afflicted in which epoch, so a pinned frame reproduces. */
  seed?: number;
  /**
   * Handovers to a pass, and so the ceiling on how many parts a pass can visit before it loops.
   * A pool larger than this never has all of its parts afflicted, however long the sign runs.
   * Raise it for a sign wider than the default covers; lower it for a shorter cycle.
   */
  epochs?: number;
}

/** Real words measure 3 to 55 run parts. At 96 a pass visits every part of a pool up to 29 and
 * 51 of 55, deferral being what costs the rest; raising it further buys little for a much longer
 * cycle. Was 8, which visited 5 of 55 and then looped. */
const EPOCHS = 96;

const NONE: PartOffset = {};

/** A seeded permutation of `0..count`, by Fisher-Yates over `hash01`. Pure in `(count, seed)`. */
function shuffle(count: number, seed: number): number[] {
  const out = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(hash01(i * 2.3 + seed * 57.1) * (i + 1)));
    const swap = out[i] as number;
    out[i] = out[j] as number;
    out[j] = swap;
  }
  return out;
}

export interface RovingPiece extends EffectPiece {
  /** The slot `dwell` was rounded to, in milliseconds. A part holds the fault for at least this
   * long and often longer: a handover is deferred while the outgoing part is not at rest. */
  readonly epoch: number;
  /** How many of those fill one pass. */
  readonly epochs: number;
}

/**
 * Moves an inner piece's affliction from part to part. Exactly one part of the pool is afflicted at
 * a time and it jumps somewhere unpredictable every few seconds — a travelling fault reads as an
 * effect, a jumping one reads as a defect, which is the point.
 *
 * The holder is drawn from the whole pool of its kind, so this wants `{ amount: 1 }` as its target:
 * against a subset the fault can land on a part the effect does not drive, and nothing lights up.
 *
 * The inner must be a pure function of `(t, part.index)`: the holder walk calls it with the
 * calling part's `x`/`y` unchanged but a substituted `index`, so a position-dependent piece such
 * as `lamp` is not a valid inner.
 */
export function roving(inner: EffectPiece, spec: RovingSpec = {}): RovingPiece {
  const seed = spec.seed ?? 0;
  const wantedEpochs = Math.max(1, Math.round(spec.epochs ?? EPOCHS));
  const innerDuration = inner.duration > 0 ? inner.duration : 1000;
  const wanted = spec.dwell ?? 3200;
  // A whole number of inner passes, so the inner's reconstructed phase is continuous across the
  // wrapper's loop seam — then a whole number of epochs inside that, so no epoch is cut short.
  // Do NOT make the epoch itself a multiple of the inner pass: every handover would then sample the
  // inner at one fixed phase, where its rest is a per-part constant, and the first part that blocks
  // its own handover keeps the fault forever.
  const duration = Math.max(1, Math.round((wantedEpochs * wanted) / innerDuration)) * innerDuration;
  const epochs = Math.max(1, Math.round(duration / wanted));
  const epoch = duration / epochs;

  /**
   * The nth part to take the fault. A seeded permutation rather than an independent draw per
   * epoch: independent draws are coupon-collecting, which visited 7 parts of a pool of 24 over a
   * whole pass and then looped, so 17 parts never flickered at all. A lap gives every part exactly
   * one turn, and each lap reshuffles, so a pool smaller than `epochs` does not repeat one order.
   */
  let permCount = -1;
  let permLap = -1;
  let perm: number[] = [];
  const nominal = (n: number, count: number) => {
    const lap = Math.floor(n / count);
    if (count !== permCount || lap !== permLap) {
      permCount = count;
      permLap = lap;
      perm = shuffle(count, seed + lap * 7.3);
    }
    return perm[n % count] as number;
  };

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
    epoch,
    epochs,
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
