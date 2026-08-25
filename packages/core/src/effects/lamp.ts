import { clamp01 } from '../easing.js';
import type { EffectPiece, FrameCtx, PartOffset } from './types.js';

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

/** The cursor, already projected into the word. */
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

export interface LampSpec {
  /** Where the light is. Defaults to the cursor. */
  source?: LightSource;
  /** Milliseconds for one pass of a time-driven source. */
  duration?: number;
  /** How far the light reaches, in em of layout space. */
  radius?: number;
  /** Light at the centre. Falls to zero at `radius`. */
  strength?: number;
  /** The lamp's own colour, multiplied against the look's hue when it resolves. */
  color?: number;
}

const REST: PartOffset = {};
/** Stands in for a caller that hasn't wired `FrameCtx` through yet — no pointer, no elapsed time. */
const NO_CTX: FrameCtx = { pointer: null, pointerInWord: null, dt: 0 };

/** Flat at the centre and zero at the edge, so a lamp reads as a pool rather than a cone point. */
function falloff(d: number, radius: number): number {
  if (radius <= 0) return 0;
  const u = clamp01(d / radius);
  return (1 - u) * (1 - u) * (1 + 2 * u);
}

export function lamp(spec: LampSpec = {}): EffectPiece {
  const source = spec.source ?? fromPointer();
  const duration = spec.duration ?? 4000;
  const radius = spec.radius ?? 0.5;
  const strength = spec.strength ?? 2;
  const color = spec.color ?? 0xffffff;

  return {
    duration,
    at(t, part, ctx = NO_CTX) {
      const pose = source(t, ctx);
      if (!pose) return REST;
      const amount = strength * falloff(Math.hypot(part.x - pose.x, part.y - pose.y), radius);
      return { light: { color, amount } };
    },
  };
}
