import type { PartInfo } from '@core/effects/types.js';
import type { PassSamples } from './sample.js';

export interface TenureReport {
  /** One entry per unbroken stretch a part held the effect, in milliseconds. */
  tenures: number[];
  meanTenureMs: number;
  /** Samples where the holder set changed between two non-empty sets — not a fade in or out. */
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
 * How long a part keeps the effect, and how far it travels when it changes hands. Both read
 * `PassSamples.moved` rather than any wrapper's own arithmetic, so a hand-authored piece that
 * hands over is measured the same way `roving` is.
 */
export function tenureAndJump(
  samples: PassSamples,
  parts: readonly PartInfo[],
  duration: number,
): TenureReport {
  const perSample = duration / samples.samples;

  const tenures: number[] = [];
  for (const row of samples.moved) {
    const runs: number[] = [];
    let run = 0;
    for (const on of row) {
      if (on) run += 1;
      else if (run > 0) {
        runs.push(run);
        run = 0;
      }
    }
    // A stretch still open at the pass end is a tenure; dropping it loses a continuous layer's only
    // one and reports it as never having held anything.
    if (run > 0) runs.push(run);

    // A pass loops, so a run open at the end and a run open at the start are one stretch across
    // the seam. An all-true row is already a single run and needs no joining.
    if (runs.length > 1 && row[0] === true && row[row.length - 1] === true) {
      const first = runs.shift() as number;
      const last = runs.pop() as number;
      runs.push(first + last);
    }
    for (const r of runs) tenures.push(r * perSample);
  }

  const jumpParts: number[] = [];
  const jumpEm: number[] = [];
  let handovers = 0;
  let previousKey = '';
  let previous: Centroid | null = null;

  for (let s = 0; s < samples.samples; s++) {
    const holders: number[] = [];
    for (let p = 0; p < samples.moved.length; p++) {
      if ((samples.moved[p] as boolean[])[s]) holders.push(p);
    }
    const key = holders.join(',');
    if (key === previousKey) continue;
    const here = centroid(holders, parts);
    if (previous && here) {
      handovers += 1;
      jumpParts.push(Math.abs(here.index - previous.index));
      jumpEm.push(Math.hypot(here.x - previous.x, here.y - previous.y));
    }
    previousKey = key;
    if (here) previous = here;
  }

  return {
    tenures,
    meanTenureMs: mean(tenures),
    handovers,
    meanJumpParts: mean(jumpParts),
    meanJumpEm: mean(jumpEm),
  };
}
