import { type Setting as BlitsSetting, type Signal as BlitsSignal, slew } from '@msb235/blits';
import { clamp01 } from '../easing.js';
import { falloff, fromPointer, inkCenter, type LightSource } from './source.js';
import type { Signal } from './types.js';

export type { Signal } from './types.js';

export interface NearSpec {
  /** How far influence reaches, in em of layout space. Default 0.5, as `LampSpec.radius`. */
  radius?: number;
  /** Where the signal is measured from. Defaults to the cursor. */
  source?: LightSource;
  /** Milliseconds for one pass of `source`, as `LampSpec.period`. Read only by the sources that
   * follow the clock, `orbit` and `along`. Default 4000. */
  period?: number;
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
  const period = spec.period ?? 4000;
  return (part, setting) => {
    const pose = source(period > 0 ? (setting.elapsed % period) / period : 0, setting);
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
    input: { value: true },
    set: { value: (v: number) => (value = clean(v)) },
    value: { get: () => value },
  });
  return signal;
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
 * How long a part has been near something, rather than how near it is now: blits' `slew` over
 * `near()`, so a cursor resting on a letter builds it up and one passing over barely registers. It
 * never climbs past the input, so a cursor at the edge of `near`'s reach fills a part only as far
 * as `near` reads there.
 *
 * A part it has not seen starts empty, where a bare `slew` starts at its input. The mix keeps its
 * state per voice and part. Under reduced motion it snaps to its input instead of climbing.
 */
export function dwell(spec: DwellSpec = {}): Signal {
  const of = spec.of ?? near();
  const clamped: Signal = (part, setting) => {
    const input = of(part, setting);
    return Number.isFinite(input) ? clamp01(input) : 0;
  };
  const input = of.input ? Object.assign(clamped, { input: true }) : clamped;
  return slew(startAt(0, input), { riseMs: spec.riseMs ?? 1500, fallMs: spec.fallMs ?? 600 });
}

/**
 * Reads `value` the first frame a subject is seen, and `of` after, unless motion is reduced. A
 * `slew` or `lag` starts at its input on first sight; fed this, it starts at `value` and moves.
 */
export function startAt<I>(value: number, of: BlitsSignal<I>): BlitsSignal<I> {
  const read = (subject: I, setting: BlitsSetting): number => {
    const input = of(subject, setting);
    const first = setting.keep(read, () => ({ at: setting.timestamp }));
    return first.at === setting.timestamp && Number.isFinite(setting.dt) ? value : input;
  };
  return of.input ? Object.assign(read, { input: true }) : read;
}
