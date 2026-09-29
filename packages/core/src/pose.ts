import { type Channel, mul, kit, sum, vec } from 'blits';

export type Vec3 = [number, number, number];

export interface Pose {
  position: Vec3;
  rotation: Vec3;
  scale: number;
  opacity: number;
}

/** A relative contribution. Omitted fields mean "no contribution". */
export interface PoseOffset {
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
export const POSE_RIG = kit<Pose>({
  position: vec(3, sum()) as unknown as Channel<Vec3>,
  rotation: vec(3, sum()) as unknown as Channel<Vec3>,
  scale: mul(),
  opacity: mul(),
});

export const POSE_CHANNELS = ['position', 'rotation', 'scale', 'opacity'] as const;

/** Layers offsets onto a pose by the rig's own arithmetic — the fold with every weight at 1. */
export function accumulate(base: Pose, offsets: readonly PoseOffset[]): Pose {
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
      out[key] = (POSE_RIG[key] as Channel<unknown>).merge(out[key], value);
    }
  }
  return out as unknown as Pose;
}

/**
 * Fade an offset toward its channels' rests. Additive fields go to 0; multiplicative fields go to
 * 1 — scaling them toward 0 would collapse the word instead of removing the contribution.
 */
export function scaleOffset(o: PoseOffset, weight: number): PoseOffset {
  const out: Record<string, unknown> = {};
  for (const key of POSE_CHANNELS) {
    const value = (o as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const channel = POSE_RIG[key] as Channel<unknown>;
    out[key] = channel.scale ? channel.scale(value, weight) : value;
  }
  return out as PoseOffset;
}
