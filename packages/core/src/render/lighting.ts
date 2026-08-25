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
