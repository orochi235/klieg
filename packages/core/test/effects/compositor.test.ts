import { describe, expect, it } from 'vitest';
import { isRest, mergeOffsets, REST_OFFSET } from '../../src/effects/compositor.js';
import type { Vec3 } from '../../src/pose.js';

describe('mergeOffsets', () => {
  it('is the identity for no offsets', () => {
    expect(mergeOffsets([])).toEqual(REST_OFFSET);
  });

  it('multiplies gain toward 1 rather than summing it', () => {
    expect(mergeOffsets([{ gain: 0.5 }, { gain: 0.5 }]).gain).toBe(0.25);
  });

  it('multiplies scale the same way', () => {
    expect(mergeOffsets([{ scale: 2 }, { scale: 3 }]).scale).toBe(6);
  });

  it('sums position and rotation', () => {
    const out = mergeOffsets([
      { position: [1, 0, 0], rotation: [0, 1, 0] },
      { position: [0, 2, 0], rotation: [0, 0, 3] },
    ]);
    expect(out.position).toEqual([1, 2, 0]);
    expect(out.rotation).toEqual([0, 1, 3]);
  });

  it('sums crawl, so two chases add rather than fight', () => {
    expect(mergeOffsets([{ crawl: 0.25 }, { crawl: 0.5 }]).crawl).toBe(0.75);
  });

  it('takes the strongest dark rather than compounding it', () => {
    expect(mergeOffsets([{ dark: 0.3 }, { dark: 0.9 }, { dark: 0.1 }]).dark).toBe(0.9);
  });

  it('lets the last writer win the colour', () => {
    expect(mergeOffsets([{ color: 0xff0000 }, { color: 0x00ff00 }]).color).toBe(0x00ff00);
  });

  it('leaves colour unset when nobody writes one, so the part keeps its own', () => {
    expect(mergeOffsets([{ gain: 0.5 }]).color).toBeUndefined();
  });

  it('ignores a channel an offset omits', () => {
    expect(mergeOffsets([{ gain: 0.5 }, { color: 0x00ff00 }]).gain).toBe(0.5);
  });

  it('leaves REST_OFFSET alone, so one merge cannot poison the next', () => {
    mergeOffsets([{ position: [1, 2, 3], rotation: [4, 5, 6] }]);
    mergeOffsets([{ position: [1, 2, 3], rotation: [4, 5, 6] }]);
    expect(REST_OFFSET.position).toEqual([0, 0, 0]);
    expect(REST_OFFSET.rotation).toEqual([0, 0, 0]);
    expect(mergeOffsets([])).toEqual({
      gain: 1,
      dark: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
      crawl: 0,
      light: [0, 0, 0],
    });
  });

  it('does not hand back a piece’s own vectors, so a caller cannot write into it', () => {
    const offset = { position: [1, 2, 3] as Vec3, rotation: [4, 5, 6] as Vec3 };
    const out = mergeOffsets([offset]);
    expect(out.position).not.toBe(offset.position);
    out.position[0] = 99;
    out.rotation[0] = 99;
    expect(offset.position).toEqual([1, 2, 3]);
    expect(offset.rotation).toEqual([4, 5, 6]);
  });
});

describe('isRest', () => {
  it('calls an empty offset rest, which is what a piece with nothing to say returns', () => {
    expect(isRest({})).toBe(true);
  });

  it('calls every channel at its identity rest', () => {
    expect(
      isRest({ gain: 1, scale: 1, dark: 0, crawl: 0, position: [0, 0, 0], rotation: [0, 0, 0] }),
    ).toBe(true);
  });

  it('calls any channel off its identity not rest', () => {
    expect(isRest({ gain: 0.5 })).toBe(false);
    expect(isRest({ scale: 1.2 })).toBe(false);
    expect(isRest({ dark: 0.1 })).toBe(false);
    expect(isRest({ crawl: 0.01 })).toBe(false);
    expect(isRest({ position: [0, 0.01, 0] })).toBe(false);
    expect(isRest({ rotation: [0, 0, 0.01] })).toBe(false);
  });

  // A colour is a replacement, not a contribution, so there is no value of it that is "no change" —
  // any colour at all is something a handover would snap away from.
  it('calls a written colour not rest, at any value', () => {
    expect(isRest({ color: 0x000000 })).toBe(false);
    expect(isRest({ color: 0xffffff })).toBe(false);
  });
});

describe('the light channel', () => {
  it('rests at no light', () => {
    expect(mergeOffsets([]).light).toEqual([0, 0, 0]);
  });

  it('scales a lamp colour by its amount', () => {
    const out = mergeOffsets([{ light: { color: 0xff0000, amount: 0.5 } }]);
    expect(out.light[0]).toBeCloseTo(0.5);
    expect(out.light[1]).toBeCloseTo(0);
    expect(out.light[2]).toBeCloseTo(0);
  });

  // Two lamps reaching one part must add. Overwriting would make the second lamp delete the first.
  it('sums lamps of different colours', () => {
    const out = mergeOffsets([
      { light: { color: 0xff0000, amount: 1 } },
      { light: { color: 0x0000ff, amount: 0.25 } },
    ]);
    expect(out.light[0]).toBeCloseTo(1);
    expect(out.light[2]).toBeCloseTo(0.25);
  });

  it('reads a lamp at zero amount as rest', () => {
    expect(isRest({ light: { color: 0xffffff, amount: 0 } })).toBe(true);
    expect(isRest({ light: { color: 0xffffff, amount: 0.1 } })).toBe(false);
  });

  // Red and blue alone would pass with the green byte masked wrong.
  it('decomposes all three channels', () => {
    const out = mergeOffsets([{ light: { color: 0x336699, amount: 1 } }]);
    expect(out.light[0]).toBeCloseTo(0x33 / 255);
    expect(out.light[1]).toBeCloseTo(0x66 / 255);
    expect(out.light[2]).toBeCloseTo(0x99 / 255);
  });
});
