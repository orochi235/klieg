import { type Channel, color, kit, last, max, mul, oklab, sum, vec } from '@msb235/blits';
import type { Vec3 } from '../pose.js';
import type { PartDelta, PartPose } from './types.js';

/**
 * The channel set behind every part offset. `dark` takes the strongest rather than compounding —
 * two layers each half-dead should not read as dead — and `color` replaces, interpolating in
 * OKLCH, and holds OKLab with coverage: a writer turns it back with `toHex`.
 */
export const PART_KIT = kit<PartPose>({
  gain: mul(),
  color: color(last(), { lerp: 'oklch' }),
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
 * A patch's delta as the kit reads it. A color is authored as 0xrrggbb and held as OKLab. A lamp
 * is authored as a color and an amount, and lamps sum, so the channel carries the premultiplied
 * color a sum can fold.
 */
export function asDelta(o: PartDelta): Partial<PartPose> {
  const { light, color: rgb, ...rest } = o;
  const out: Partial<PartPose> = rest;
  if (rgb !== undefined) out.color = oklab(rgb);
  if (!light?.amount) return out;
  const amount = light.amount;
  out.light = [
    (((light.color >> 16) & 0xff) / 255) * amount,
    (((light.color >> 8) & 0xff) / 255) * amount,
    ((light.color & 0xff) / 255) * amount,
  ];
  return out;
}
