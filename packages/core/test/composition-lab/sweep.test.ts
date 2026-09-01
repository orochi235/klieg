import { describe, expect, it } from 'vitest';
import type { Composition } from '../../dev/composition-lab/src/composition.js';
import { syntheticPool } from '../../dev/composition-lab/src/pool.js';
import { runSweep } from '../../dev/composition-lab/src/sweep.js';
import { NO_CTX } from '../effects/ctx.js';

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

  // The finding the panel exists to reproduce: a column that does not move IS the answer, and has
  // to be marked rather than left as three numbers a reader has to compare by eye.
  it('marks a column flat when the param does not reach it', () => {
    const r = runSweep(composition({}), 'a', 'unrest', 0.2, 0.4, 3, PARTS, 60, NO_CTX);
    expect(r.flat).toContain('meanLight');
  });

  it('returns no rows for a layer id that is not in the composition', () => {
    expect(runSweep(composition({}), 'nope', 'unrest', 0, 1, 3, PARTS, 60, NO_CTX).rows).toEqual(
      [],
    );
  });
});
