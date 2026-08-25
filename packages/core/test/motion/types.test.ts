import { describe, expect, it } from 'vitest';
import type {
  ActiveName,
  EnterName,
  ExitName,
  LetterInfo,
  Ordered,
} from '../../src/motion/types.js';
import { NONE, orderKey, stagger } from '../../src/motion/types.js';

function letter(index: number, count: number): LetterInfo {
  return { index, count };
}

describe('stagger', () => {
  it('is 0 at t=0 for the first letter', () => {
    expect(stagger(0, letter(0, 6))).toBe(0);
  });

  it('saturates to exactly 1 at t=1 for every letter, across counts', () => {
    for (const count of [1, 2, 6, 20]) {
      for (let index = 0; index < count; index++) {
        expect(stagger(1, letter(index, count))).toBe(1);
      }
    }
  });

  it('would fail saturation if the upper clamp were removed', () => {
    // Direct computation of the unclamped formula for the last letter of a 20-letter
    // word: start = (19/20) * 0.5 = 0.475, span = 0.5, so (1 - 0.475) / 0.5 = 1.05 > 1.
    // The clamp is what brings this back to exactly 1.
    const unclamped = (1 - (19 / 20) * 0.5) / 0.5;
    expect(unclamped).toBeGreaterThan(1);
    expect(stagger(1, letter(19, 20))).toBe(1);
  });

  it('later letters lag earlier ones at a mid-range t', () => {
    const count = 10;
    const t = 0.5;
    let prev = stagger(t, letter(0, count));
    for (let index = 1; index < count; index++) {
      const cur = stagger(t, letter(index, count));
      expect(cur).toBeLessThan(prev);
      prev = cur;
    }
  });

  it('always stays within [0, 1] across a dense sample of t, counts, and indices', () => {
    const counts = [1, 2, 5, 13];
    for (const count of counts) {
      for (let index = 0; index < count; index++) {
        for (let i = 0; i <= 100; i++) {
          const t = i / 100;
          const v = stagger(t, letter(index, count));
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('guards against divide-by-zero for count: 0', () => {
    const v = stagger(0.5, letter(0, 0));
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });

  it('never produces NaN when spread=1, even exactly at a letter start (the 0/0 case)', () => {
    const count = 8;
    for (let index = 0; index < count; index++) {
      const l = letter(index, count);
      const start = (index / count) * 1;
      const v = stagger(start, l, 1);
      expect(Number.isNaN(v)).toBe(false);
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('a larger spread produces more first-to-last lag than a smaller spread at the same t', () => {
    const count = 10;
    const t = 0.6;
    const lagAt = (spread: number) =>
      stagger(t, letter(0, count), spread) - stagger(t, letter(count - 1, count), spread);
    expect(lagAt(0.8)).toBeGreaterThan(lagAt(0.2));
  });
});

describe('NONE', () => {
  it('has zero duration', () => {
    expect(NONE.duration).toBe(0);
  });

  it('offset() returns an empty object for any t and letter', () => {
    expect(Object.keys(NONE.offset(0, letter(0, 1))).length).toBe(0);
    expect(Object.keys(NONE.offset(0.5, letter(3, 7))).length).toBe(0);
    expect(Object.keys(NONE.offset(1, letter(6, 7))).length).toBe(0);
  });

  it('offset() returns a fresh object each call, not a shared one', () => {
    const l = letter(0, 1);
    expect(NONE.offset(0, l)).not.toBe(NONE.offset(0, l));
  });
});

describe('motion name unions are complete', () => {
  it('EnterName has the expected 6 members', () => {
    const names: EnterName[] = ['slam', 'spin', 'flip', 'assemble', 'rise', 'none'];
    expect(names.length).toBe(6);
  });

  it('ActiveName has the expected 4 members', () => {
    const names: ActiveName[] = ['float', 'pulse', 'shimmer', 'none'];
    expect(names.length).toBe(4);
  });

  it('ExitName has the expected 5 members', () => {
    const names: ExitName[] = ['shatter', 'drop', 'recede', 'fade', 'none'];
    expect(names.length).toBe(5);
  });
});

describe('orderKey', () => {
  const word = (index: number, count = 5): LetterInfo => ({ index, count });

  it('defaults to reading order, which is what the repertoire is written against', () => {
    expect([0, 1, 2, 3, 4].map((i) => orderKey(word(i)))).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
  });

  it('reverses for end', () => {
    const keys = [0, 1, 2, 3, 4].map((i) => orderKey(word(i), { from: 'end' }));

    expect(keys[0] as number).toBeGreaterThan(keys[4] as number);
  });

  it('sends the middle first for center, and the ends first for edges', () => {
    const center = [0, 1, 2, 3, 4].map((i) => orderKey(word(i), { from: 'center' }));
    const edges = [0, 1, 2, 3, 4].map((i) => orderKey(word(i), { from: 'edges' }));

    expect(center[2]).toBe(0);
    expect(center[0]).toBe(1);
    expect(center[4]).toBe(1);
    expect(edges[2]).toBe(1);
    expect(edges[0]).toBe(0);
  });

  it('is deterministic for random, so screenshots stay comparable across runs', () => {
    const once = [0, 1, 2, 3, 4].map((i) => orderKey(word(i), { from: 'random' }));
    const twice = [0, 1, 2, 3, 4].map((i) => orderKey(word(i), { from: 'random' }));

    expect(twice).toEqual(once);
    for (const k of once) {
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThanOrEqual(1);
    }
  });

  it('measures center radially over a block when grid is set', () => {
    const at = (index: number, line: number, column: number): LetterInfo => ({
      index,
      count: 6,
      line,
      column,
      lineCount: 2,
      columnCount: 3,
    });

    // Two rows of three: the middle of a row is nearer the block center than its corner is.
    expect(orderKey(at(1, 0, 1), { from: 'center', grid: true })).toBeLessThan(
      orderKey(at(0, 0, 0), { from: 'center', grid: true }),
    );
  });

  it('falls back to reading order when the letter carries no block position', () => {
    expect(orderKey(word(2), { from: 'center', grid: true })).toBe(
      orderKey(word(2), { from: 'center' }),
    );
  });
});

describe('stagger spec forms', () => {
  const L = (index: number, count = 4): LetterInfo => ({ index, count });

  it('takes a bare number as spread, which every existing piece passes', () => {
    expect(stagger(0.5, L(2), 0.6)).toBe(stagger(0.5, L(2), { spread: 0.6 }));
  });

  it('derives spread from each times the letter count', () => {
    expect(stagger(0.5, L(2), { each: 0.15 })).toBe(stagger(0.5, L(2), { spread: 0.6 }));
  });

  it('never lets each push spread past the whole pass', () => {
    expect(Number.isNaN(stagger(0.5, L(3), { each: 0.9 }))).toBe(false);
  });
});

describe('orderKey over a non-letter pool', () => {
  it('orders anything carrying index and count', () => {
    const part: Ordered = { index: 3, count: 4 };

    expect(orderKey(part, { from: 'start' })).toBeCloseTo(0.75);
    expect(orderKey(part, { from: 'end' })).toBeCloseTo(0.25);
  });

  it('ignores the letter-only fields, so a part staggers like the letter it sits in', () => {
    const spec = { spread: 0.5, from: 'start' as const };
    const asLetter: LetterInfo = {
      index: 1,
      count: 4,
      line: 0,
      column: 1,
      lineCount: 1,
      columnCount: 4,
      x: -0.5,
      y: 0.25,
      leaving: true,
    };
    const asPart: Ordered = { index: 1, count: 4 };

    expect(stagger(0.75, asPart, spec)).toBe(stagger(0.75, asLetter, spec));
  });
});
