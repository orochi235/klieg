import { type Mix, mix, patch } from '@msb235/blits';
import type { StaggerSpec } from '../motion/types.js';
import { stagger } from '../motion/types.js';
import { selectIndices } from '../select.js';
import { EFFECTS } from './pieces.js';
import { asDelta, PART_CHANNELS, PART_RIG } from './rig.js';
import type { EffectPiece, EffectSpec, FrameCtx, PartInfo, ResolvedOffset } from './types.js';

/** Stands in until the first frame reports one. Nothing samples a piece before then. */
const NO_FRAME: FrameCtx = { pointer: null, pointerInWord: null, dt: 0, now: 0 };

/** One spec resolved against a pool: the built piece, and which pool positions it drives. */
export interface ResolvedEffect {
  piece: EffectPiece;
  /** Indices into the `parts` array this was planned against, not `PartInfo.index`. */
  parts: number[];
  stagger?: number | StaggerSpec;
}

/**
 * Resolves each spec's selection against the pool once. Selection is seeded and stable, so doing
 * it per frame would pick the same parts at the cost of re-selecting every frame.
 */
export function planEffects(
  specs: readonly EffectSpec[],
  parts: readonly PartInfo[],
): ResolvedEffect[] {
  return specs.map((spec) => {
    // Pool positions carry their index into `parts`: a part's `index` numbers its own kind, and
    // the two differ for every run part.
    const target = spec.target;
    const matches = (part: PartInfo) =>
      'fill' in target ? part.fill === target.fill : part.kind === target.kind;
    const pool = parts.map((part, index) => ({ part, index })).filter(({ part }) => matches(part));
    const chosen = selectIndices(
      pool.map(({ part }) => ({ index: part.index, length: part.span })),
      spec.target,
      spec.seed ?? 0,
    );
    return {
      piece: typeof spec.piece === 'string' ? EFFECTS[spec.piece]() : spec.piece,
      stagger: spec.stagger,
      parts: pool.filter(({ part }) => chosen.has(part.index)).map(({ index }) => index),
    };
  });
}

/**
 * Layers every effect that reaches a part and merges each targeted part once. One voice per
 * effect on a mix over the part rig: the effects are the score — which parts each reaches and how
 * far into its pass it is — and the mix owns how two layers join on every channel.
 *
 * Holds its own buffers: the targeted set is fixed at plan time, so rebuilding it per frame is
 * wasted work.
 */
export class EffectFrame {
  private touched: number[] = [];
  /** Pool positions `drop` took out of play, kept so a re-cue against a new pool leaves them out. */
  private readonly dropped = new Set<number>();
  private readonly out = new Map<number, ResolvedOffset>();
  private readonly mix: Mix<PartInfo, ResolvedOffset>;
  /** The pool the voices were targeted against, so a caller passing a new one gets new voices. */
  private pool: readonly PartInfo[] | null = null;
  /** This frame's context, which a piece still reads as its third argument. */
  private ctx: FrameCtx = NO_FRAME;

  constructor(private readonly effects: readonly ResolvedEffect[]) {
    const seen = new Set<number>();
    for (const effect of effects) {
      for (const index of effect.parts) {
        if (seen.has(index)) continue;
        seen.add(index);
        this.touched.push(index);
      }
    }
    this.mix = mix<PartInfo, ResolvedOffset>(PART_RIG, {});
  }

  /**
   * Cues one voice per effect against this pool. A voice's reach is a fixed set of parts, so it is
   * the pool that decides it: a caller handing over a different array re-cues from scratch.
   */
  private retarget(parts: readonly PartInfo[]): void {
    this.pool = parts;
    this.mix.mute();
    for (const effect of this.effects) {
      const reached = new Set<PartInfo>();
      for (const index of effect.parts) {
        const part = parts[index];
        if (part && !this.dropped.has(index)) reached.add(part);
      }
      const duration = effect.piece.duration;
      this.mix.cue({
        patch: patch<PartInfo, ResolvedOffset>(
          0,
          (_phase, part, setting) => {
            const pass = duration > 0 ? (setting.elapsed % duration) / duration : 0;
            const t = effect.stagger === undefined ? pass : stagger(pass, part, effect.stagger);
            return asDelta(effect.piece.at(t, part, this.ctx));
          },
          { writes: PART_CHANNELS },
        ),
        target: (part) => reached.has(part),
      });
    }
  }

  /**
   * Takes pool positions out of every effect for good: the mix forgets them, and `resolve` no
   * longer reports them, so whatever the caller last wrote to them stays.
   */
  drop(indices: readonly number[]): void {
    let changed = false;
    for (const index of indices) {
      if (this.dropped.has(index)) continue;
      this.dropped.add(index);
      changed = true;
      const part = this.pool?.[index];
      if (part) this.mix.drop(part);
    }
    if (changed) this.touched = this.touched.filter((index) => !this.dropped.has(index));
  }

  /** Every targeted part's merged offset, leaving out those `drop` took out of play. */
  resolve(parts: readonly PartInfo[], elapsed: number, ctx: FrameCtx): Map<number, ResolvedOffset> {
    if (this.pool !== parts) this.retarget(parts);
    this.ctx = ctx;
    this.out.clear();
    this.mix.sync(elapsed);

    for (const index of this.touched) {
      const part = parts[index];
      if (!part) continue;
      this.out.set(index, this.mix.probe(part));
    }
    return this.out;
  }
}
