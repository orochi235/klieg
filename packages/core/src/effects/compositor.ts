import type { Vec3 } from '../pose.js';
import type { PartOffset, ResolvedOffset } from './types.js';

/** No contribution: multiplicative channels at 1, additive at 0, colour left to the part. */
export const REST_OFFSET: ResolvedOffset = {
  gain: 1,
  dark: 0,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: 1,
  crawl: 0,
  light: [0, 0, 0],
};

function rgb(hex: number): Vec3 {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

/**
 * Folds layered contributions into one. Multiplicative channels fade toward 1 and additive ones
 * toward 0, matching the pose compositor — scaling a multiplicative channel toward 0 would remove
 * the part rather than remove the contribution.
 */
export function mergeOffsets(offsets: readonly PartOffset[]): ResolvedOffset {
  const position: Vec3 = [0, 0, 0];
  const rotation: Vec3 = [0, 0, 0];
  const light: Vec3 = [0, 0, 0];
  let gain = 1;
  let scale = 1;
  let dark = 0;
  let crawl = 0;
  let color: number | undefined;

  for (const o of offsets) {
    // Vec3 is a fixed 3-tuple, so indices 0..2 are always populated; the `as number`
    // casts are safe despite noUncheckedIndexedAccess widening variable-index reads to T | undefined.
    if (o.position) {
      for (let i = 0; i < 3; i++) {
        position[i] = (position[i] as number) + (o.position[i] as number);
      }
    }
    if (o.rotation) {
      for (let i = 0; i < 3; i++) {
        rotation[i] = (rotation[i] as number) + (o.rotation[i] as number);
      }
    }
    if (o.gain !== undefined) gain *= o.gain;
    if (o.scale !== undefined) scale *= o.scale;
    if (o.crawl !== undefined) crawl += o.crawl;
    // Strongest wins rather than compounding: two layers each half-dead should not read as dead.
    if (o.dark !== undefined) dark = Math.max(dark, o.dark);
    if (o.color !== undefined) color = o.color;
    if (o.light?.amount) {
      const c = rgb(o.light.color);
      for (let i = 0; i < 3; i++) {
        light[i] = (light[i] as number) + (c[i] as number) * o.light.amount;
      }
    }
  }

  return { gain, color, dark, position, rotation, scale, crawl, light };
}

/** Whether a piece is contributing nothing on this part — every channel it wrote at its identity. */
export function isRest(o: PartOffset): boolean {
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
