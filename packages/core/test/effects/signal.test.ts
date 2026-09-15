import { describe, expect, it, vi } from 'vitest';
import { dwell, level, near, peak, type Signal } from '../../src/effects/signal.js';
import { fixed, orbit } from '../../src/effects/source.js';
import type { FrameCtx, PartInfo } from '../../src/effects/types.js';
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

describe('dwell', () => {
  /** An input a test sets directly, so dwell is read rather than the proximity behind it. */
  function input(start = 1) {
    const box = { level: start };
    const signal: Signal = () => box.level;
    return { box, signal };
  }
  const frame = (now: number, dt = 16): FrameCtx => ({ ...NO_CTX, now, dt });

  it('starts empty even with its input already full', () => {
    const { signal } = input(1);
    expect(dwell({ of: signal })(0, partAt(0), frame(0))).toBe(0);
  });

  it('climbs at riseMs per unit while the input holds', () => {
    const { signal } = input(1);
    const d = dwell({ of: signal, riseMs: 1000 });
    const part = partAt(0);
    d(0, part, frame(0));
    expect(d(0, part, frame(250))).toBeCloseTo(0.25);
    expect(d(0, part, frame(500))).toBeCloseTo(0.5);
    expect(d(0, part, frame(5000))).toBe(1);
  });

  it('drains at fallMs per unit once the input goes', () => {
    const { box, signal } = input(1);
    const d = dwell({ of: signal, riseMs: 0, fallMs: 400 });
    const part = partAt(0);
    d(0, part, frame(0));
    expect(d(0, part, frame(16))).toBe(1);
    box.level = 0;
    expect(d(0, part, frame(116))).toBeCloseTo(0.75);
    expect(d(0, part, frame(1000))).toBe(0);
  });

  it('never climbs past what its input reads', () => {
    const { signal } = input(0.4);
    const d = dwell({ of: signal, riseMs: 100 });
    const part = partAt(0);
    d(0, part, frame(0));
    expect(d(0, part, frame(10_000))).toBeCloseTo(0.4);
  });

  // `turns` probes its inner up to 12 times a step, and a hero and its backdrop each resolve: a
  // signal stepped per call would climb as fast as it is asked rather than as time passes.
  it('steps once per frame however often it is asked', () => {
    const { signal } = input(1);
    const spy = vi.fn(signal);
    const d = dwell({ of: spy, riseMs: 1000 });
    const part = partAt(0);
    d(0, part, frame(0));
    let k = 0;
    for (let i = 0; i < 12; i++) k = d(i / 12, part, frame(100));
    expect(k).toBeCloseTo(0.1);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('keeps each part to itself', () => {
    const { signal } = input(1);
    const d = dwell({ of: signal, riseMs: 1000 });
    const early = partAt(0);
    const late = partAt(1);
    d(0, early, frame(0));
    d(0, early, frame(500));
    d(0, late, frame(500));
    expect(d(0, early, frame(600))).toBeCloseTo(0.6);
    expect(d(0, late, frame(600))).toBeCloseTo(0.1);
  });

  it('snaps to its input under reduced motion, and never goes NaN', () => {
    const { box, signal } = input(0.7);
    const d = dwell({ of: signal });
    const part = partAt(0);
    const still = (now: number) => frame(now, Number.POSITIVE_INFINITY);
    expect(d(0, part, still(0))).toBeCloseTo(0.7);
    box.level = Number.NaN;
    expect(d(0, part, still(16))).toBe(0);
    box.level = 1;
    expect(d(0, part, still(32))).toBe(1);
    expect(d(0, part, frame(48))).toBe(1);
  });

  it('reads the cursor by default, and stays empty until it has been inside', () => {
    const d = dwell({ riseMs: 0 });
    const part = partAt(1.2, 0.3);
    d(0, part, frame(0));
    expect(d(0, part, frame(16))).toBe(0);
    expect(d(0, part, { ...AT, now: 32 })).toBeCloseTo(1);
  });
});

describe('level', () => {
  it('reads the value your code set, for every part', () => {
    const hover = level();
    expect(hover(0, partAt(0), NO_CTX)).toBe(0);
    hover.set(0.6);
    expect(hover(0, partAt(0), NO_CTX)).toBe(0.6);
    expect(hover(0.5, partAt(9, 9), NO_CTX)).toBe(0.6);
    expect(hover.value).toBe(0.6);
  });

  it('clamps to 0..1 and reads a non-finite value as 0', () => {
    const hover = level(3);
    expect(hover.value).toBe(1);
    hover.set(-1);
    expect(hover.value).toBe(0);
    hover.set(Number.NaN);
    expect(hover.value).toBe(0);
  });
});

describe('peak', () => {
  it('reads the highest of its signals, per part', () => {
    const low = level(0.2);
    const reach = near({ source: fixed(0, 0), radius: 1 });
    const both = peak(low, reach);
    expect(both(0, partAt(0), NO_CTX)).toBeCloseTo(1);
    expect(both(0, partAt(5), NO_CTX)).toBeCloseTo(0.2);
    expect(peak()(0, partAt(0), NO_CTX)).toBe(0);
  });
});
