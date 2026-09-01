import { describe, expect, it } from 'vitest';
import type { Composition } from '../../dev/composition-lab/src/composition.js';
import { syntheticPool } from '../../dev/composition-lab/src/pool.js';
import type { PassSamples } from '../../dev/composition-lab/src/sample.js';
import {
  flatMetrics,
  longestLitMs,
  runSweep,
  type SweepRow,
} from '../../dev/composition-lab/src/sweep.js';
import { NO_CTX } from '../effects/ctx.js';

/** `gain` is the only field `longestLitMs` reads; the rest of a PassSamples is filler. */
function samples(gain: number[][]): PassSamples {
  const width = (gain[0] as number[]).length;
  return {
    samples: width,
    gain,
    scale: gain.map(() => new Array<number>(width).fill(1)),
    dark: gain.map(() => new Array<number>(width).fill(0)),
    crawl: gain.map(() => new Array<number>(width).fill(0)),
    light: gain.map(() => new Array<number>(width).fill(0)),
    color: gain.map(() => new Array<number>(width).fill(-1)),
    touched: gain.map(() => false),
    moved: gain.map(() => new Array<boolean>(width).fill(false)),
  };
}

const PARTS = syntheticPool(8, 3);

function composition(params: Record<string, number>): Composition {
  return {
    text: 'HI',
    look: 'tubing',
    hold: 6000,
    enter: 'slam',
    active: 'none',
    exit: 'none',
    pool: 'synthetic',
    effects: [
      {
        id: 'a',
        kind: 'flicker',
        enabled: true,
        params: { duration: 1000, depth: 0, unrest: 0.2, spell: 0, calm: 0, ...params },
        target: 'run',
        amount: 1,
        seed: 0,
      },
    ],
  };
}

describe('runSweep', () => {
  it('walks min to max inclusive, one row per step', () => {
    const r = runSweep(composition({}), 'a', 'unrest', 0.1, 0.5, 5, PARTS, 60, NO_CTX);
    expect(r.rows).toHaveLength(5);
    expect(r.rows[0]?.value).toBeCloseTo(0.1);
    expect(r.rows[2]?.value).toBeCloseTo(0.3);
    expect(r.rows[4]?.value).toBeCloseTo(0.5);
  });

  it('moves dark share with unrest, which is the knob that sets it', () => {
    const r = runSweep(composition({}), 'a', 'unrest', 0.05, 0.6, 4, PARTS, 120, NO_CTX);
    const first = r.rows[0]?.darkShare as number;
    const last = r.rows[3]?.darkShare as number;
    expect(last).toBeGreaterThan(first);
    expect(r.flat).not.toContain('darkShare');
  });

  // Every value here is exactly 0, so this reaches the zero floor and not the relative threshold —
  // the `flatMetrics` cases below are what pin that.
  it('marks a channel flat when no layer writes it at all', () => {
    const r = runSweep(composition({}), 'a', 'unrest', 0.2, 0.4, 3, PARTS, 60, NO_CTX);
    expect(r.flat).toContain('meanLight');
  });

  it('returns no rows for a layer that is switched off, which the composition drops', () => {
    const c = composition({});
    (c.effects[0] as { enabled: boolean }).enabled = false;
    const r = runSweep(c, 'a', 'unrest', 0, 1, 5, PARTS, 60, NO_CTX);
    expect(r.rows).toEqual([]);
    expect(r.flat).toEqual([]);
  });

  it('returns no rows for a layer id that is not in the composition', () => {
    expect(runSweep(composition({}), 'nope', 'unrest', 0, 1, 3, PARTS, 60, NO_CTX).rows).toEqual(
      [],
    );
  });
});

describe('longestLitMs', () => {
  it('joins a lit stretch that straddles the loop seam instead of halving it', () => {
    const s = samples([[1, 0.2, 1]]);
    expect(longestLitMs(s, 900)).toBe(600);
  });

  it('reports a pass with no darkness at all as exactly the pass duration', () => {
    const s = samples([[1, 1, 1]]);
    expect(longestLitMs(s, 900)).toBe(900);
  });

  it('has nothing to join when dark at both the first and last sample', () => {
    const s = samples([[0.2, 1, 0.2]]);
    expect(longestLitMs(s, 900)).toBe(300);
  });
});

/** Only `darkShare` varies; every other metric is 0 and so exercises the absolute floor. */
function darkShares(values: number[]): SweepRow[] {
  return values.map((darkShare, i) => ({
    value: i,
    darkShare,
    longestLitMs: 0,
    coverage: 0,
    meanTenureMs: 0,
    meanJumpParts: 0,
    meanLight: 0,
  }));
}

describe('flatMetrics', () => {
  // The design's own worked example: a 4x `dwell` change moved dark share 19.9 / 19.9 / 20.3.
  // Marking that is the whole point of the column, and a 1% threshold missed it.
  it('marks the null result the panel exists to report', () => {
    expect(flatMetrics(darkShares([0.199, 0.199, 0.203]))).toContain('darkShare');
  });

  it('leaves a column the param does move unmarked', () => {
    expect(flatMetrics(darkShares([0.199, 0.21, 0.22]))).not.toContain('darkShare');
  });

  it('reports nothing flat off a single row, which has nothing to be flat against', () => {
    expect(flatMetrics(darkShares([0.199]))).toEqual([]);
  });
});
