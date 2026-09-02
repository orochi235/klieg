import type { PartInfo } from '@core/effects/types.js';
import type { PassSamples } from './sample.js';

export interface TenureReport {
  /**
   * Mean time one holder keeps the effect: the pass over the handovers made in it. A layer that
   * never hands over holds for the whole pass; one that moves nothing at all reports 0.
   *
   * Not the mean run of `moved`, which is what this used to report. An inner that returns to rest
   * between its own drops breaks that run every time it rests, so the reading collapsed toward the
   * sample step and halved every time the sample count doubled — a number about the instrument.
   */
  meanTenureMs: number;
  /** Samples where the effect passed from one holder to a different one. */
  handovers: number;
  /** Mean distance a handover moved, by pool index and by em. */
  meanJumpParts: number;
  meanJumpEm: number;
}

const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

interface Centroid {
  index: number;
  x: number;
  y: number;
}

function centroid(holders: number[], parts: readonly PartInfo[]): Centroid | null {
  if (holders.length === 0) return null;
  let index = 0;
  let x = 0;
  let y = 0;
  for (const i of holders) {
    const p = parts[i] as PartInfo;
    index += i;
    x += (p.ink.minX + p.ink.maxX) / 2;
    y += (p.ink.minY + p.ink.maxY) / 2;
  }
  const n = holders.length;
  return { index: index / n, x: x / n, y: y / n };
}

/**
 * How long a part keeps the effect, and how far it travels when it changes hands. Reads
 * `PassSamples.moved` rather than any wrapper's own arithmetic, so a hand-authored piece that
 * hands over is measured the same way `roving` is.
 *
 * Two things make it a reading of the effect rather than of the sample rate. A sample where
 * nothing moves is **skipped**, not treated as a holder in its own right: an inner at rest between
 * its own drops would otherwise read as letting go and taking the fault back, which counts two
 * handovers per drop and pulls every jump toward zero. And the walk **starts at the first sample
 * that moves** and closes back onto it, because the pass loops: starting at sample 0 loses the
 * handover across the seam whenever the pass happens to open mid-rest.
 *
 * `spikes/tenure-vs-dwell.mjs` measures this against the holder the wrapper actually chose.
 */
export function tenureAndJump(
  samples: PassSamples,
  parts: readonly PartInfo[],
  duration: number,
): TenureReport {
  const n = samples.samples;
  const holdersAt = (s: number): number[] => {
    const holders: number[] = [];
    for (let p = 0; p < samples.moved.length; p++) {
      if ((samples.moved[p] as boolean[])[s]) holders.push(p);
    }
    return holders;
  };

  let from = -1;
  for (let s = 0; s < n && from === -1; s++) {
    if (holdersAt(s).length > 0) from = s;
  }
  if (from === -1) return { meanTenureMs: 0, handovers: 0, meanJumpParts: 0, meanJumpEm: 0 };

  const jumpParts: number[] = [];
  const jumpEm: number[] = [];
  let handovers = 0;
  let previous = centroid(holdersAt(from), parts) as Centroid;
  let previousKey = holdersAt(from).join(',');

  // `i <= n` closes the loop: the last step compares the sample before `from` back onto `from`.
  for (let i = 1; i <= n; i++) {
    const holders = holdersAt((from + i) % n);
    if (holders.length === 0) continue;
    const key = holders.join(',');
    if (key === previousKey) continue;
    const here = centroid(holders, parts) as Centroid;
    handovers += 1;
    jumpParts.push(Math.abs(here.index - previous.index));
    jumpEm.push(Math.hypot(here.x - previous.x, here.y - previous.y));
    previous = here;
    previousKey = key;
  }

  return {
    meanTenureMs: handovers === 0 ? duration : duration / handovers,
    handovers,
    meanJumpParts: mean(jumpParts),
    meanJumpEm: mean(jumpEm),
  };
}
