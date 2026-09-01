import { clamp01 } from '../easing.js';
import type { EffectPiece, FrameCtx, PartOffset } from './types.js';

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
  /** Centre of the circle, in layout space. Both default to 0, the middle of the word. */
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

export interface LampSpec {
  /** Where the light is. Defaults to the cursor. */
  source?: LightSource;
  /** Milliseconds for one pass. Read only by the sources that follow the clock, `orbit` and
   * `along`; `fixed` and `fromPointer` ignore `t`. */
  duration?: number;
  /** How far the light reaches, in em of layout space. */
  radius?: number;
  /** Light at the centre. Falls to zero at `radius`. */
  strength?: number;
  /** The lamp's own colour, multiplied against the look's hue when it resolves. */
  color?: number;
}

const REST: PartOffset = {};

/** Flat at the centre and zero at the edge, so a lamp reads as a pool rather than a cone point. */
function falloff(d: number, radius: number): number {
  if (!Number.isFinite(d) || !Number.isFinite(radius) || radius <= 0) return 0;
  const u = clamp01(d / radius);
  return (1 - u) * (1 - u) * (1 + 2 * u);
}

/**
 * Light on the parts near a position, rather than a change to what they are made of. Under the
 * default `fromPointer` source it contributes nothing until the pointer has been inside the
 * canvas, so an untouched page shows no lamp rather than one parked in the middle of the word.
 */
export function lamp(spec: LampSpec = {}): EffectPiece {
  const source = spec.source ?? fromPointer();
  const duration = spec.duration ?? 4000;
  const radius = spec.radius ?? 0.5;
  const strength = spec.strength ?? 2;
  const color = spec.color ?? 0xffffff;

  return {
    duration,
    at(t, part, ctx) {
      const pose = source(t, ctx);
      if (!pose) return REST;
      const cx = (part.ink.minX + part.ink.maxX) / 2;
      const cy = (part.ink.minY + part.ink.maxY) / 2;
      const amount = strength * falloff(Math.hypot(cx - pose.x, cy - pose.y), radius);
      return amount === 0 ? REST : { light: { color, amount } };
    },
  };
}
