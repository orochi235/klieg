import type { Channel } from '@msb235/blits';
import { describe, expect, it, vi } from 'vitest';
import { isRest, mergeDeltas } from '../../src/effects/compositor.js';
import { EffectFrame, planEffects } from '../../src/effects/frame.js';
import { hinge } from '../../src/effects/hinge.js';
import { PART_KIT } from '../../src/effects/rig.js';
import { near } from '../../src/effects/signal.js';
import { fixed } from '../../src/effects/source.js';
import type {
  EffectPatch,
  Host,
  PartDelta,
  PartInfo,
  PartPose,
  Signal,
} from '../../src/effects/types.js';
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

/** A patch that reports a fixed delta, so a test reads the wrapper rather than the inner. */
const emits = (delta: PartDelta, period = 1000): EffectPatch => ({
  period,
  at: () => delta,
});

/** 1 at the origin, 0 half an em out — a signal a test can drive by moving the part. */
const proximity = near({ source: fixed(0, 0), radius: 0.5 });

/** A signal that reads `k` everywhere. */
const reads =
  (k: number): Signal =>
  () =>
    k;

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

describe('hinge, stops mode', () => {
  it('builds one patch per stop, all at construction', () => {
    const make = vi.fn(() => emits({ gain: 0.5 }));
    const patch = hinge(proximity, make, { stops: 5 });

    expect(make).toHaveBeenCalledTimes(5);
    make.mockClear();

    patch.at(0, partAt(0), NO_CTX);
    patch.at(0, partAt(0.25), NO_CTX);
    expect(make).not.toHaveBeenCalled();
  });

  it('reaches the first and last stop exactly', () => {
    const seen: number[] = [];
    const patch = hinge(
      proximity,
      (k) => {
        seen.push(k);
        return emits({ gain: k });
      },
      { stops: 4 },
    );

    expect(seen).toEqual([0, 1 / 3, 2 / 3, 1]);
    // On the source, so k = 1 and the last stop answers; well past the reach, so k = 0.
    expect(patch.at(0, partAt(0), NO_CTX).gain).toBeCloseTo(1);
    expect(patch.at(0, partAt(5), NO_CTX).gain).toBe(0);
  });

  it('answers a signal landing on a stop with that stop alone', () => {
    const at = vi.fn((k: number) => emits({ gain: k, crawl: k * k }));
    const patch = hinge(reads(0.5), at, { stops: 3 });
    expect(patch.at(0, partAt(0), NO_CTX)).toEqual({ gain: 0.5, crawl: 0.25 });
  });

  // Stops used to snap to the nearest; now the two either side crossfade, channel by channel,
  // which is what `mix.blend` does with the same stops.
  it('crossfades the two stops either side, lerping each channel by the share between them', () => {
    // Stops at k = 0, 0.5 and 1. Built non-linearly in k, so the crossfade at 0.75 differs from
    // what building a stop at 0.75 would give.
    const make = (k: number): EffectPatch =>
      emits({
        gain: k * k,
        crawl: 4 * k,
        position: [k, 0, -2 * k],
        color: k < 1 ? 0xff0000 : 0x0000ff,
        light: { color: 0x00ff00, amount: 2 * k },
      });
    const lo = make(0.5).at(0, partAt(0), NO_CTX);
    const hi = make(1).at(0, partAt(0), NO_CTX);
    const out = hinge(reads(0.75), make, { stops: 3 }).at(0, partAt(0), NO_CTX);

    expect(out.gain).toBeCloseTo(lerp(0.25, 1, 0.5));
    expect(out.gain).not.toBeCloseTo(0.75 * 0.75);
    expect(out.crawl).toBeCloseTo(lerp(2, 4, 0.5));
    expect(out.position?.[0]).toBeCloseTo(0.75);
    expect(out.position?.[1]).toBeCloseTo(0);
    expect(out.position?.[2]).toBeCloseTo(-1.5);
    expect(out.color).toBe(
      (PART_KIT.color as Channel<number>).lerp(lo.color as number, hi.color as number, 0.5),
    );
    expect(out.light?.color).toBe(0x00ff00);
    expect(out.light?.amount).toBeCloseTo(lerp(1, 2, 0.5));
  });

  it('weighs the crossfade by where the signal falls between the two stops', () => {
    const patch = hinge(reads(0.6), (k) => emits({ crawl: 10 * k }), { stops: 3 });
    // 0.6 is a fifth of the way from the 0.5 stop to the 1 stop.
    expect(patch.at(0, partAt(0), NO_CTX).crawl).toBeCloseTo(lerp(5, 10, 0.2));
  });

  it('passes a channel only one of the two stops writes whole', () => {
    const patch = hinge(reads(0.5), (k) => emits(k === 1 ? { gain: 0, dark: 0.8 } : { gain: 1 }), {
      stops: 2,
    });
    const out = patch.at(0, partAt(0), NO_CTX);
    expect(out.gain).toBeCloseTo(0.5);
    expect(out.dark).toBeCloseTo(0.8);
  });

  it('clamps the signal to 0..1 and reads a non-finite one as 0', () => {
    const make = (k: number) => emits({ crawl: k });
    expect(hinge(reads(3), make).at(0, partAt(0), NO_CTX).crawl).toBe(1);
    expect(hinge(reads(-3), make).at(0, partAt(0), NO_CTX).crawl).toBe(0);
    expect(hinge(reads(Number.NaN), make).at(0, partAt(0), NO_CTX).crawl).toBe(0);
    expect(hinge(reads(Number.POSITIVE_INFINITY), make).at(0, partAt(0), NO_CTX).crawl).toBe(0);
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
  // while the wrapper published one period, which is invisible in the source and obvious on
  // screen.
  it('refuses stops that disagree on period, naming both', () => {
    expect(() =>
      hinge(proximity, (k) => emits({ gain: 1 }, k > 0.5 ? 900 : 1000), { stops: 4 }),
    ).toThrow(/disagree on period/);
    expect(() =>
      hinge(proximity, (k) => emits({ gain: 1 }, k > 0.5 ? 900 : 1000), { stops: 4 }),
    ).toThrow(/1000ms.*900ms/s);
  });

  it('passes the phase through untouched, so the inner keeps its own clock', () => {
    const at = vi.fn(() => ({ gain: 1 }));
    const patch = hinge(proximity, () => ({ period: 1000, at }), { stops: 2 });
    patch.at(0.75, partAt(0), NO_CTX);
    expect(at).toHaveBeenCalledWith(0.75, expect.anything(), NO_CTX);
  });

  it('keeps the stops period', () => {
    expect(hinge(proximity, () => emits({ gain: 0 }, 2500)).period).toBe(2500);
  });
});

describe('hinge, continuous mode', () => {
  it('fades gain toward rest with distance', () => {
    const patch = hinge(proximity, emits({ gain: 0 }));
    expect(patch.at(0, partAt(0), NO_CTX).gain).toBeCloseTo(0);
    expect(patch.at(0, partAt(5), NO_CTX).gain).toBeUndefined();

    const mid = patch.at(0, partAt(0.25), NO_CTX).gain as number;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('rests completely past the reach, so turns can hand the part over', () => {
    const patch = hinge(proximity, emits({ gain: 0, color: 0xff0000, crawl: 2 }));
    expect(isRest(patch.at(0, partAt(5), NO_CTX))).toBe(true);
  });

  it('keeps the inner period', () => {
    expect(hinge(proximity, emits({ gain: 0 }, 2500)).period).toBe(2500);
  });

  // What the removed `fade` blend did, now the kit's own `scale`: the same numbers.
  it('scales additive channels toward zero and multiplicative toward one', () => {
    const inner = emits({ gain: 0, scale: 3, crawl: 1, dark: 1, position: [2, 4, 6] });
    const out = hinge(reads(0.5), inner).at(0, partAt(0), NO_CTX);
    expect(out.gain).toBeCloseTo(0.5);
    expect(out.scale).toBeCloseTo(2);
    expect(out.crawl).toBeCloseTo(0.5);
    expect(out.dark).toBeCloseTo(0.5);
    expect(out.position).toEqual([1, 2, 3]);
  });

  it("scales a lamp's amount but keeps its color", () => {
    const out = hinge(reads(0.25), emits({ light: { color: 0x00ff00, amount: 2 } })).at(
      0,
      partAt(0),
      NO_CTX,
    );
    expect(out.light).toEqual({ color: 0x00ff00, amount: 0.5 });
  });

  it('passes color through above zero and drops it at zero', () => {
    const patch = (k: number) => hinge(reads(k), emits({ color: 0x123456 }));
    expect(patch(0.5).at(0, partAt(0), NO_CTX).color).toBe(0x123456);
    expect(patch(0).at(0, partAt(0), NO_CTX)).toEqual({});
  });

  it('reads a non-finite signal as rest rather than as NaN', () => {
    expect(hinge(reads(Number.NaN), emits({ gain: 0 })).at(0, partAt(0), NO_CTX)).toEqual({});
  });
});

/**
 * The contract between the two paths: `EffectFrame` cues a hinged patch as a weighted voice or a
 * `mix.blend` of its stops, and a wrapper such as `roving` asks the patch's `at` directly. Both
 * must land on the same pose.
 */
describe('hinge through EffectFrame', () => {
  const HOST: Host = { pointer: null, pointerInWord: null, now: 0 };
  const PERIOD = 1000;

  /** Bodies stepping out from the source, so the signal reads every weight from 1 down to 0. */
  const POOL: PartInfo[] = Array.from({ length: 12 }, (_, i) => ({
    ...partAt(i * 0.05),
    index: i,
    count: 12,
    letter: { index: i, count: 12 },
  }));

  function expectSamePose(actual: PartPose | undefined, expected: PartPose) {
    expect(actual).toBeDefined();
    const a = actual as PartPose;
    expect(a.gain).toBeCloseTo(expected.gain, 6);
    expect(a.dark).toBeCloseTo(expected.dark, 6);
    expect(a.scale).toBeCloseTo(expected.scale, 6);
    expect(a.crawl).toBeCloseTo(expected.crawl, 6);
    expect(a.color).toBe(expected.color);
    for (let i = 0; i < 3; i++) {
      expect(a.position[i]).toBeCloseTo(expected.position[i] as number, 6);
      expect(a.rotation[i]).toBeCloseTo(expected.rotation[i] as number, 6);
      // A crossfaded lamp of two colors comes back from `at` as one 8-bit color and an amount.
      expect(a.light[i]).toBeCloseTo(expected.light[i] as number, 2);
    }
  }

  function compare(patch: EffectPatch, elapsed: number) {
    const effects = planEffects(
      [{ patch, target: { kind: 'body', by: 'index', amount: 1 } }],
      POOL,
    );
    const out = new EffectFrame(effects).resolve(POOL, elapsed, HOST);
    const phase = (elapsed % PERIOD) / PERIOD;
    POOL.forEach((part, index) => {
      expectSamePose(out.get(index), mergeDeltas([patch.at(phase, part, NO_CTX)]));
    });
  }

  it('gives a weighted patch the same pose as its own at', () => {
    const inner: EffectPatch = {
      period: PERIOD,
      at: (phase, part) => ({
        gain: 0.2 + phase,
        scale: 2,
        dark: 0.6,
        crawl: 3 * phase,
        position: [part.x, 1, 0],
        color: 0xff8800,
        light: { color: 0x3366ff, amount: 1.5 },
      }),
    };
    compare(hinge(proximity, inner), 250);
    compare(hinge(proximity, inner), 1700);
  });

  it('gives crossfaded stops the same pose as asking the hinged patch directly', () => {
    const make = (k: number): EffectPatch => ({
      period: PERIOD,
      at: (phase) => ({
        gain: 1 - k * k * phase,
        crawl: 4 * k,
        position: [k, phase, -k],
        light: { color: k < 0.5 ? 0xff0000 : 0x0000ff, amount: 1 + k },
        ...(k > 0.5 ? { dark: k } : {}),
      }),
    });
    compare(hinge(proximity, make, { stops: 4 }), 250);
    compare(hinge(proximity, make, { stops: 4 }), 1700);
  });
});
