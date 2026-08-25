import { describe, expect, it } from 'vitest';
import { selectIndices } from '../src/select.js';

/** Indices are the pool's own numbering, not array offsets — the two differ once anything filters. */
const pool = [
  { index: 0, length: 5 },
  { index: 2, length: 1 },
  { index: 5, length: 9 },
  { index: 7, length: 3 },
];

describe('selectIndices', () => {
  it('takes a fraction of the pool', () => {
    expect(selectIndices(pool, { by: 'index', amount: 0.5 }, 0)).toEqual(new Set([0, 2]));
  });

  it('takes a literal count above 1', () => {
    expect(selectIndices(pool, { by: 'index', amount: 3 }, 0)).toEqual(new Set([0, 2, 5]));
  });

  it('never asks for more than the pool holds', () => {
    expect(selectIndices(pool, { by: 'index', amount: 99 }, 0).size).toBe(4);
  });

  it('takes a literal count, where the same number as an amount would take the whole pool', () => {
    expect(selectIndices(pool, { by: 'index', count: 1 }, 0)).toEqual(new Set([0]));
    expect(selectIndices(pool, { by: 'index', amount: 1 }, 0).size).toBe(4);
  });

  it('lets count win over amount', () => {
    expect(selectIndices(pool, { by: 'index', amount: 1, count: 2 }, 0)).toEqual(new Set([0, 2]));
  });

  it('clamps a count to the pool size', () => {
    expect(selectIndices(pool, { by: 'index', count: 99 }, 0).size).toBe(4);
    expect(selectIndices(pool, { by: 'index', count: -3 }, 0).size).toBe(0);
  });

  it('takes the whole pool when neither count nor amount is given', () => {
    expect(selectIndices(pool, { by: 'index' }, 0).size).toBe(4);
  });

  it('orders by length, longest first', () => {
    expect(selectIndices(pool, { by: 'length', amount: 2 }, 0)).toEqual(new Set([5, 0]));
  });

  it("strides over the pool's own indices", () => {
    expect(selectIndices(pool, { by: 'index', amount: 1, stride: 2 }, 0)).toEqual(new Set([0, 2]));
  });

  it('is deterministic for a seed and varies with it', () => {
    const a = selectIndices(pool, { by: 'seed', amount: 2 }, 7);
    const b = selectIndices(pool, { by: 'seed', amount: 2 }, 7);
    const c = selectIndices(pool, { by: 'seed', amount: 2 }, 8);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('selects nothing from an empty pool rather than throwing', () => {
    expect(selectIndices([], { by: 'seed', amount: 1 }, 0)).toEqual(new Set());
  });
});
