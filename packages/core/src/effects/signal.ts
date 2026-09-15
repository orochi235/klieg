import { clamp01 } from '../easing.js';
import { falloff, fromPointer, inkCenter, type LightSource } from './source.js';
import type { FrameCtx, PartInfo } from './types.js';

/**
 * A scalar a piece can hinge on: 0..1, resolved per part, per frame. `t` is the hinging piece's
 * own normalized pass, so a signal reading it follows that piece's clock rather than a private one.
 */
export type Signal = (t: number, part: PartInfo, ctx: FrameCtx) => number;

export interface NearSpec {
  /** How far influence reaches, in em of layout space. Default 0.5, as `LampSpec.radius`. */
  radius?: number;
  /** Where the signal is measured from. Defaults to the cursor. */
  source?: LightSource;
}

/**
 * How near a part is to a moving point, on the same curve and in the same space a `lamp` lights
 * with: 1 on top of the source, 0 at `radius` and beyond. Distance is measured to the part's ink
 * rather than to its letter origin, because every part of a single line shares one origin y.
 *
 * A source with nowhere to be reads as 0 rather than as 1, so under the default `fromPointer` an
 * untouched page shows whatever the author wrote for `k = 0` instead of a sign already reacting to
 * a cursor that has never been inside it.
 */
export function near(spec: NearSpec = {}): Signal {
  const source = spec.source ?? fromPointer();
  const radius = spec.radius ?? 0.5;
  return (t, part, ctx) => {
    const pose = source(t, ctx);
    if (!pose) return 0;
    const c = inkCenter(part.ink);
    return falloff(Math.hypot(c.x - pose.x, c.y - pose.y), radius);
  };
}

/** A sign-wide signal your code sets. */
export interface Level extends Signal {
  set(value: number): void;
  readonly value: number;
}

/** One value every part reads, set from outside a frame — a hover intensity, a volume. Clamped to
 * 0..1, and a non-finite value reads as 0. */
export function level(initial = 0): Level {
  const clean = (v: number) => (Number.isFinite(v) ? clamp01(v) : 0);
  let value = clean(initial);
  const signal = (() => value) as unknown as Level;
  Object.defineProperties(signal, {
    set: { value: (v: number) => (value = clean(v)) },
    value: { get: () => value },
  });
  return signal;
}

/** The highest of several signals, per part — a hover's slow build with a spark's spike on top. */
export function peak(...signals: Signal[]): Signal {
  return (t, part, ctx) => {
    let k = 0;
    for (const signal of signals) {
      const v = signal(t, part, ctx);
      if (v > k) k = v;
    }
    return k;
  };
}

export interface DwellSpec {
  /** What accumulates. Defaults to `near()`, so a part fills while the cursor rests on it. */
  of?: Signal;
  /** Milliseconds to climb from 0 to 1 while the input holds at 1. Default 1500; 0 snaps. */
  riseMs?: number;
  /** Milliseconds to drain from 1 to 0 once the input is gone. Default 600; 0 snaps. */
  fallMs?: number;
}

/**
 * How long a part has been near something, rather than how near it is now: climbs toward its
 * input at `riseMs` per unit and drains at `fallMs`, so a cursor resting on a letter builds it up
 * and one passing over barely registers. It never climbs past the input, so a cursor at the edge
 * of `near`'s reach fills a part only as far as `near` reads there.
 *
 * State is kept per part and advances once per `FrameCtx.now`: the first call in a frame reads the
 * input and steps, and every later one in that frame returns the same value, whatever its `t`. A
 * part it has not seen starts empty. Under reduced motion it snaps to its input instead of
 * climbing. One `dwell` is safe to share between words and fires, since no two draw the same part.
 */
export function dwell(spec: DwellSpec = {}): Signal {
  const of = spec.of ?? near();
  const riseMs = spec.riseMs ?? 1500;
  const fallMs = spec.fallMs ?? 600;
  const held = new WeakMap<PartInfo, { now: number; k: number }>();
  return (t, part, ctx) => {
    const last = held.get(part);
    if (last && last.now === ctx.now) return last.k;
    const input = of(t, part, ctx);
    const target = Number.isFinite(input) ? clamp01(input) : 0;
    if (!last) {
      const k = Number.isFinite(ctx.dt) ? 0 : target;
      held.set(part, { now: ctx.now, k });
      return k;
    }
    const ms = Math.max(0, ctx.now - last.now);
    last.k = Number.isFinite(ctx.dt) ? toward(last.k, target, ms, riseMs, fallMs) : target;
    last.now = ctx.now;
    return last.k;
  };
}

function toward(k: number, target: number, ms: number, riseMs: number, fallMs: number): number {
  const rising = target > k;
  const per = rising ? riseMs : fallMs;
  if (per <= 0) return target;
  return rising ? Math.min(target, k + ms / per) : Math.max(target, k - ms / per);
}
