import { describe, expect, it } from 'vitest';
import { poolCounts, syntheticPool } from '../../dev/composition-lab/src/pool.js';

describe('syntheticPool', () => {
  it('gives the requested number of parts', () => {
    expect(syntheticPool(12, 3).filter((p) => p.kind === 'run')).toHaveLength(12);
  });

  it('spans exactly the pool: the last part ends at 1', () => {
    const runs = syntheticPool(9, 3).filter((p) => p.kind === 'run');
    const last = runs[runs.length - 1] as { at: number; span: number };
    expect(last.at + last.span).toBeCloseTo(1);
  });

  it('varies span, because a real word has uneven runs and an even pool flatters every spread', () => {
    const spans = syntheticPool(12, 3)
      .filter((p) => p.kind === 'run')
      .map((p) => p.span);
    expect(new Set(spans.map((s) => s.toFixed(4))).size).toBeGreaterThan(1);
  });
});

describe('poolCounts', () => {
  it('counts each kind, so an empty target can be flagged before it silently does nothing', () => {
    expect(poolCounts(syntheticPool(5, 2))).toEqual({ run: 5, body: 2 });
  });
});
