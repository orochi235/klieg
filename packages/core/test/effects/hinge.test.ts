import { describe, expect, it, vi } from 'vitest';
import { isRest } from '../../src/effects/compositor.js';
import { fade, hinge } from '../../src/effects/hinge.js';
import { near } from '../../src/effects/signal.js';
import { fixed } from '../../src/effects/source.js';
import type { EffectPiece, PartInfo, PartOffset } from '../../src/effects/types.js';
import { NO_CTX } from './ctx.js';

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

/** A piece that reports a fixed offset, so a test reads the wrapper rather than the inner. */
const emits = (offset: PartOffset, duration = 1000): EffectPiece => ({
  duration,
  at: () => offset,
});

/** 1 at the origin, 0 half an em out — a signal a test can drive by moving the part. */
const proximity = near({ source: fixed(0, 0), radius: 0.5 });

describe('hinge, stops mode', () => {
  it('builds one piece per stop, all at construction', () => {
    const make = vi.fn(() => emits({ gain: 0.5 }));
    const piece = hinge(proximity, make, { stops: 5 });

    expect(make).toHaveBeenCalledTimes(5);
    make.mockClear();

    piece.at(0, partAt(0), NO_CTX);
    piece.at(0, partAt(0.25), NO_CTX);
    expect(make).not.toHaveBeenCalled();
  });

  it('reaches the first and last stop exactly', () => {
    const seen: number[] = [];
    const piece = hinge(
      proximity,
      (k) => {
        seen.push(k);
        return emits({ gain: k });
      },
      { stops: 4 },
    );

    expect(seen).toEqual([0, 1 / 3, 2 / 3, 1]);
    // On the source, so k = 1 and the last stop answers; well past the reach, so k = 0.
    expect(piece.at(0, partAt(0), NO_CTX).gain).toBeCloseTo(1);
    expect(piece.at(0, partAt(5), NO_CTX).gain).toBe(0);
  });

  it('defaults to eight stops', () => {
    const make = vi.fn(() => emits({ gain: 1 }));
    hinge(proximity, make);
    expect(make).toHaveBeenCalledTimes(8);
  });

  it('never drops below two stops, which would leave nothing to interpolate', () => {
    const make = vi.fn(() => emits({ gain: 1 }));
    hinge(proximity, make, { stops: 1 });
    expect(make).toHaveBeenCalledTimes(2);
  });

  // Silent phase chaos is the failure this replaces: the stops would each run on their own pass
  // while the wrapper published one duration, which is invisible in the source and obvious on
  // screen.
  it('refuses stops that disagree on duration, naming both', () => {
    expect(() =>
      hinge(proximity, (k) => emits({ gain: 1 }, k > 0.5 ? 900 : 1000), { stops: 4 }),
    ).toThrow(/disagree on duration/);
    expect(() =>
      hinge(proximity, (k) => emits({ gain: 1 }, k > 0.5 ? 900 : 1000), { stops: 4 }),
    ).toThrow(/1000ms.*900ms/s);
  });

  it('passes the pass through untouched, so the inner keeps its own clock', () => {
    const at = vi.fn(() => ({ gain: 1 }));
    const piece = hinge(proximity, () => ({ duration: 1000, at }), { stops: 2 });
    piece.at(0.75, partAt(0), NO_CTX);
    expect(at).toHaveBeenCalledWith(0.75, expect.anything(), NO_CTX);
  });
});

describe('hinge, continuous mode', () => {
  it('fades gain toward rest with distance', () => {
    const piece = hinge(proximity, emits({ gain: 0 }));
    expect(piece.at(0, partAt(0), NO_CTX).gain).toBeCloseTo(0);
    expect(piece.at(0, partAt(5), NO_CTX).gain).toBeUndefined();

    const mid = piece.at(0, partAt(0.25), NO_CTX).gain as number;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('rests completely past the reach, so turns can hand the part over', () => {
    const piece = hinge(proximity, emits({ gain: 0, color: 0xff0000, crawl: 2 }));
    expect(isRest(piece.at(0, partAt(5), NO_CTX))).toBe(true);
  });

  it('keeps the inner duration', () => {
    expect(hinge(proximity, emits({ gain: 0 }, 2500)).duration).toBe(2500);
  });

  it("takes a blend of the caller's own", () => {
    const piece = hinge(proximity, emits({ gain: 0.5 }), {
      blend: (o, k) => ({ gain: (o.gain as number) * k }),
    });
    expect(piece.at(0, partAt(0), NO_CTX).gain).toBeCloseTo(0.5);
    expect(piece.at(0, partAt(5), NO_CTX).gain).toBe(0);
  });
});

describe('fade', () => {
  it('scales additive channels toward zero and multiplicative toward one', () => {
    const out = fade({ gain: 0, scale: 3, crawl: 1, dark: 1, position: [2, 4, 6] }, 0.5);
    expect(out.gain).toBeCloseTo(0.5);
    expect(out.scale).toBeCloseTo(2);
    expect(out.crawl).toBeCloseTo(0.5);
    expect(out.dark).toBeCloseTo(0.5);
    expect(out.position).toEqual([1, 2, 3]);
  });

  it("scales a lamp's amount but keeps its color", () => {
    const out = fade({ light: { color: 0x00ff00, amount: 2 } }, 0.25);
    expect(out.light).toEqual({ color: 0x00ff00, amount: 0.5 });
  });

  it('passes color through above zero and drops it at zero', () => {
    expect(fade({ color: 0x123456 }, 0.5).color).toBe(0x123456);
    expect(fade({ color: 0x123456 }, 0)).toEqual({});
  });

  it('reads a non-finite signal as rest rather than as NaN', () => {
    expect(fade({ gain: 0 }, Number.NaN)).toEqual({});
  });
});
