import { describe, expect, it } from 'vitest';
import { hueColor, luma } from '../../src/effects/luminance.js';

/** How far a packed colour's luma may sit from the target: 8-bit rounding, three channels. */
const TOLERANCE = 0.005;

const SAMPLES = 360;

function lumaOfHex(hex: number): number {
  return luma(((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255);
}

describe('luma', () => {
  it('is the Rec.709 dot product the bloom threshold reads', () => {
    expect(luma(1, 1, 1)).toBeCloseTo(1, 10);
    expect(luma(0, 0, 0)).toBeCloseTo(0, 10);
    expect(luma(0, 1, 0)).toBeCloseTo(0.7152, 10);
    expect(luma(0, 0, 1)).toBeCloseTo(0.0722, 10);
  });
});

describe('hueColor', () => {
  it('holds its target luma all the way round the wheel', () => {
    for (let n = 0; n < SAMPLES; n++) {
      expect(Math.abs(lumaOfHex(hueColor(n / SAMPLES, 0.5)) - 0.5)).toBeLessThan(TOLERANCE);
    }
  });

  it('holds a bright target too, where every hue but yellow needs whitening', () => {
    for (let n = 0; n < SAMPLES; n++) {
      expect(Math.abs(lumaOfHex(hueColor(n / SAMPLES, 0.8)) - 0.8)).toBeLessThan(TOLERANCE);
    }
  });

  it('wraps, so a sweep past 1 turn is continuous', () => {
    expect(hueColor(1.25, 0.5)).toBe(hueColor(0.25, 0.5));
    expect(hueColor(-0.75, 0.5)).toBe(hueColor(0.25, 0.5));
  });

  it('actually travels: a wheel of samples is many distinct colours, not one', () => {
    const seen = new Set(Array.from({ length: SAMPLES }, (_, n) => hueColor(n / SAMPLES, 0.5)));
    expect(seen.size).toBeGreaterThan(SAMPLES * 0.8);
  });

  // The trade the module exists to make: a hue darker than the target gives up saturation, and
  // blue is the darkest hue there is. Asserted as a channel floor rather than by eye.
  it('pales a blue up to a bright target rather than leaving it dark', () => {
    const blue = hueColor(2 / 3, 0.8);
    expect(blue & 0xff).toBeGreaterThan(200);
    expect((blue >> 16) & 0xff).toBeGreaterThan(120);
  });

  it('keeps a red saturated at a target it already clears', () => {
    const red = hueColor(0, 0.2);
    expect((red >> 16) & 0xff).toBeGreaterThan(200);
    expect((red >> 8) & 0xff).toBeLessThan(20);
  });

  it('stays inside 24 bits at either extreme of the target', () => {
    for (const target of [0, 1]) {
      for (let n = 0; n < 24; n++) {
        const hex = hueColor(n / 24, target);
        expect(hex).toBeGreaterThanOrEqual(0);
        expect(hex).toBeLessThanOrEqual(0xffffff);
      }
    }
  });
});
