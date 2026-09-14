import { describe, expect, it } from 'vitest';
import { near } from '../../src/effects/signal.js';
import { fixed, orbit } from '../../src/effects/source.js';
import type { PartInfo } from '../../src/effects/types.js';
import { AT, NO_CTX } from './ctx.js';

const partAt = (x: number, y = 0): PartInfo => ({
  kind: 'body',
  index: 0,
  count: 1,
  letter: { index: 0, count: 1 },
  x,
  y,
  ink: { minX: x, maxX: x, minY: y, maxY: y },
  at: 0,
  span: 1,
});

/** A letter standing `height` em off its baseline, as every drawn glyph does. */
const standingAt = (x: number, height: number): PartInfo => ({
  ...partAt(x, 0),
  ink: { minX: x - 0.2, maxX: x + 0.2, minY: 0, maxY: height },
});

describe('near', () => {
  it('is 1 on top of the source and 0 at the reach', () => {
    const signal = near({ source: fixed(0, 0), radius: 0.4 });
    expect(signal(0, partAt(0), NO_CTX)).toBeCloseTo(1);
    expect(signal(0, partAt(0.4), NO_CTX)).toBeCloseTo(0);
  });

  it('stays at 0 past the reach rather than going negative', () => {
    const signal = near({ source: fixed(0, 0), radius: 0.4 });
    expect(signal(0, partAt(4), NO_CTX)).toBe(0);
  });

  it('falls off between, without a cliff at either end', () => {
    const signal = near({ source: fixed(0, 0), radius: 1 });
    const half = signal(0, partAt(0.5), NO_CTX);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(1);
    expect(signal(0, partAt(0.25), NO_CTX)).toBeGreaterThan(half);
  });

  // The same bug lamp's own test pins: every part of a single line shares one origin y, so a
  // signal measuring to origins cannot tell the top of a word from its baseline.
  it('measures to the part ink rather than to the baseline origin', () => {
    // On the ink center of a letter standing 1 em — half an em above the baseline that every
    // part of the line shares, and so out of reach of anything measuring to origins.
    const signal = near({ source: fixed(0, 0.5), radius: 0.4 });
    expect(signal(0, standingAt(0, 1), NO_CTX)).toBeCloseTo(1);
    expect(signal(0, partAt(0, 0), NO_CTX)).toBe(0);
  });

  it('reads 0 until the pointer has been inside, under the default source', () => {
    expect(near()(0, partAt(0), NO_CTX)).toBe(0);
  });

  it('follows the cursor once it is inside', () => {
    const signal = near({ radius: 0.5 });
    expect(signal(0, partAt(1.2, 0.3), AT)).toBeCloseTo(1);
    expect(signal(0, partAt(-1.2, 0.3), AT)).toBe(0);
  });

  // The whole point of taking lamp's LightSource: a clock-driven signal costs no new code.
  it('sweeps on a clock with no pointer at all', () => {
    const signal = near({ source: orbit({ radius: 1 }), radius: 0.5 });
    const right = signal(0, partAt(1, 0), NO_CTX);
    const left = signal(0.5, partAt(1, 0), NO_CTX);
    expect(right).toBeCloseTo(1);
    expect(left).toBe(0);
  });
});
