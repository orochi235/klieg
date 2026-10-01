import { type Channel, type Mix, mix, patch, kit, sum } from '@msb235/blits';
import type { FrameCtx } from '../effects/types.js';

export type LightingName = 'sweep' | 'static' | 'pointer';

const TAU = Math.PI * 2;

/** Milliseconds for one full turn of the environment. */
const SWEEP_PERIOD_MS = 3400;

/** How far the environment swings between opposite edges of the canvas box, on each axis. */
const YAW_RANGE = Math.PI / 2;
/** Shallower than yaw: tipping a studio far in x swings its floor into frame and reads as wrong. */
const PITCH_RANGE = Math.PI / 9;
/** Milliseconds for the highlight to cover ~63% of the way to a new pointer position. */
const FOLLOW_MS = 90;

export interface EnvOffset {
  yaw?: number;
  pitch?: number;
}

export interface EnvPiece {
  /** Milliseconds for one pass. Zero means aperiodic — `t` is always 0 — not that the piece
   * holds still: `track` reports 0 and moves. */
  duration: number;
  /** `t` is normalized 0..1 within this pass. */
  env(t: number, ctx: FrameCtx): EnvOffset;
}

/** Everything `mergeEnv` resolved. Both axes rest at 0. */
export interface ResolvedEnv {
  yaw: number;
  pitch: number;
}

/** Both axes add, matching the pose rig: layering two pieces must show both. */
export const ENV_RIG = kit<ResolvedEnv>({ yaw: sum(), pitch: sum() });

const ENV_CHANNELS = ['yaw', 'pitch'] as const;

/** Layers env offsets by the rig's own arithmetic — the fold with every weight at 1. */
export function mergeEnv(offsets: readonly EnvOffset[]): ResolvedEnv {
  const out: ResolvedEnv = { yaw: 0, pitch: 0 };
  for (const o of offsets) {
    for (const key of ENV_CHANNELS) {
      const value = o[key];
      if (value !== undefined) out[key] = (ENV_RIG[key] as Channel<number>).merge(out[key], value);
    }
  }
  return out;
}

/** A sign has one environment, so the mix over it has one subject and this is it. */
const SIGN = Object.freeze({});

/** Stands in until the first frame reports one. Nothing samples a piece before then. */
const NO_FRAME: FrameCtx = { pointer: null, pointerInWord: null, dt: 0, now: 0 };

/**
 * The lighting system: one voice per env piece over the environment rig, each on its own period
 * rather than a shared one, and no subject dimension to speak of.
 */
export class EnvFrame {
  private readonly mix: Mix<object, ResolvedEnv>;
  /** This frame's context, which a piece still reads as its second argument. */
  private ctx: FrameCtx = NO_FRAME;

  constructor(pieces: readonly EnvPiece[]) {
    this.mix = mix<object, ResolvedEnv>(ENV_RIG, {});
    for (const piece of pieces) {
      this.mix.cue({
        patch: patch<object, ResolvedEnv>(piece.duration, (phase) => piece.env(phase, this.ctx), {
          writes: ENV_CHANNELS,
        }),
      });
    }
  }

  at(elapsed: number, ctx: FrameCtx): ResolvedEnv {
    this.ctx = ctx;
    this.mix.sync(elapsed);
    return this.mix.probe(SIGN);
  }
}

export interface SweepSpec {
  /** Milliseconds for one full turn of the environment. Defaults to 3400. */
  periodMs?: number;
}

/**
 * Turns the environment on the clock. `t` is effect-relative: absolute clock time would start
 * every effect at an arbitrary angle.
 */
export function sweep(spec: SweepSpec = {}): EnvPiece {
  const periodMs = spec.periodMs ?? SWEEP_PERIOD_MS;
  return { duration: periodMs, env: (t) => ({ yaw: t * TAU }) };
}

export function still(): EnvPiece {
  return { duration: 0, env: () => ({}) };
}

export interface TrackSpec {
  /** Radians the environment swings between opposite edges of the canvas. */
  yawRange?: number;
  /** Radians on the other axis. Shallower than yaw: tipping the studio far swings its floor into frame. */
  pitchRange?: number;
  /** Milliseconds to cover ~63% of the way to a new pointer position. Zero snaps. */
  followMs?: number;
}

/**
 * Aims the environment at the pointer. Not a light anywhere: it turns the same scene-wide knob
 * `sweep` turns, from position instead of time. For a cursor that lights the letter under it,
 * see `lamp`.
 *
 * Each call builds a piece that carries its own eased angle, so one belongs to one fire: sharing
 * it steps it once per concurrent effect, and reusing it starts the next fire from the last
 * one's angle rather than rest.
 */
export function track(spec: TrackSpec = {}): EnvPiece {
  const yawRange = spec.yawRange ?? YAW_RANGE;
  const pitchRange = spec.pitchRange ?? PITCH_RANGE;
  const followMs = spec.followMs ?? FOLLOW_MS;
  let yaw = 0;
  let pitch = 0;
  return {
    duration: 0,
    env(_t, ctx) {
      if (ctx.pointer) {
        const k = followMs > 0 ? 1 - Math.exp(-Math.max(0, ctx.dt) / followMs) : 1;
        yaw += (ctx.pointer.x * yawRange - yaw) * k;
        pitch += (ctx.pointer.y * pitchRange - pitch) * k;
      }
      return { yaw, pitch };
    },
  };
}

export const ENV_PIECES = {
  sweep,
  static: still,
  pointer: track,
} satisfies Record<LightingName, () => EnvPiece>;

/** A built-in name, your own env piece, or several layered — each running on its own period,
 * unlike a motion slot, whose members share one. */
export type LightingSlot = LightingName | EnvPiece | (LightingName | EnvPiece)[];

export function resolveLighting(slot: LightingSlot): EnvPiece[] {
  const one = (s: LightingName | EnvPiece): EnvPiece =>
    typeof s === 'string' ? ENV_PIECES[s]() : s;
  return Array.isArray(slot) ? slot.map(one) : [one(slot)];
}
