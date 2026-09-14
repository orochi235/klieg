import { falloff, fromPointer, inkCenter, type LightSource } from './source.js';
import type { EffectPiece, PartOffset } from './types.js';

export interface LampSpec {
  /** Where the light is. Defaults to the cursor. */
  source?: LightSource;
  /** Milliseconds for one pass. Read only by the sources that follow the clock, `orbit` and
   * `along`; `fixed` and `fromPointer` ignore `t`. */
  duration?: number;
  /** How far the light reaches, in em of layout space. */
  radius?: number;
  /** Light at the center. Falls to zero at `radius`. */
  strength?: number;
  /** The lamp's own color, multiplied against the look's hue when it resolves. */
  color?: number;
}

const REST: PartOffset = {};

/**
 * Light on the parts near a position, rather than a change to what they are made of. Under the
 * default `fromPointer` source it contributes nothing until the pointer has been inside the
 * canvas, so an untouched page shows no lamp rather than one parked in the middle of the word.
 */
export function lamp(spec: LampSpec = {}): EffectPiece {
  const source = spec.source ?? fromPointer();
  const duration = spec.duration ?? 4000;
  const radius = spec.radius ?? 0.5;
  const strength = spec.strength ?? 2;
  const color = spec.color ?? 0xffffff;

  return {
    duration,
    at(t, part, ctx) {
      const pose = source(t, ctx);
      if (!pose) return REST;
      const c = inkCenter(part.ink);
      const amount = strength * falloff(Math.hypot(c.x - pose.x, c.y - pose.y), radius);
      return amount === 0 ? REST : { light: { color, amount } };
    },
  };
}
