import type { FrameCtx } from '../effects/types.js';

export type LightingName = 'sweep' | 'static' | 'pointer';

export interface LightingMode {
  /** Milliseconds for one full turn of the environment. Zero holds it still. */
  periodMs: number;
  /** Aims the environment at the pointer rather than turning it on the clock. */
  tracksPointer?: boolean;
}

export const LIGHTING: Record<LightingName, LightingMode> = {
  sweep: { periodMs: 3400 },
  static: { periodMs: 0 },
  pointer: { periodMs: 0, tracksPointer: true },
};

const TAU = Math.PI * 2;

/** Effect-relative: absolute clock time would start every effect at an arbitrary angle. */
export function envRotationAt(name: LightingName, elapsed: number): number {
  const { periodMs } = LIGHTING[name];
  return periodMs > 0 ? (elapsed / periodMs) * TAU : 0;
}

/** How far the environment swings between opposite edges of the viewport, on each axis. */
const YAW_RANGE = Math.PI / 2;
/** Shallower than yaw: tipping a studio far in x swings its floor into frame and reads as wrong. */
const PITCH_RANGE = Math.PI / 9;
/** Milliseconds for the highlight to cover ~63% of the way to a new pointer position. */
const FOLLOW_MS = 90;

/**
 * Aims the environment at the pointer. One `pointermove` listener covers mouse, pen and touch
 * alike, and it neither captures nor cancels, so a page that is itself dragging keeps the gesture
 * — on a phone one finger turns the type and rakes the light together.
 *
 * The target starts at the static pose, so a page nobody has touched — a fresh load, an iframe
 * scrolled past — lights exactly as `static` does rather than aiming somewhere arbitrary.
 */
export class PointerLight {
  yaw = 0;
  pitch = 0;
  private targetYaw = 0;
  private targetPitch = 0;
  private detach: (() => void) | null = null;

  /** Idempotent: concurrent effects share the one listener. */
  attach(): void {
    if (this.detach) return;
    const onMove = (event: PointerEvent) => this.aimAt(event.clientX, event.clientY);
    globalThis.addEventListener('pointermove', onMove, { passive: true });
    this.detach = () => globalThis.removeEventListener('pointermove', onMove);
  }

  release(): void {
    this.detach?.();
    this.detach = null;
  }

  aimAt(x: number, y: number): void {
    const width = Math.max(1, globalThis.innerWidth || 1);
    const height = Math.max(1, globalThis.innerHeight || 1);
    this.targetYaw = ((x / width) * 2 - 1) * YAW_RANGE;
    this.targetPitch = ((y / height) * 2 - 1) * PITCH_RANGE;
  }

  /**
   * Eases one frame toward the pointer. Exponential in elapsed time rather than a fixed fraction
   * per frame, so the highlight travels at the same speed on a 120Hz laptop and a 60Hz phone.
   */
  step(dtMs: number): void {
    const k = 1 - Math.exp(-Math.max(0, dtMs) / FOLLOW_MS);
    this.yaw += (this.targetYaw - this.yaw) * k;
    this.pitch += (this.targetPitch - this.pitch) * k;
  }
}

export interface EnvOffset {
  yaw?: number;
  pitch?: number;
}

export interface EnvPiece {
  /** Milliseconds for one pass. Zero holds still. */
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

export function sweep(spec: { periodMs?: number } = {}): EnvPiece {
  const periodMs = spec.periodMs ?? LIGHTING.sweep.periodMs;
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
