import { type Easing, easeOutCubic, linear } from '../easing.js';
import type { PoseOffset, Vec3 } from '../pose.js';
import { type LetterInfo, type MotionPiece, type StaggerSpec, stagger } from './types.js';

const TAU = Math.PI * 2;

/** Channels that multiply onto the rest pose, and so rest at 1 rather than 0. */
const IDENTITY = { position: 0, rotation: 0, scale: 1, opacity: 1 } as const;

export type Keyframe = PoseOffset & { at: number; ease?: Easing };

type Channel = keyof PoseOffset;

export interface TransitionSpec {
  /** Where letters begin, relaxing to rest. */
  from?: PoseOffset | ((letter: LetterInfo) => PoseOffset);
  /** Where letters end up, departing from rest. */
  to?: PoseOffset | ((letter: LetterInfo) => PoseOffset);
  /** N stops, each an offset from rest. `from`/`to` are the two-stop sugar. */
  keyframes?: Keyframe[];
  ease?: Easing;
  easeBy?: Partial<Record<Channel, Easing>>;
  /** Fraction of the pass a channel waits before it starts moving. Ignored with `keyframes`. */
  delayBy?: Partial<Record<Channel, number>>;
  stagger?: StaggerSpec | number;
}

const resolve = (
  spec: PoseOffset | ((letter: LetterInfo) => PoseOffset) | undefined,
  letter: LetterInfo,
): PoseOffset => (typeof spec === 'function' ? spec(letter) : (spec ?? {}));

function lerpVec(a: Vec3 | undefined, b: Vec3 | undefined, u: number): Vec3 {
  const from = a ?? [0, 0, 0];
  const to = b ?? [0, 0, 0];
  return [
    (from[0] as number) + ((to[0] as number) - (from[0] as number)) * u,
    (from[1] as number) + ((to[1] as number) - (from[1] as number)) * u,
    (from[2] as number) + ((to[2] as number) - (from[2] as number)) * u,
  ];
}

const lerp = (a: number | undefined, b: number | undefined, u: number, rest: number): number => {
  const from = a ?? rest;
  const to = b ?? rest;
  return from + (to - from) * u;
};

/**
 * Interpolates between two stops channel-wise, absent channels reading as identity. Reduces to
 * `scaleOffset(from, 1 - ease(s))` in the two-stop case, which is what keeps the sugar and the
 * general form the same arithmetic.
 *
 * Every curve is applied to `s`, the staggered parameter — not to the already-eased value. A
 * channel easing on a curve of a curve is a different motion, and `rise` is written against the
 * former. A channel delay re-maps `s` the same way, before that channel's easing sees it.
 */
function between(
  a: PoseOffset,
  b: PoseOffset,
  s: number,
  ease: Easing,
  easeBy: TransitionSpec['easeBy'],
  delayBy?: TransitionSpec['delayBy'],
): PoseOffset {
  const at = (channel: Channel) => {
    // A delay of 1 would leave no span to travel over, so the channel never reaches rest.
    const delay = Math.min(0.999, Math.max(0, delayBy?.[channel] ?? 0));
    const local = Math.max(0, (s - delay) / (1 - delay));
    return (easeBy?.[channel] ?? ease)(Math.min(1, local));
  };
  return {
    position: lerpVec(a.position, b.position, at('position')),
    rotation: lerpVec(a.rotation, b.rotation, at('rotation')),
    scale: lerp(a.scale, b.scale, at('scale'), IDENTITY.scale),
    opacity: lerp(a.opacity, b.opacity, at('opacity'), IDENTITY.opacity),
  };
}

/** Builds an `enter` or `exit`: eased travel between a displaced offset and rest. */
export function transition(duration: number, spec: TransitionSpec): MotionPiece {
  const ease = spec.ease ?? easeOutCubic;

  return {
    duration,
    offset(t, letter) {
      const s = spec.stagger === undefined ? t : stagger(t, letter, spec.stagger);

      if (spec.keyframes?.length) {
        const stops = [...spec.keyframes].sort((x, y) => x.at - y.at);
        const first = stops[0] as Keyframe;
        const last = stops[stops.length - 1] as Keyframe;
        if (s <= first.at) return between(first, first, 0, linear, spec.easeBy);
        if (s >= last.at) return between(last, last, 0, linear, spec.easeBy);

        for (let i = 1; i < stops.length; i++) {
          const b = stops[i] as Keyframe;
          if (s > b.at) continue;
          const a = stops[i - 1] as Keyframe;
          const span = b.at - a.at;
          const local = span > 0 ? (s - a.at) / span : 0;
          return between(a, b, local, b.ease ?? ease, spec.easeBy);
        }
      }

      // `from` relaxes toward identity; `to` departs from it.
      return spec.to === undefined
        ? between(resolve(spec.from, letter), {}, s, ease, spec.easeBy, spec.delayBy)
        : between({}, resolve(spec.to, letter), s, ease, spec.easeBy, spec.delayBy);
    },
  };
}

export interface CycleSpec {
  /** Peak deviation per channel. */
  amplitude?: PoseOffset;
  /** Cycles per pass, per channel. Defaults to 1. */
  harmonic?: PoseOffset;
  phase?: (letter: LetterInfo) => number;
}

const waveVec = (amp: Vec3 | undefined, harm: Vec3 | undefined, t: number, phase: number): Vec3 => {
  const a = amp ?? [0, 0, 0];
  const h = harm ?? [1, 1, 1];
  return [0, 1, 2].map((i) => {
    const cycles = (h[i] as number) ?? 1;
    return (a[i] as number) * Math.sin(t * TAU * cycles + phase);
  }) as Vec3;
};

/** Builds an `active`: a periodic deviation the phase loops over. */
export function cycle(duration: number, spec: CycleSpec = {}): MotionPiece {
  const amp = spec.amplitude ?? {};
  const harm = spec.harmonic ?? {};

  return {
    duration,
    offset(t, letter) {
      const phase = spec.phase?.(letter) ?? 0;
      const out: PoseOffset = {};
      if (amp.position) out.position = waveVec(amp.position, harm.position, t, phase);
      if (amp.rotation) out.rotation = waveVec(amp.rotation, harm.rotation, t, phase);
      // Multiplicative channels swing around 1, so an amplitude of 0 leaves the pose untouched.
      if (amp.scale !== undefined) {
        out.scale = 1 + amp.scale * Math.sin(t * TAU * (harm.scale ?? 1) + phase);
      }
      if (amp.opacity !== undefined) {
        out.opacity = 1 + amp.opacity * Math.sin(t * TAU * (harm.opacity ?? 1) + phase);
      }
      return out;
    },
  };
}

/** One piece for the letters a predicate keeps, another for the rest. */
export function partition(
  keep: (letter: LetterInfo) => boolean,
  kept: MotionPiece,
  dropped: MotionPiece,
): MotionPiece {
  return {
    duration: Math.max(kept.duration, dropped.duration),
    offset: (t, letter) => (keep(letter) ? kept.offset(t, letter) : dropped.offset(t, letter)),
  };
}
