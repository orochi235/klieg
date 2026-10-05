import { type Channel, kit, lag, type Mix, mix, patch, sum } from '@msb235/blits';
import { startAt } from '../effects/signal.js';
import { type Host, relay, type Setting } from '../effects/types.js';
import { type Layered, layersOf } from '../motion/types.js';

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

export interface EnvDelta {
  yaw?: number;
  pitch?: number;
}

export interface EnvPatch {
  /** Milliseconds one pass lasts, and the patch loops. Zero means aperiodic — `phase` is always 0 —
   * not that the patch holds still: `track` reports 0 and moves. */
  period: number;
  /** `phase` is 0..1 across one period. */
  at(phase: number, setting: Setting): EnvDelta;
}

/** Hands back the patch it is given, typed, as `effect` does for an effect patch. */
export function lighting(patch: EnvPatch): EnvPatch {
  return patch;
}

/** Everything `mergeEnv` resolved. Both axes rest at 0. */
export interface EnvPose {
  yaw: number;
  pitch: number;
}

/** Both axes add, matching the pose kit: layering two patches must show both. */
export const ENV_KIT = kit<EnvPose>({ yaw: sum(), pitch: sum() });

const ENV_CHANNELS = ['yaw', 'pitch'] as const;

/** Layers env deltas by the kit's own arithmetic — the fold with every weight at 1. */
export function mergeEnv(offsets: readonly EnvDelta[]): EnvPose {
  const out: EnvPose = { yaw: 0, pitch: 0 };
  for (const o of offsets) {
    for (const key of ENV_CHANNELS) {
      const value = o[key];
      if (value !== undefined) out[key] = (ENV_KIT[key] as Channel<number>).merge(out[key], value);
    }
  }
  return out;
}

/** A sign has one environment, so the mix over it has one subject and this is it. */
const SIGN = Object.freeze({});

/** Stands in until the first frame reports one. Nothing samples a patch before then. */
const NO_HOST: Host = { pointer: null, pointerInWord: null, now: 0 };

/**
 * The lighting system: one voice per env patch over the environment kit, each on its own period
 * rather than a shared one, and no subject dimension to speak of.
 */
export class EnvFrame {
  private readonly mix: Mix<object, EnvPose, Host>;
  private frame: Host = NO_HOST;
  private reduced = false;

  constructor(patches: readonly EnvPatch[]) {
    this.mix = mix<object, EnvPose, Host>(ENV_KIT, {
      host: relay(() => this.frame),
      reduce: () => this.reduced,
    });
    for (const env of patches) {
      this.mix.cue({
        patch: patch<object, EnvPose, void, Host>(
          env.period,
          (phase, _sign, setting) => env.at(phase, setting),
          { writes: ENV_CHANNELS },
        ),
      });
    }
  }

  at(elapsed: number, host: Host, reduced = false): EnvPose {
    this.frame = host;
    this.reduced = reduced;
    this.mix.sync(elapsed);
    return this.mix.probe(SIGN);
  }
}

export interface SweepSpec {
  /** Milliseconds for one full turn of the environment. Defaults to 3400. */
  periodMs?: number;
}

/**
 * Turns the environment on the clock. `phase` is effect-relative: absolute clock time would start
 * every effect at an arbitrary angle.
 */
export function sweep(spec: SweepSpec = {}): EnvPatch {
  return { period: spec.periodMs ?? SWEEP_PERIOD_MS, at: (phase) => ({ yaw: phase * TAU }) };
}

export function still(): EnvPatch {
  return { period: 0, at: () => ({}) };
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
 * Each axis follows the pointer through blits' `lag`, starting from rest, and holds where it was
 * while the pointer is away. The mix keeps that state per voice, so one `track` can serve any
 * number of fires, each starting from rest.
 */
export function track(spec: TrackSpec = {}): EnvPatch {
  const yawRange = spec.yawRange ?? YAW_RANGE;
  const pitchRange = spec.pitchRange ?? PITCH_RANGE;
  const followMs = spec.followMs ?? FOLLOW_MS;
  /** Where the pointer last aimed one axis, held while it is away. */
  const aim = (axis: 'x' | 'y', range: number) => {
    const read = (_sign: object, setting: Setting): number => {
      const held = setting.keep(read, () => ({ value: 0 }));
      const pointer = setting.host.pointer;
      if (pointer) held.value = pointer[axis] * range;
      return held.value;
    };
    const aimed = Object.assign(read, { input: true });
    return lag(followMs > 0 ? startAt(0, aimed) : aimed, {
      riseMs: followMs,
      fallMs: followMs,
      floor: 0,
    });
  };
  const yaw = aim('x', yawRange);
  const pitch = aim('y', pitchRange);
  return {
    period: 0,
    at: (_phase, setting) => ({ yaw: yaw(SIGN, setting), pitch: pitch(SIGN, setting) }),
  };
}

export const ENV_PATCHES = {
  sweep,
  static: still,
  pointer: track,
} satisfies Record<LightingName, () => EnvPatch>;

/** A built-in name, your own env patch, or several layered — each running on its own period,
 * unlike a motion slot, whose members share one. */
export type LightingSlot = LightingName | EnvPatch | Layered<LightingName | EnvPatch>;

export function resolveLighting(slot: LightingSlot): EnvPatch[] {
  const one = (s: LightingName | EnvPatch): EnvPatch =>
    typeof s === 'string' ? ENV_PATCHES[s]() : s;
  return layersOf(slot).map(one);
}
