import type { Channel } from '@msb235/blits';
import { asDelta, PART_CHANNELS, PART_KIT } from './rig.js';
import type { PartDelta, PartPose } from './types.js';

/** No contribution: multiplicative channels at 1, additive at 0, color left to the part. */
export const PART_REST: PartPose = {
  gain: 1,
  dark: 0,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: 1,
  crawl: 0,
  light: [0, 0, 0],
};

/**
 * Folds layered contributions into one, by the same channel arithmetic the mix uses — this is the
 * fold with every weight at 1, which is what a layered effect is.
 */
export function mergeDeltas(offsets: readonly PartDelta[]): PartPose {
  const out: Record<string, unknown> = {};
  for (const key of PART_CHANNELS) {
    const rest = (PART_KIT[key] as Channel<unknown>).rest;
    if (rest !== undefined) out[key] = Array.isArray(rest) ? [...rest] : rest;
  }
  for (const offset of offsets) {
    const delta = asDelta(offset) as Record<string, unknown>;
    for (const key of Object.keys(delta)) {
      const value = delta[key];
      if (value === undefined) continue;
      const channel = PART_KIT[key as keyof PartPose] as Channel<unknown>;
      out[key] = out[key] === undefined ? value : channel.merge(out[key], value);
    }
  }
  return out as unknown as PartPose;
}

/** Whether a patch is contributing nothing on this part — every channel it wrote at its identity. */
export function isRest(o: PartDelta): boolean {
  if (o.gain !== undefined && o.gain !== 1) return false;
  if (o.scale !== undefined && o.scale !== 1) return false;
  if (o.dark) return false;
  if (o.crawl) return false;
  if (o.color !== undefined) return false;
  if (o.position?.some((n) => n !== 0)) return false;
  if (o.rotation?.some((n) => n !== 0)) return false;
  if (o.light?.amount) return false;
  return true;
}
