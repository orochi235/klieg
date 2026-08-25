import { rng } from './rng.js';
export interface SelectSpec {
  /** How the pool is ordered before the count is taken off the front. */
  by: 'seed' | 'length' | 'index';
  /** Fraction of the pool, 0..1; above 1 is read as a literal count. Omitted takes the whole pool. */
  amount?: number;
  /** A literal number of members. Wins over `amount`. */
  count?: number;
  /** Only read when `by` is 'index': take every nth member. */
  stride?: number;
}

/** Anything a `SelectSpec` can choose between. `index` is the pool's numbering, not an offset. */
export interface Selectable {
  index: number;
  /** Ranks a `by: 'length'` selection. */
  length: number;
}

/** How many members come off the front of the order. */
function countOf(select: SelectSpec, size: number): number {
  if (select.count !== undefined) return Math.min(size, Math.max(0, Math.round(select.count)));
  if (select.amount === undefined) return size;
  if (select.amount > 1) return Math.min(size, Math.round(select.amount));
  return Math.round(Math.min(1, Math.max(0, select.amount)) * size);
}

/** The indices `select` chooses out of `pool`. */
export function selectIndices(
  pool: readonly Selectable[],
  select: SelectSpec,
  seed: number,
): ReadonlySet<number> {
  if (select.by === 'index' && select.stride && select.stride > 1) {
    const stride = Math.round(select.stride);
    return new Set(pool.filter((e) => e.index % stride === 0).map((e) => e.index));
  }

  const count = countOf(select, pool.length);

  let order: number[];
  if (select.by === 'length') {
    order = pool
      .map((e) => [e.length, e.index] as const)
      .sort((a, b) => b[0] - a[0])
      .map(([, i]) => i);
  } else if (select.by === 'index') {
    order = pool.map((e) => e.index);
  } else {
    const random = rng(Math.round(seed * 2654435761) ^ 0x5eed);
    order = pool
      .map((e) => [random(), e.index] as const)
      .sort((a, b) => a[0] - b[0])
      .map(([, i]) => i);
  }

  return new Set(order.slice(0, count));
}
