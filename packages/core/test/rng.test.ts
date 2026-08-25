import { describe, expect, it } from 'vitest';
import { rng } from '../src/rng.js';

// Pins the stream itself, not just its shape. Every seeded look in the library is reproducible
// only while these exact numbers come out, and a visual baseline would report a drifted generator
// as "a look changed" rather than pointing here.
const FROM_ONE = [
  0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741,
  0.9683778982143849,
];

describe('rng', () => {
  it('emits the mulberry32 stream for a known seed', () => {
    const next = rng(1);
    expect(FROM_ONE.map(() => next())).toEqual(FROM_ONE);
  });

  it('gives the same stream twice for the same seed', () => {
    const a = rng(12345);
    const b = rng(12345);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('separates seeds that differ by one', () => {
    expect(rng(7)()).not.toBe(rng(8)());
  });

  it('stays inside [0, 1)', () => {
    const next = rng(99);
    for (let i = 0; i < 5000; i++) {
      const v = next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('treats a negative or fractional seed as its uint32 coercion', () => {
    expect(rng(-1)()).toBe(rng(0xffffffff)());
  });
});
