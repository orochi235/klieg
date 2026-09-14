import { falloff, fromPointer, inkCenter, type LightSource } from './source.js';
import type { FrameCtx, PartInfo } from './types.js';

/**
 * A scalar a piece can hinge on: 0..1, resolved per part, per frame. `t` is the hinging piece's
 * own normalized pass, so a signal reading it follows that piece's clock rather than a private one.
 */
export type Signal = (t: number, part: PartInfo, ctx: FrameCtx) => number;

export interface NearSpec {
  /** How far influence reaches, in em of layout space. Default 0.5, as `LampSpec.radius`. */
  radius?: number;
  /** Where the signal is measured from. Defaults to the cursor. */
  source?: LightSource;
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
  return (t, part, ctx) => {
    const pose = source(t, ctx);
    if (!pose) return 0;
    const c = inkCenter(part.ink);
    return falloff(Math.hypot(c.x - pose.x, c.y - pose.y), radius);
  };
}
