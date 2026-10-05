import type { Channel } from '@msb235/blits';
import { PART_KIT } from './rig.js';
import type { EffectPatch, PartDelta, PartInfo, Setting, Signal } from './types.js';

export interface StopsSpec {
  /** How many levels the patch is built at. Default 8, minimum 2. */
  stops?: number;
}

const NONE: PartDelta = {};
const STOPS = 8;

/** A signal's reading as a weight: a non-finite one counts as nothing. */
export function weightOf(by: Signal): Signal {
  const read: Signal = (part, setting) => {
    const k = by(part, setting);
    return Number.isFinite(k) ? k : 0;
  };
  return by.input ? Object.assign(read, { input: true }) : read;
}

/** A signal's reading as a place among stops, held to 0..1. */
export function placeOf(by: Signal): Signal {
  const read: Signal = (part, setting) => {
    const k = by(part, setting);
    return Number.isFinite(k) ? Math.min(1, Math.max(0, k)) : 0;
  };
  return by.input ? Object.assign(read, { input: true }) : read;
}

/**
 * A delta at weight `k`, by the kit's own `scale`: what the mix does to a voice at that weight.
 * `color` has no rest to scale toward, so it passes whole above zero and goes at `k <= 0`, as the
 * part mix's band does.
 */
export function weigh(o: PartDelta, k: number): PartDelta {
  if (!(k > 0)) return NONE;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(o) as (keyof PartDelta)[]) {
    const value = o[key];
    if (value === undefined) continue;
    if (key === 'light') {
      const light = value as NonNullable<PartDelta['light']>;
      out.light = { color: light.color, amount: light.amount * k };
      continue;
    }
    const channel = PART_KIT[key] as Channel<unknown>;
    out[key] = channel.scale ? channel.scale(value, k) : value;
  }
  return out as PartDelta;
}

/**
 * Crossfades two neighboring stops by their shares, as `mix.blend`'s locus does: each channel is
 * lerped among the stops that write it, by its share of their weight. Two lamps of different
 * colors fold as premultiplied light, which comes back as the nearest color and amount.
 */
function between(a: PartDelta, b: PartDelta, u: number): PartDelta {
  const out: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof PartDelta>) {
    const x = a[key];
    const y = b[key];
    if (x === undefined || y === undefined) {
      out[key] = x ?? y;
      continue;
    }
    if (key === 'light') out.light = mixLight(x as Light, y as Light, u);
    else out[key] = (PART_KIT[key] as Channel<unknown>).lerp(x, y, u);
  }
  return out as PartDelta;
}

type Light = NonNullable<PartDelta['light']>;

function mixLight(a: Light, b: Light, u: number): Light {
  const amount = a.amount + (b.amount - a.amount) * u;
  if (a.color === b.color) return { color: a.color, amount };
  const rgb = [16, 8, 0].map(
    (s) =>
      (((a.color >> s) & 0xff) / 255) * a.amount * (1 - u) +
      (((b.color >> s) & 0xff) / 255) * b.amount * u,
  );
  const peak = Math.max(...rgb);
  if (!(peak > 0)) return { color: a.color, amount: 0 };
  const [r, g, bl] = rgb.map((c) => Math.round((c / peak) * 255)) as [number, number, number];
  return { color: (r << 16) | (g << 8) | bl, amount: peak };
}

/**
 * Makes a patch a function of a signal as well as of time.
 *
 * Given a **patch**, the signal is its voice's weight: the mix scales what the patch emits toward
 * rest, continuously, on the channels that have a rest to scale toward.
 *
 * Given a **factory**, the patch is built once per stop at construction and the mix crossfades the
 * two stops either side of the signal (`mix.blend`). This is the mode that reaches a knob decided
 * inside the patch — `flicker`'s `unrest` is a probability tested before anything is emitted, so no
 * amount of scaling downstream can reach it. Every stop shares one pass, so they must agree on
 * their period.
 *
 * Asked directly, as a wrapper such as `roving` asks its inner, the patch weighs or crossfades
 * itself by the same arithmetic.
 */
export function hinge(
  signal: Signal,
  make: (k: number) => EffectPatch,
  spec?: StopsSpec,
): EffectPatch;
export function hinge(signal: Signal, patch: EffectPatch): EffectPatch;
export function hinge(
  signal: Signal,
  inner: ((k: number) => EffectPatch) | EffectPatch,
  spec: StopsSpec = {},
): EffectPatch {
  if (typeof inner === 'function') {
    const count = Math.max(2, Math.round(spec.stops ?? STOPS));
    const last = count - 1;
    const stops: EffectPatch[] = [];
    for (let i = 0; i < count; i++) stops.push(inner(i / last));

    const period = (stops[0] as EffectPatch).period;
    for (let i = 1; i < count; i++) {
      const other = (stops[i] as EffectPatch).period;
      if (other !== period) {
        throw new Error(
          `klieg: hinge() stops disagree on period — stop 0 is ${period}ms and stop ${i} is ` +
            `${other}ms. Vary a knob that leaves the pass alone, such as flicker's unrest or ` +
            'depth rather than its spell or calm.',
        );
      }
    }

    const place = placeOf(signal);
    return {
      period,
      hinged: { by: place, stops },
      at(phase: number, part: PartInfo, setting: Setting) {
        const at = place(part, setting) * last;
        const i = Math.min(last - 1, Math.floor(at));
        const u = at - i;
        if (u === 0) return (stops[i] as EffectPatch).at(phase, part, setting);
        if (u === 1) return (stops[i + 1] as EffectPatch).at(phase, part, setting);
        const a = (stops[i] as EffectPatch).at(phase, part, setting);
        return between(a, (stops[i + 1] as EffectPatch).at(phase, part, setting), u);
      },
    };
  }

  const weight = weightOf(signal);
  return {
    period: inner.period,
    hinged: { by: weight, patch: inner },
    at(phase, part, setting) {
      return weigh(inner.at(phase, part, setting), weight(part, setting));
    },
  };
}
