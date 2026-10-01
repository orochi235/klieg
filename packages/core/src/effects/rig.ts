import { type Channel, hex, kit, max, mul, sum, vec } from '@msb235/blits';
import type { Vec3 } from '../pose.js';
import type { PartOffset, ResolvedOffset } from './types.js';

/**
 * The channel set behind every part offset. `dark` takes the strongest rather than compounding —
 * two layers each half-dead should not read as dead — and `color` replaces, having no arithmetic
 * of its own to contribute with.
 */
export const PART_RIG = kit<ResolvedOffset>({
  gain: mul(),
  color: hex(),
  dark: max(),
  position: vec(3, sum()) as unknown as Channel<Vec3>,
  rotation: vec(3, sum()) as unknown as Channel<Vec3>,
  scale: mul(),
  crawl: sum(),
  light: vec(3, sum()) as unknown as Channel<Vec3>,
});

export const PART_CHANNELS = [
  'gain',
  'color',
  'dark',
  'position',
  'rotation',
  'scale',
  'crawl',
  'light',
] as const;

/**
 * A piece's offset as the rig reads it. Only `light` differs: a lamp is authored as a color and
 * an amount, and lamps sum, so the channel carries the premultiplied color a sum can fold.
 */
export function asDelta(o: PartOffset): Partial<ResolvedOffset> {
  const { light, ...rest } = o;
  if (!light?.amount) return rest;
  const amount = light.amount;
  return {
    ...rest,
    light: [
      (((light.color >> 16) & 0xff) / 255) * amount,
      (((light.color >> 8) & 0xff) / 255) * amount,
      ((light.color & 0xff) / 255) * amount,
    ],
  };
}
