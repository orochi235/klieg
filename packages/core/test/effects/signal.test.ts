import { peak } from '@msb235/blits';
import { describe, expect, it } from 'vitest';
import { dwell, level, near } from '../../src/effects/signal.js';
import { fixed, orbit } from '../../src/effects/source.js';
import type { PartInfo, Signal } from '../../src/effects/types.js';
import { AT, NO_CTX, voice } from './ctx.js';

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
    expect(signal(partAt(0), NO_CTX)).toBeCloseTo(1);
    expect(signal(partAt(0.4), NO_CTX)).toBeCloseTo(0);
  });

  it('stays at 0 past the reach rather than going negative', () => {
    const signal = near({ source: fixed(0, 0), radius: 0.4 });
    expect(signal(partAt(4), NO_CTX)).toBe(0);
  });

  it('falls off between, without a cliff at either end', () => {
    const signal = near({ source: fixed(0, 0), radius: 1 });
    const half = signal(partAt(0.5), NO_CTX);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(1);
    expect(signal(partAt(0.25), NO_CTX)).toBeGreaterThan(half);
  });

  // The same bug lamp's own test pins: every part of a single line shares one origin y, so a
  // signal measuring to origins cannot tell the top of a word from its baseline.
  it('measures to the part ink rather than to the baseline origin', () => {
    // On the ink center of a letter standing 1 em — half an em above the baseline that every
    // part of the line shares, and so out of reach of anything measuring to origins.
    const signal = near({ source: fixed(0, 0.5), radius: 0.4 });
    expect(signal(standingAt(0, 1), NO_CTX)).toBeCloseTo(1);
    expect(signal(partAt(0, 0), NO_CTX)).toBe(0);
  });

  it('reads 0 until the pointer has been inside, under the default source', () => {
    expect(near()(partAt(0), NO_CTX)).toBe(0);
  });

  it('follows the cursor once it is inside', () => {
    const signal = near({ radius: 0.5 });
    expect(signal(partAt(1.2, 0.3), AT)).toBeCloseTo(1);
    expect(signal(partAt(-1.2, 0.3), AT)).toBe(0);
  });

  // The whole point of taking lamp's LightSource: a clock-driven signal costs no new code.
  it('sweeps on the clock with no pointer at all, one pass per period', () => {
    const signal = near({ source: orbit({ radius: 1 }), radius: 0.5, period: 1000 });
    const v = voice();
    expect(signal(partAt(1, 0), v({ elapsed: 0 }))).toBeCloseTo(1);
    expect(signal(partAt(1, 0), v({ elapsed: 500 }))).toBe(0);
    expect(signal(partAt(1, 0), v({ elapsed: 1000 }))).toBeCloseTo(1);
  });

  it('takes its pass from the setting clock over a default 4000ms period', () => {
    const signal = near({ source: orbit({ radius: 1 }), radius: 0.5 });
    const v = voice();
    expect(signal(partAt(1, 0), v({ elapsed: 2000 }))).toBe(0);
    expect(signal(partAt(1, 0), v({ elapsed: 4000 }))).toBeCloseTo(1);
  });
});

describe('dwell', () => {
  /** An input a test sets directly, so dwell is read rather than the proximity behind it. */
  function input(start = 1) {
    const box = { level: start };
    const signal: Signal = () => box.level;
    return { box, signal };
  }

  it('starts empty even with its input already full', () => {
    const { signal } = input(1);
    expect(dwell({ of: signal })(partAt(0), voice()({ now: 0 }))).toBe(0);
  });

  it('climbs at riseMs per unit while the input holds', () => {
    const { signal } = input(1);
    const d = dwell({ of: signal, riseMs: 1000 });
    const v = voice();
    const part = partAt(0);
    d(part, v({ now: 0 }));
    expect(d(part, v({ now: 250 }))).toBeCloseTo(0.25);
    expect(d(part, v({ now: 500 }))).toBeCloseTo(0.5);
    expect(d(part, v({ now: 5000 }))).toBe(1);
  });

  it('drains at fallMs per unit once the input goes', () => {
    const { box, signal } = input(1);
    const d = dwell({ of: signal, riseMs: 0, fallMs: 400 });
    const v = voice();
    const part = partAt(0);
    d(part, v({ now: 0 }));
    expect(d(part, v({ now: 16 }))).toBe(1);
    box.level = 0;
    expect(d(part, v({ now: 116 }))).toBeCloseTo(0.75);
    expect(d(part, v({ now: 1000 }))).toBe(0);
  });

  it('never climbs past what its input reads', () => {
    const { signal } = input(0.4);
    const d = dwell({ of: signal, riseMs: 100 });
    const v = voice();
    const part = partAt(0);
    d(part, v({ now: 0 }));
    expect(d(part, v({ now: 10_000 }))).toBeCloseTo(0.4);
  });

  // `turns` probes its inner up to 12 times a step, and a hero and its backdrop each resolve: a
  // signal stepped per call would climb as fast as it is asked rather than as time passes.
  it('steps once per frame however often it is asked', () => {
    const { signal } = input(1);
    const d = dwell({ of: signal, riseMs: 1000 });
    const v = voice();
    const part = partAt(0);
    d(part, v({ now: 0 }));
    const reads: number[] = [];
    for (let i = 0; i < 12; i++) reads.push(d(part, v({ now: 100 })));
    for (const k of reads) expect(k).toBeCloseTo(0.1);
  });

  it('keeps each part to itself, as the subject the mix keys it on', () => {
    const { signal } = input(1);
    const d = dwell({ of: signal, riseMs: 1000 });
    const v = voice();
    const early = partAt(0);
    const late = partAt(1);
    d(early, v({ now: 0 }, early));
    d(early, v({ now: 500 }, early));
    d(late, v({ now: 500 }, late));
    expect(d(early, v({ now: 600 }, early))).toBeCloseTo(0.6);
    expect(d(late, v({ now: 600 }, late))).toBeCloseTo(0.1);
  });

  it('keeps each voice to itself: a second voice on the same part starts empty', () => {
    const { signal } = input(1);
    const d = dwell({ of: signal, riseMs: 1000 });
    const first = voice();
    const second = voice();
    const part = partAt(0);
    d(part, first({ now: 0 }));
    expect(d(part, first({ now: 500 }))).toBeCloseTo(0.5);
    expect(d(part, second({ now: 500 }))).toBe(0);
    expect(d(part, second({ now: 600 }))).toBeCloseTo(0.1);
    expect(d(part, first({ now: 600 }))).toBeCloseTo(0.6);
  });

  it('snaps to its input under reduced motion, and never goes NaN', () => {
    const { box, signal } = input(0.7);
    const d = dwell({ of: signal });
    const v = voice();
    const part = partAt(0);
    const still = (now: number) => v({ now, dt: Number.POSITIVE_INFINITY });
    expect(d(part, still(0))).toBeCloseTo(0.7);
    box.level = Number.NaN;
    expect(d(part, still(16))).toBe(0);
    box.level = 1;
    expect(d(part, still(32))).toBe(1);
    expect(d(part, v({ now: 48 }))).toBe(1);
  });

  it('reads the cursor by default, and stays empty until it has been inside', () => {
    const d = dwell({ riseMs: 0 });
    const v = voice();
    const part = partAt(1.2, 0.3);
    d(part, v({ now: 0 }));
    expect(d(part, v({ now: 16 }))).toBe(0);
    expect(
      d(part, v({ now: 32, pointer: { x: 0.5, y: -0.5 }, pointerInWord: { x: 1.2, y: 0.3 } })),
    ).toBeCloseTo(1);
  });
});

describe('level', () => {
  it('reads the value your code set, for every part', () => {
    const hover = level();
    expect(hover(partAt(0), NO_CTX)).toBe(0);
    hover.set(0.6);
    expect(hover(partAt(0), NO_CTX)).toBe(0.6);
    expect(hover(partAt(9, 9), AT)).toBe(0.6);
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
    expect(both(partAt(0), NO_CTX)).toBeCloseTo(1);
    expect(both(partAt(5), NO_CTX)).toBeCloseTo(0.2);
    expect(peak()(partAt(0), NO_CTX)).toBe(0);
  });
});
