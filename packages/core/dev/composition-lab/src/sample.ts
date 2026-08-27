import type { EffectFrame } from '@core/effects/frame.js';
import type { FrameCtx, PartInfo, ResolvedOffset } from '@core/effects/types.js';

/** One pass sampled on a grid: a row per part, a column per sample. */
export interface PassSamples {
  samples: number;
  /** Multiplicative channels rest at 1; an untouched part is all-1, not all-0. */
  gain: number[][];
  scale: number[][];
  dark: number[][];
  crawl: number[][];
  /** Packed 0xRRGGBB, or -1 where no layer wrote a colour. */
  color: number[][];
  /** Whether any layer ever MOVED this part across the whole pass. Being targeted is not enough:
   * a piece like `roving` addresses the whole pool and afflicts one part of it, and counting the
   * pool would make this blind to exactly the fault it exists to show. */
  touched: boolean[];
}

/** Whether a merged offset is doing anything. Multiplicative channels rest at 1, additive at 0. */
function moved(o: ResolvedOffset): boolean {
  if (o.gain !== 1 || o.scale !== 1 || o.dark !== 0 || o.crawl !== 0) return true;
  if (o.color !== undefined) return true;
  if (o.position.some((n) => n !== 0) || o.rotation.some((n) => n !== 0)) return true;
  return o.light.some((n) => n !== 0);
}

/**
 * Samples the composition across one pass. Drives the renderer's own `EffectFrame`, so what this
 * plots is what the sign does — an instrument resolving its own layers would drift.
 */
export function samplePass(
  frame: EffectFrame,
  parts: readonly PartInfo[],
  duration: number,
  samples: number,
  ctx: FrameCtx,
): PassSamples {
  const grid = (fill: number) =>
    Array.from({ length: parts.length }, () => new Array<number>(samples).fill(fill));

  const out: PassSamples = {
    samples,
    gain: grid(1),
    scale: grid(1),
    dark: grid(0),
    crawl: grid(0),
    color: grid(-1),
    touched: new Array<boolean>(parts.length).fill(false),
  };

  for (let s = 0; s < samples; s++) {
    const resolved = frame.resolve(parts, (s / samples) * duration, ctx);
    for (const [index, o] of resolved) {
      if (moved(o)) out.touched[index] = true;
      (out.gain[index] as number[])[s] = o.gain;
      (out.scale[index] as number[])[s] = o.scale;
      (out.dark[index] as number[])[s] = o.dark;
      (out.crawl[index] as number[])[s] = o.crawl;
      (out.color[index] as number[])[s] = o.color ?? -1;
    }
  }
  return out;
}
