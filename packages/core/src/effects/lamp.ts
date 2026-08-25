import type { FrameCtx } from '../render/lighting.js';

/** Where a lamp is, in the word's own layout space. */
export interface LightPose {
  x: number;
  y: number;
  /** Radians. Reserved for a directional lamp; radial falloff ignores it. */
  direction?: number;
}

/** Null means the lamp has nowhere to be this frame and contributes nothing. */
export type LightSource = (t: number, ctx: FrameCtx) => LightPose | null;

const TAU = Math.PI * 2;

export function fixed(x: number, y: number): LightSource {
  return () => ({ x, y });
}

/**
 * The cursor, already projected into the word. The mapping is the interesting part — the cursor is
 * one source among several rather than the concept.
 */
export function fromPointer(map?: (p: { x: number; y: number }) => LightPose): LightSource {
  return (_t, ctx) => {
    const p = ctx.pointerInWord;
    if (!p) return null;
    return map ? map(p) : { x: p.x, y: p.y };
  };
}

export interface OrbitSpec {
  radius?: number;
  x?: number;
  y?: number;
}

export function orbit(spec: OrbitSpec = {}): LightSource {
  const radius = spec.radius ?? 2;
  const cx = spec.x ?? 0;
  const cy = spec.y ?? 0;
  return (t) => ({ x: cx + Math.cos(t * TAU) * radius, y: cy + Math.sin(t * TAU) * radius });
}

/** Walks a polyline once per pass, by segment count rather than by arc length. */
export function along(points: readonly { x: number; y: number }[]): LightSource {
  if (points.length < 2) throw new Error('klieg: along() needs at least two points');
  const last = points.length - 1;
  return (t) => {
    const u = Math.min(Math.max(t, 0), 1) * last;
    const i = Math.min(Math.floor(u), last - 1);
    const f = u - i;
    const a = points[i] as { x: number; y: number };
    const b = points[i + 1] as { x: number; y: number };
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  };
}
