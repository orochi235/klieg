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

/** Additive, matching the pose compositor: layering two pieces must show both. */
export function mergeEnv(offsets: readonly EnvOffset[]): ResolvedEnv {
  let yaw = 0;
  let pitch = 0;
  for (const o of offsets) {
    yaw += o.yaw ?? 0;
    pitch += o.pitch ?? 0;
  }
  return { yaw, pitch };
}

/**
 * Turns the environment on the clock. `t` is effect-relative: absolute clock time would start
 * every effect at an arbitrary angle.
 */
export function sweep(
  spec: {
    /** Milliseconds for one full turn of the environment. Defaults to 3400. */
    periodMs?: number;
  } = {},
): EnvPiece {
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
