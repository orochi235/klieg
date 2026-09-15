import { describe, expect, it } from 'vitest';
import { kicks } from '../../src/effects/kick.js';
import type { FrameCtx, PartInfo } from '../../src/effects/types.js';
import { NO_CTX } from './ctx.js';

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
const frame = (now: number, dt = 16): FrameCtx => ({ ...NO_CTX, now, dt });

describe('kicks', () => {
  it('lifts a part within reach to the kick, and leaves one out of reach alone', () => {
    const s = kicks({ radius: 0.4 });
    const close = partAt(0);
    const far = partAt(2);
    s(0, close, frame(0));
    s(0, far, frame(0));
    s.kick({ x: 0, y: 0 }, 0.8);
    expect(s(0, close, frame(16))).toBeCloseTo(0.8);
    expect(s(0, far, frame(16))).toBe(0);
  });

  it('drains at recoverMs per unit', () => {
    const s = kicks({ recoverMs: 500 });
    const p = partAt(0);
    s(0, p, frame(0));
    s.kick({ x: 0, y: 0 });
    expect(s(0, p, frame(16))).toBeCloseTo(1);
    expect(s(0, p, frame(266))).toBeCloseTo(0.5);
    expect(s(0, p, frame(1000))).toBe(0);
  });

  it('keeps the higher of overlapping kicks rather than adding them', () => {
    const s = kicks();
    const p = partAt(0);
    s(0, p, frame(0));
    s.kick({ x: 0, y: 0 }, 0.3);
    s.kick({ x: 0, y: 0 }, 0.9);
    expect(s(0, p, frame(16))).toBeCloseTo(0.9);
    s.kick({ x: 0, y: 0 }, 0.5);
    expect(s(0, p, frame(17))).toBeLessThanOrEqual(0.9);
  });

  it('lands a kick on the next frame, however often a part is asked in this one', () => {
    const s = kicks();
    const p = partAt(0);
    s(0, p, frame(0));
    expect(s(0, p, frame(16))).toBe(0);
    s.kick({ x: 0, y: 0 }, 0.7);
    for (let i = 0; i < 12; i++) expect(s(i / 12, p, frame(16))).toBe(0);
    expect(s(0, p, frame(32))).toBeCloseTo(0.7);
  });

  it('never shows a part a kick from before it was first asked about', () => {
    const s = kicks();
    const p = partAt(0);
    s.kick({ x: 0, y: 0 });
    expect(s(0, p, frame(0))).toBe(0);
    expect(s(0, p, frame(16))).toBe(0);
  });

  it('holds a lift for one frame under reduced motion, and never goes NaN', () => {
    const s = kicks();
    const p = partAt(0);
    const still = (now: number) => frame(now, Number.POSITIVE_INFINITY);
    s(0, p, still(0));
    s.kick({ x: 0, y: 0 });
    expect(s(0, p, still(16))).toBeCloseTo(1);
    expect(s(0, p, still(32))).toBe(0);
  });

  it('ignores a kick with nowhere to land or no energy', () => {
    const s = kicks();
    const p = partAt(0);
    s(0, p, frame(0));
    s.kick({ x: Number.NaN, y: 0 });
    s.kick({ x: 0, y: 0 }, 0);
    s.kick({ x: 0, y: 0 }, Number.NaN);
    expect(s(0, p, frame(16))).toBe(0);
  });
});
