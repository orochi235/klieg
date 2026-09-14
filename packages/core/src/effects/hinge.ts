import type { Vec3 } from '../pose.js';
import type { Signal } from './signal.js';
import type { EffectPiece, PartOffset } from './types.js';

/** Scales one piece's contribution by the signal. Only channels with a rest can be faded. */
export type Blend = (offset: PartOffset, k: number) => PartOffset;

export interface StopsSpec {
  /** How many levels the signal is quantized to. Default 8, minimum 2. */
  stops?: number;
}

export interface BlendSpec {
  /** How the signal scales what the piece emitted. Defaults to `fade`. */
  blend?: Blend;
}

const NONE: PartOffset = {};
const STOPS = 8;

function scaled(v: Vec3, k: number): Vec3 {
  return [(v[0] as number) * k, (v[1] as number) * k, (v[2] as number) * k];
}

/**
 * Fades a contribution toward rest: multiplicative channels toward 1, additive toward 0. `color`
 * is a replacement rather than a contribution, so there is no identity to fade it toward without
 * the part's own color, which an offset does not carry — it passes through above zero and goes
 * with everything else at `k <= 0`, which is what keeps a color-writing piece from staying awake
 * at the far end of a falloff.
 */
export const fade: Blend = (o, k) => {
  if (!(k > 0)) return NONE;
  const out: PartOffset = {};
  if (o.gain !== undefined) out.gain = 1 + (o.gain - 1) * k;
  if (o.scale !== undefined) out.scale = 1 + (o.scale - 1) * k;
  if (o.position) out.position = scaled(o.position, k);
  if (o.rotation) out.rotation = scaled(o.rotation, k);
  if (o.crawl !== undefined) out.crawl = o.crawl * k;
  if (o.dark !== undefined) out.dark = o.dark * k;
  if (o.color !== undefined) out.color = o.color;
  if (o.light) out.light = { color: o.light.color, amount: o.light.amount * k };
  return out;
};

/**
 * Makes a piece a function of a signal as well as of time.
 *
 * Two modes, because `EffectFrame` reads a piece's `duration` once per effect before its per-part
 * loop: a piece whose duration varied by part would have no coherent pass.
 *
 * Given a **factory**, the piece is rebuilt once per stop at construction and the nearest stop is
 * taken each frame. This is the mode that reaches a knob decided inside the piece — `flicker`'s
 * `unrest` is a probability tested before anything is emitted, so no amount of scaling downstream
 * can reach it.
 *
 * Given a **piece**, it runs unchanged and `blend` scales what it emitted. Continuous, with no
 * quantization, for the channels that have a rest to fade toward.
 */
export function hinge(
  signal: Signal,
  make: (k: number) => EffectPiece,
  spec?: StopsSpec,
): EffectPiece;
export function hinge(signal: Signal, piece: EffectPiece, spec?: BlendSpec): EffectPiece;
export function hinge(
  signal: Signal,
  inner: ((k: number) => EffectPiece) | EffectPiece,
  spec: StopsSpec & BlendSpec = {},
): EffectPiece {
  if (typeof inner === 'function') {
    const stops = Math.max(2, Math.round(spec.stops ?? STOPS));
    const last = stops - 1;
    const pieces: EffectPiece[] = [];
    for (let i = 0; i < stops; i++) pieces.push(inner(i / last));

    const duration = (pieces[0] as EffectPiece).duration;
    for (let i = 1; i < stops; i++) {
      const other = (pieces[i] as EffectPiece).duration;
      if (other !== duration) {
        throw new Error(
          `klieg: hinge() stops disagree on duration — stop 0 is ${duration}ms and stop ${i} is ` +
            `${other}ms. Vary a knob that leaves the pass alone, such as flicker's unrest or ` +
            'depth rather than its spell or calm.',
        );
      }
    }

    return {
      duration,
      at(t, part, ctx) {
        const k = signal(t, part, ctx);
        const step = Number.isFinite(k) ? Math.round(k * last) : 0;
        const i = Math.min(last, Math.max(0, step));
        return (pieces[i] as EffectPiece).at(t, part, ctx);
      },
    };
  }

  const blend = spec.blend ?? fade;
  return {
    duration: inner.duration,
    at(t, part, ctx) {
      const k = signal(t, part, ctx);
      return blend(inner.at(t, part, ctx), Number.isFinite(k) ? k : 0);
    },
  };
}
