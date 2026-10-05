import { type Signal as BlitsSignal, type Mix, mix, type Patch, patch } from '@msb235/blits';
import type { StaggerSpec } from '../motion/types.js';
import { stagger } from '../motion/types.js';
import { selectIndices } from '../select.js';
import { EFFECTS } from './patches.js';
import { asDelta, PART_CHANNELS, PART_KIT } from './rig.js';
import {
  type EffectPatch,
  type EffectSpec,
  type Host,
  type PartInfo,
  type PartPose,
  relay,
  type Setting,
} from './types.js';

/** One spec resolved against a pool: the built patch, and which pool positions it drives. */
export interface ResolvedEffect {
  patch: EffectPatch;
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
      patch: typeof spec.patch === 'string' ? EFFECTS[spec.patch]() : spec.patch,
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
  private readonly out = new Map<number, PartPose>();
  private readonly mix: Mix<PartInfo, PartPose>;
  /** The pool the voices were targeted against, so a caller passing a new one gets new voices. */
  private pool: readonly PartInfo[] | null = null;
  private frame: Host = NO_HOST;
  private reduced = false;

  constructor(private readonly effects: readonly ResolvedEffect[]) {
    const seen = new Set<number>();
    for (const effect of effects) {
      for (const index of effect.parts) {
        if (seen.has(index)) continue;
        seen.add(index);
        this.touched.push(index);
      }
    }
    this.mix = mix<PartInfo, PartPose>(PART_KIT, {
      host: relay(() => this.frame),
      reduce: () => this.reduced,
      // `color` has no rest to scale toward, so a weighed voice passes it whole at any weight above
      // zero, as `hinge`'s own `weigh` does.
      band: { on: Number.MIN_VALUE, off: 0 },
    });
  }

  /**
   * Cues each effect against this pool: one voice, a weighed one for a hinged patch, or a blend of
   * a hinge's stops. A voice's reach is a fixed set of parts, so it is the pool that decides it: a
   * caller handing over a different array re-cues from scratch.
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
      const target = (part: PartInfo) => reached.has(part);
      const hinged = effect.patch.hinged;
      if (hinged && 'stops' in hinged) {
        this.mix.blend(
          hinged.stops.map((stop) => voiceOf(stop, effect.stagger)),
          hinged.by as BlitsSignal<PartInfo>,
          { target },
        );
      } else if (hinged) {
        this.mix.cue({
          patch: voiceOf(hinged.patch, effect.stagger),
          weight: hinged.by as BlitsSignal<PartInfo>,
          target,
        });
      } else {
        this.mix.cue({ patch: voiceOf(effect.patch, effect.stagger), target });
      }
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

  /**
   * Every targeted part's merged pose, leaving out those `drop` took out of play. `elapsed` is the
   * fire's clock, and `host` what this frame's patches read on `setting.host`.
   */
  resolve(
    parts: readonly PartInfo[],
    elapsed: number,
    host: Host,
    reduced = false,
  ): Map<number, PartPose> {
    if (this.pool !== parts) this.retarget(parts);
    this.frame = host;
    this.reduced = reduced;
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

/** Stands in until the first frame reports one. Nothing samples a patch before then. */
const NO_HOST: Host = { pointer: null, pointerInWord: null, now: 0 };

/**
 * An effect patch as a blits patch: its pass taken from the voice's clock, warped per part by the
 * effect's stagger, which blits' own `stagger` — a delay in milliseconds — is not.
 */
function voiceOf(
  effect: EffectPatch,
  spread: number | StaggerSpec | undefined,
): Patch<PartInfo, PartPose> {
  const period = effect.period;
  return patch<PartInfo, PartPose>(
    0,
    (_phase, part, setting) => {
      const pass = period > 0 ? (setting.elapsed % period) / period : 0;
      const phase = spread === undefined ? pass : stagger(pass, part, spread);
      return asDelta(effect.at(phase, part, setting as Setting));
    },
    { writes: PART_CHANNELS },
  );
}
