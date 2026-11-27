import { type Channel, kit, mul, sum, vec } from '@msb235/blits';

export type Vec3 = [number, number, number];

/** Where a thing is, how it is turned, and how big: what a letter's pose and a part's share. */
export interface Transform {
  position: Vec3;
  rotation: Vec3;
  scale: number;
}

export interface Pose extends Transform {
  opacity: number;
}

/** A relative contribution. Omitted fields mean "no contribution". */
export interface PoseDelta {
  position?: Vec3;
  rotation?: Vec3;
  scale?: number;
  opacity?: number;
}

export const REST: Pose = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: 1,
  opacity: 1,
};

/**
 * The channel set behind every composed pose. Additive channels rest at 0 and multiplicative ones
 * at 1: scaling `scale` or `opacity` toward 0 would collapse the word rather than remove the
 * contribution.
 */
export const TRANSFORM_KIT = kit<Transform>({
  position: vec(3, sum()),
  rotation: vec(3, sum()),
  scale: mul(),
});

export const POSE_KIT = kit<Pose>({ ...TRANSFORM_KIT, opacity: mul() });

export const POSE_CHANNELS = ['position', 'rotation', 'scale', 'opacity'] as const;

/** Layers deltas onto a pose by the kit's own arithmetic — the fold with every weight at 1. */
export function accumulate(base: Pose, offsets: readonly PoseDelta[]): Pose {
  const out: Record<string, unknown> = {
    position: [...base.position],
    rotation: [...base.rotation],
    scale: base.scale,
    opacity: base.opacity,
  };
  for (const offset of offsets) {
    for (const key of POSE_CHANNELS) {
      const value = (offset as Record<string, unknown>)[key];
      if (value === undefined) continue;
      out[key] = (POSE_KIT[key] as Channel<unknown>).merge(out[key], value);
    }
  }
  return out as unknown as Pose;
}

/**
 * Fade a delta toward its channels' rests. Additive fields go to 0; multiplicative fields go to
 * 1 — scaling them toward 0 would collapse the word instead of removing the contribution.
 */
export function scaleDelta(o: PoseDelta, weight: number): PoseDelta {
  const out: Record<string, unknown> = {};
  for (const key of POSE_CHANNELS) {
    const value = (o as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const channel = POSE_KIT[key] as Channel<unknown>;
    out[key] = channel.scale ? channel.scale(value, weight) : value;
  }
  return out as PoseDelta;
}
