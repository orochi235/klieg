import type { StaggerSpec } from '../motion/types.js';
import { stagger } from '../motion/types.js';
import { selectIndices } from '../select.js';
import { mergeOffsets } from './compositor.js';
import { EFFECTS } from './pieces.js';
import type {
  EffectPiece,
  EffectSpec,
  FrameCtx,
  PartInfo,
  PartOffset,
  ResolvedOffset,
} from './types.js';

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
 * Layers every effect that reaches a part and merges each targeted part once. Holds its own
 * buffers: the targeted set is fixed at plan time, so rebuilding it per frame is wasted work.
 */
export class EffectFrame {
  private readonly layers = new Map<number, PartOffset[]>();
  private readonly out = new Map<number, ResolvedOffset>();

  constructor(private readonly effects: readonly ResolvedEffect[]) {
    for (const effect of effects) {
      for (const index of effect.parts) {
        if (!this.layers.has(index)) this.layers.set(index, []);
      }
    }
  }

  /** Every targeted part's merged offset. `skip` drops one the caller no longer wants written. */
  resolve(
    parts: readonly PartInfo[],
    elapsed: number,
    ctx: FrameCtx,
    skip?: (index: number) => boolean,
  ): Map<number, ResolvedOffset> {
    for (const layers of this.layers.values()) layers.length = 0;
    this.out.clear();

    for (const effect of this.effects) {
      const duration = effect.piece.duration;
      const pass = duration > 0 ? (elapsed % duration) / duration : 0;
      for (const index of effect.parts) {
        if (skip?.(index)) continue;
        const part = parts[index] as PartInfo;
        const t = effect.stagger === undefined ? pass : stagger(pass, part, effect.stagger);
        (this.layers.get(index) as PartOffset[]).push(effect.piece.at(t, part, ctx));
      }
    }

    for (const [index, layers] of this.layers) {
      if (skip?.(index)) continue;
      this.out.set(index, mergeOffsets(layers));
    }
    return this.out;
  }
}
