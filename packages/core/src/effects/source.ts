import { clamp01 } from '../easing.js';
import type { FrameCtx } from './types.js';

/** Where a lamp is, in the word's own layout space. */
export interface LightPose {
  x: number;
  y: number;
}

/** Null means the lamp has nowhere to be this frame and contributes nothing. */
export type LightSource = (t: number, ctx: FrameCtx) => LightPose | null;

const TAU = Math.PI * 2;

export function fixed(x: number, y: number): LightSource {
  return () => ({ x, y });
}

/** The cursor, exactly as `FrameCtx.pointerInWord` places it. */
export function fromPointer(map?: (p: { x: number; y: number }) => LightPose): LightSource {
  return (_t, ctx) => {
    const p = ctx.pointerInWord;
    if (!p) return null;
    return map ? map(p) : { x: p.x, y: p.y };
  };
}

export interface OrbitSpec {
  /** Em of layout space. Defaults to 0.3, six tenths of a lamp's 0.5 em default reach: every part
   * of a single-line sign sits on the baseline, so a circle as wide as the reach is already dark
   * at the top and bottom of its pass. A taller or wider sign wants a wider circle. */
  radius?: number;
  /** Center of the circle, in layout space. Both default to 0, the middle of the word. */
  x?: number;
  y?: number;
}

export function orbit(spec: OrbitSpec = {}): LightSource {
  const radius = spec.radius ?? 0.3;
  const cx = spec.x ?? 0;
  const cy = spec.y ?? 0;
  return (t) => ({ x: cx + Math.cos(t * TAU) * radius, y: cy + Math.sin(t * TAU) * radius });
}

/** Walks a polyline once per pass, by segment count rather than by arc length: every segment
 * gets the same share of the pass, whatever its length. Throws on fewer than two points. */
export function along(points: readonly { x: number; y: number }[]): LightSource {
  if (points.length < 2) throw new Error('klieg: along() needs at least two points');
  const pts = points.slice();
  const last = pts.length - 1;
  return (t) => {
    const u = clamp01(t) * last;
    const i = Math.min(Math.floor(u), last - 1);
    const f = u - i;
    const a = pts[i] as { x: number; y: number };
    const b = pts[i + 1] as { x: number; y: number };
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  };
}

/** Flat at the center and zero at the edge, so a lamp reads as a pool rather than a cone point. */
export function falloff(d: number, radius: number): number {
  if (!Number.isFinite(d) || !Number.isFinite(radius) || radius <= 0) return 0;
  const u = clamp01(d / radius);
  return (1 - u) * (1 - u) * (1 + 2 * u);
}

/** The center of a part's drawn bounds, which collapses to its origin for a part drawing nothing. */
export function inkCenter(ink: { minX: number; maxX: number; minY: number; maxY: number }): {
  x: number;
  y: number;
} {
  return { x: (ink.minX + ink.maxX) / 2, y: (ink.minY + ink.maxY) / 2 };
}
