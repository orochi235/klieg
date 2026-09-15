import { clamp01 } from '../easing.js';
import { hash01 } from '../motion/types.js';
import type { Signal } from './signal.js';
import type { EffectPiece, FrameCtx, PartOffset } from './types.js';

/** How a sign comes back on: gain against milliseconds since it began warming. */
export interface Warmup {
  /** Milliseconds from dark to warm. */
  duration: number;
  /** 0..1 at `ms` into the warm-up. Every part reads the same value, so the sign moves as one. */
  gain(ms: number): number;
}

/** flicker's own step, so a warm-up's stutter lasts as long as a failing tube's. */
const STEP_MS = 1400 / 24;

export interface StrikeSpec {
  /** Milliseconds from the first blink to holding lit. Default 1200. */
  duration?: number;
  /** How many blinks it takes to catch. Default 4. */
  strikes?: number;
}

/** A starter kicking a tube: full-on, full-off blinks whose lit share grows until it catches. */
export function strike(spec: StrikeSpec = {}): Warmup {
  const duration = Math.max(0, spec.duration ?? 1200);
  const strikes = Math.max(1, Math.round(spec.strikes ?? 4));
  const cycle = duration / strikes;
  return {
    duration,
    gain(ms) {
      if (!(ms < duration)) return 1;
      const at = Math.max(0, ms);
      const i = Math.floor(at / cycle);
      const lit = (i + 1) / (strikes + 1);
      return at - i * cycle >= cycle * (1 - lit) ? 1 : 0;
    },
  };
}

export interface ThinningSpec {
  /** Milliseconds until the last drop. Default 1500. */
  duration?: number;
  /** The gain a drop falls to. Default 0.1. */
  depth?: number;
}

/** Mostly lit from the first frame, with drops that come rarer until none are left. */
export function thinning(spec: ThinningSpec = {}): Warmup {
  const duration = Math.max(0, spec.duration ?? 1500);
  const depth = clamp01(spec.depth ?? 0.1);
  return {
    duration,
    gain(ms) {
      if (!(ms < duration)) return 1;
      const at = Math.max(0, ms);
      const left = 1 - at / duration;
      return hash01(Math.floor(at / STEP_MS) * 7.3 + 0.5) < 0.6 * left * left ? depth : 1;
    },
  };
}

export interface GlowSpec {
  /** Milliseconds from dark to full. Default 1500. */
  duration?: number;
}

/** Climbs from dark to full with small dips on the way, like gas warming rather than a starter. */
export function glow(spec: GlowSpec = {}): Warmup {
  const duration = Math.max(0, spec.duration ?? 1500);
  return {
    duration,
    gain(ms) {
      if (!(ms < duration)) return 1;
      const at = Math.max(0, ms);
      const u = at / duration;
      const dip = hash01(Math.floor(at / STEP_MS) * 3.1 + 9.2) < 0.3 ? 0.75 : 1;
      return u * u * dip;
    },
  };
}

export type PowerState = 'on' | 'shorted' | 'warming';

/** Shorts the sign when a signal holds high, as an overloaded tube does. */
export interface TripSpec {
  /** What is watched. It trips when any part the power piece drives reads at least `at`. */
  on: Signal;
  /** Default 1. */
  at?: number;
  /** Milliseconds the reading must hold before the sign shorts. Default 3000. */
  holdMs?: number;
  /** Milliseconds it stays dark before warming up again. Default 3000. */
  outMs?: number;
}

export interface PowerSpec {
  /** How it comes back on. Defaults to `strike()`. */
  warmup?: Warmup;
  /** Where a fire opens. Default `'on'`; `'warming'` powers a sign up as it arrives. */
  start?: PowerState;
  trip?: TripSpec;
}

export interface PowerControl {
  /** Add to the fire's effects: every part it targets goes dark while shorted and follows the
   * warm-up while warming, and it contributes nothing once on. A trip is watched from here too. */
  readonly piece: EffectPiece;
  /** 1 once on, 0 while shorted or warming — for `hinge`, to hold a sign's own effects off until
   * it is warm. */
  readonly warm: Signal;
  /** The state asked for most recently, which reaches the sign on its next frame. */
  readonly state: PowerState;
  /** Dark until `up()`, or for `for` milliseconds and then warming by itself. */
  short(options?: { for?: number }): void;
  /** Warms a shorted sign up. Does nothing to one already on or warming. */
  up(): void;
}

const NONE: PartOffset = {};
const DARK: PartOffset = { gain: 0 };

/**
 * A sign-wide power state your code switches: on, shorted, or warming back up. Calls land between
 * frames on your clock rather than klieg's, so each takes effect on the next frame and is timed
 * from that frame's `ctx.now`. State advances once per frame however many parts and words ask.
 *
 * Under reduced motion a warm-up is skipped and the sign comes straight back on: `strike` is a
 * run of whole-sign flashes.
 */
export function power(spec: PowerSpec = {}): PowerControl {
  const warmup = spec.warmup ?? strike();
  const trip = spec.trip;
  const tripAt = trip?.at ?? 1;
  const holdMs = trip?.holdMs ?? 3000;
  const outMs = trip?.outMs ?? 3000;

  let state: PowerState = spec.start ?? 'on';
  let since: number | null = null;
  let darkFor: number | null = null;
  let asked: { state: PowerState; for: number | null } | null = null;
  let frame: number | null = null;
  let warmth: PartOffset = NONE;
  /** The trip signal's highest reading in the last frame, and since when it has held. */
  let highest = 0;
  let heldFrom: number | null = null;

  function enter(next: PowerState, at: number, forMs: number | null): void {
    state = next;
    since = at;
    darkFor = forMs;
    heldFrom = null;
  }

  function advance(ctx: FrameCtx): void {
    const now = ctx.now;
    if (frame === now) return;
    const previous = frame;
    frame = now;

    if (asked) {
      enter(asked.state, now, asked.for);
      asked = null;
    }
    since ??= now;

    if (trip && state === 'on' && previous !== null) {
      if (highest >= tripAt) {
        heldFrom ??= previous;
        if (now - heldFrom >= holdMs) enter('shorted', now, outMs);
      } else {
        heldFrom = null;
      }
    }
    highest = 0;

    if (state === 'shorted' && darkFor !== null && now - since >= darkFor) {
      enter('warming', since + darkFor, null);
    }
    if (state === 'warming' && (!Number.isFinite(ctx.dt) || now - since >= warmup.duration)) {
      enter('on', now, null);
    }
    warmth = state === 'warming' ? { gain: clamp01(warmup.gain(now - since)) } : NONE;
  }

  return {
    piece: {
      duration: 0,
      at(t, part, ctx) {
        advance(ctx);
        if (state === 'shorted') return DARK;
        if (state === 'warming') return warmth;
        if (trip) {
          const reading = trip.on(t, part, ctx);
          if (reading > highest) highest = reading;
        }
        return NONE;
      },
    },
    warm(_t, _part, ctx) {
      advance(ctx);
      return state === 'on' ? 1 : 0;
    },
    get state() {
      return asked?.state ?? state;
    },
    short(options = {}) {
      const ms = options.for;
      asked = { state: 'shorted', for: Number.isFinite(ms) ? Math.max(0, ms as number) : null };
    },
    up() {
      if ((asked?.state ?? state) === 'shorted') asked = { state: 'warming', for: null };
    },
  };
}
