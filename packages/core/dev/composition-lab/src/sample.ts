import type { EffectFrame } from '@core/effects/frame.js';
import type { FrameCtx, PartInfo, ResolvedOffset } from '@core/effects/types.js';

/** The sweep and the live panels must sample at one rate, or their numbers do not compare. */
export const PASS_SAMPLES = 600;

/** One pass sampled on a grid: a row per part, a column per sample. */
export interface PassSamples {
  samples: number;
  /** Multiplicative channels rest at 1; an untouched part is all-1, not all-0. */
  gain: number[][];
  scale: number[][];
  dark: number[][];
  crawl: number[][];
  /** Length of the merged lamp vector. A lamp writes nothing else, so without this a lamp layer
   * reads on every other channel exactly as a piece that does nothing does. */
  light: number[][];
  /** Packed 0xRRGGBB, or -1 where no layer wrote a colour. */
  color: number[][];
  /** Whether any layer ever MOVED this part across the whole pass. Being targeted is not enough:
   * a piece like `roving` addresses the whole pool and afflicts one part of it, and counting the
   * pool would make this blind to exactly the fault it exists to show. */
  touched: boolean[];
  /** The same question per sample. Tenure is a run of trues; a handover is where the set changes. */
  moved: boolean[][];
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
  const flags = () =>
    Array.from({ length: parts.length }, () => new Array<boolean>(samples).fill(false));

  const out: PassSamples = {
    samples,
    gain: grid(1),
    scale: grid(1),
    dark: grid(0),
    crawl: grid(0),
    light: grid(0),
    color: grid(-1),
    touched: new Array<boolean>(parts.length).fill(false),
    moved: flags(),
  };

  for (let s = 0; s < samples; s++) {
    const resolved = frame.resolve(parts, (s / samples) * duration, ctx);
    for (const [index, o] of resolved) {
      const active = moved(o);
      if (active) out.touched[index] = true;
      (out.moved[index] as boolean[])[s] = active;
      (out.gain[index] as number[])[s] = o.gain;
      (out.scale[index] as number[])[s] = o.scale;
      (out.dark[index] as number[])[s] = o.dark;
      (out.crawl[index] as number[])[s] = o.crawl;
      (out.light[index] as number[])[s] = Math.hypot(o.light[0], o.light[1], o.light[2]);
      (out.color[index] as number[])[s] = o.color ?? -1;
    }
  }
  return out;
}
