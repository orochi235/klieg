import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { assign } from '../../../src/render/tube/assign.js';
import { rampAt } from '../../../src/render/tube/gradient.js';
import type { Run } from '../../../src/render/tube/runs.js';

function runs(n: number): Run[] {
  return Array.from({ length: n }, (_, i) => {
    const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(i + 1, 0, 0)];
    return {
      points,
      from: points.map((_, j) => ({ path: 0, index: j })),
      surface: 'front' as const,
      length: i + 1,
      index: i,
      lit: true,
      color: 0,
    };
  });
}

const COLORS = [0xff0000, 0x00ff00, 0x0000ff];

describe('assign', () => {
  it('lights everything at amount 1', () => {
    const out = assign(runs(6), { by: 'seed', amount: 1 }, COLORS, 3);
    expect(out.every((r) => r.lit)).toBe(true);
  });

  it('lights nothing at amount 0', () => {
    const out = assign(runs(6), { by: 'seed', amount: 0 }, COLORS, 3);
    expect(out.some((r) => r.lit)).toBe(false);
  });

  it('reads an amount above 1 as a count', () => {
    const out = assign(runs(10), { by: 'length', amount: 4 }, COLORS, 3);
    expect(out.filter((r) => r.lit)).toHaveLength(4);
  });

  it('lights the longest runs when ordering by length', () => {
    const out = assign(runs(10), { by: 'length', amount: 3 }, COLORS, 3);
    expect(
      out
        .filter((r) => r.lit)
        .map((r) => r.index)
        .sort((a, b) => a - b),
    ).toEqual([7, 8, 9]);
  });

  it('alternates when ordering by index with a stride', () => {
    const out = assign(runs(6), { by: 'index', amount: 1, stride: 2 }, COLORS, 3);
    expect(out.filter((r) => r.lit).map((r) => r.index)).toEqual([0, 2, 4]);
  });

  it('is deterministic for the same seed and unequal for different ones', () => {
    const a = assign(runs(12), { by: 'seed', amount: 0.5 }, COLORS, 3).map((r) => r.lit);
    const b = assign(runs(12), { by: 'seed', amount: 0.5 }, COLORS, 3).map((r) => r.lit);
    const c = assign(runs(12), { by: 'seed', amount: 0.5 }, COLORS, 9).map((r) => r.lit);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('cycles the palette across runs and tolerates a single color', () => {
    const many = assign(runs(5), { by: 'seed', amount: 1 }, COLORS, 3);
    expect(many.map((r) => r.color)).toEqual([0xff0000, 0x00ff00, 0x0000ff, 0xff0000, 0x00ff00]);
    const one = assign(runs(3), { by: 'seed', amount: 1 }, [0xabcdef], 3);
    expect(one.every((r) => r.color === 0xabcdef)).toBe(true);
  });

  it('leaves the run order untouched', () => {
    const out = assign(runs(6), { by: 'length', amount: 2 }, COLORS, 3);
    expect(out.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('does not throw on an empty run list', () => {
    expect(assign([], { by: 'seed', amount: 1 }, COLORS, 3)).toEqual([]);
  });

  it('cycles the palette across lit runs only, not across every run', () => {
    // Indices 0, 2, 4 lit out of 6, palette of 2: cycling over all runs would give
    // [red, red, red] since 0, 2, 4 are all even; cycling over only the lit ones gives
    // [red, green, red], which is the only case that tells the two apart.
    const out = assign(runs(6), { by: 'index', amount: 1, stride: 2 }, [0xff0000, 0x00ff00], 3);
    expect(out.filter((r) => r.lit).map((r) => r.color)).toEqual([0xff0000, 0x00ff00, 0xff0000]);
  });
});

describe('assign with a per-run gradient', () => {
  const RAMP = [0xff0000, 0x0000ff];

  it('replaces the dealt colour with the ramp, spread over the lit runs', () => {
    const out = assign(runs(5), { by: 'index', amount: 1 }, COLORS, 3, undefined, ['front'], {
      domain: { of: 'runIndex' },
      stops: RAMP,
      mode: 'replace',
    });
    const lit = out.filter((r) => r.lit);
    expect(lit[0]?.color).toBe(rampAt(RAMP, 0).getHex());
    expect(lit[lit.length - 1]?.color).toBe(rampAt(RAMP, 1).getHex());
  });

  it('multiplies the dealt colour under modulate, so the deck survives', () => {
    const out = assign(runs(5), { by: 'index', amount: 1 }, [0x8040c0], 3, undefined, ['front'], {
      domain: { of: 'runIndex' },
      stops: [0xffffff, 0xffffff],
      mode: 'modulate',
    });
    // A white ramp is the identity: every run keeps the colour it was dealt.
    for (const run of out.filter((r) => r.lit)) expect(run.color).toBe(0x8040c0);
  });

  it('darkens toward the ramp floor under modulate', () => {
    const out = assign(runs(5), { by: 'index', amount: 1 }, [0xffffff], 3, undefined, ['front'], {
      domain: { of: 'runIndex' },
      stops: [0x000000, 0xffffff],
      mode: 'modulate',
    });
    const lit = out.filter((r) => r.lit);
    expect(lit[0]?.color).toBe(0x000000);
    expect(lit[lit.length - 1]?.color).toBe(0xffffff);
  });

  it('leaves a non-per-run domain to the geometry, dealing as usual', () => {
    const out = assign(runs(5), { by: 'index', amount: 1 }, COLORS, 3, undefined, ['front'], {
      domain: { of: 'axis' },
      stops: RAMP,
      mode: 'replace',
    });
    expect(out.filter((r) => r.lit)[0]?.color).toBe(COLORS[0]);
  });

  it('lets surfaceColors win over a surface domain', () => {
    const out = assign(
      runs(4),
      { by: 'index', amount: 1 },
      COLORS,
      3,
      { front: [0x123456] },
      ['front'],
      {
        domain: { of: 'surface' },
        stops: RAMP,
        mode: 'replace',
      },
    );
    expect(out.filter((r) => r.lit).every((r) => r.color === 0x123456)).toBe(true);
  });

  it('applies a surface domain directly when no surfaceColors is given', () => {
    const mixed: Run[] = [
      ...runs(2),
      { ...runs(1)[0], surface: 'back' as const, index: 2 },
      { ...runs(1)[0], surface: 'back' as const, index: 3 },
    ] as Run[];
    const out = assign(mixed, { by: 'index', amount: 1 }, COLORS, 3, undefined, ['front', 'back'], {
      domain: { of: 'surface' },
      stops: RAMP,
      mode: 'replace',
    });
    const bySurface = (s: string) => out.find((r) => r.surface === s)?.color;
    expect(bySurface('front')).toBe(rampAt(RAMP, 0).getHex());
    expect(bySurface('back')).toBe(rampAt(RAMP, 1).getHex());
  });

  it('falls back to a flat first stop when no surfaces are listed', () => {
    // perRunT's surface domain does `surfaces.indexOf(run.surface)`, which is -1 against an empty
    // list; that reads as "not found" and lands on t = 0 for every run. This is quiet, not wrong:
    // the one production caller always passes its real surface list, so this pins the fallback
    // rather than guarding against a case that caller can't reach.
    const out = assign(runs(5), { by: 'index', amount: 1 }, COLORS, 3, undefined, undefined, {
      domain: { of: 'surface' },
      stops: RAMP,
      mode: 'replace',
    });
    for (const run of out.filter((r) => r.lit)) expect(run.color).toBe(rampAt(RAMP, 0).getHex());
  });

  it('deals exactly as before when no gradient is given', () => {
    const before = assign(runs(7), { by: 'seed', amount: 0.6 }, COLORS, 11);
    const after = assign(runs(7), { by: 'seed', amount: 0.6 }, COLORS, 11, undefined, ['front']);
    expect(after.map((r) => [r.lit, r.color])).toEqual(before.map((r) => [r.lit, r.color]));
  });
});
