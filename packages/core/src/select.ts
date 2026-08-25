export interface SelectSpec {
  /** How the pool is ordered before the amount is taken off the front. */
  by: 'seed' | 'length' | 'index';
  /** 0..1 is a fraction of the pool size; above 1 is a literal count. */
  amount: number;
  /** Only read when `by` is 'index': take every nth member. */
  stride?: number;
}

/** Anything a `SelectSpec` can choose between. `index` is the pool's numbering, not an offset. */
export interface Selectable {
  index: number;
  /** Ranks a `by: 'length'` selection. */
  length: number;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

  const count =
    select.amount > 1
      ? Math.min(pool.length, Math.round(select.amount))
      : Math.round(Math.min(1, Math.max(0, select.amount)) * pool.length);

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
