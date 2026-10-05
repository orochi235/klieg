import { describe, expect, it } from 'vitest';
import { kicks } from '../../src/effects/kick.js';
import type { PartInfo } from '../../src/effects/types.js';
import { voice } from './ctx.js';

const partAt = (x: number): PartInfo => ({
  kind: 'run',
  index: 0,
  count: 1,
  letter: { index: 0, count: 1 },
  x,
  y: 0,
  ink: { minX: x, maxX: x, minY: 0, maxY: 0 },
  at: 0,
  span: 1,
});

/** One voice's frames for `part`: the mix keeps a stateful signal per voice and subject. */
function frames() {
  const v = voice();
  return (part: PartInfo, now: number, dt = 16) => v({ now, dt }, part);
}

describe('kicks', () => {
  it('lifts a part within reach to the kick, and leaves one out of reach alone', () => {
    const s = kicks({ radius: 0.4 });
    const at = frames();
    const close = partAt(0);
    const far = partAt(2);
    s(close, at(close, 0));
    s(far, at(far, 0));
    s.kick({ x: 0, y: 0 }, 0.8);
    expect(s(close, at(close, 16))).toBeCloseTo(0.8);
    expect(s(far, at(far, 16))).toBe(0);
  });

  it('drains at recoverMs per unit', () => {
    const s = kicks({ recoverMs: 500 });
    const at = frames();
    const p = partAt(0);
    s(p, at(p, 0));
    s.kick({ x: 0, y: 0 });
    expect(s(p, at(p, 16))).toBeCloseTo(1);
    expect(s(p, at(p, 266))).toBeCloseTo(0.5);
    expect(s(p, at(p, 1000))).toBe(0);
  });

  it('keeps the higher of overlapping kicks rather than adding them', () => {
    const s = kicks();
    const at = frames();
    const p = partAt(0);
    s(p, at(p, 0));
    s.kick({ x: 0, y: 0 }, 0.3);
    s.kick({ x: 0, y: 0 }, 0.9);
    expect(s(p, at(p, 16))).toBeCloseTo(0.9);
    s.kick({ x: 0, y: 0 }, 0.5);
    expect(s(p, at(p, 17))).toBeLessThanOrEqual(0.9);
  });

  it('lands a kick on the next frame, however often a part is asked in this one', () => {
    const s = kicks();
    const at = frames();
    const p = partAt(0);
    s(p, at(p, 0));
    expect(s(p, at(p, 16))).toBe(0);
    s.kick({ x: 0, y: 0 }, 0.7);
    for (let i = 0; i < 12; i++) expect(s(p, at(p, 16))).toBe(0);
    expect(s(p, at(p, 32))).toBeCloseTo(0.7);
  });

  it('never shows a part a kick from before it was first asked about', () => {
    const s = kicks();
    const at = frames();
    const p = partAt(0);
    s.kick({ x: 0, y: 0 });
    expect(s(p, at(p, 0))).toBe(0);
    expect(s(p, at(p, 16))).toBe(0);
  });

  it('holds a lift for one frame under reduced motion, and never goes NaN', () => {
    const s = kicks();
    const at = frames();
    const p = partAt(0);
    const still = Number.POSITIVE_INFINITY;
    s(p, at(p, 0, still));
    s.kick({ x: 0, y: 0 });
    expect(s(p, at(p, 16, still))).toBeCloseTo(1);
    expect(s(p, at(p, 32, still))).toBe(0);
  });

  it('ignores a kick with nowhere to land or no energy', () => {
    const s = kicks();
    const at = frames();
    const p = partAt(0);
    s(p, at(p, 0));
    s.kick({ x: Number.NaN, y: 0 });
    s.kick({ x: 0, y: 0 }, 0);
    s.kick({ x: 0, y: 0 }, Number.NaN);
    expect(s(p, at(p, 16))).toBe(0);
  });

  it('keeps each voice to itself: a second voice first asking after a kick never sees it', () => {
    const s = kicks();
    const first = frames();
    const second = frames();
    const p = partAt(0);
    s(p, first(p, 0));
    s.kick({ x: 0, y: 0 });
    expect(s(p, first(p, 16))).toBeCloseTo(1);
    expect(s(p, second(p, 16))).toBe(0);
  });
});
