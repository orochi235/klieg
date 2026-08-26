import { describe, expect, it } from 'vitest';
import { litEmissive } from '../../src/render/word.js';

describe('litEmissive', () => {
  it('leaves the base alone when no lamp reached the part', () => {
    expect(litEmissive(0x000000, 0xffc44d, [0, 0, 0])).toBe(0x000000);
    expect(litEmissive(0xff2d95, 0xff2d95, [0, 0, 0])).toBe(0xff2d95);
  });

  // A white lamp on gold must reflect gold. Adding white washes it to cream.
  it('multiplies the lamp by the look hue', () => {
    const out = litEmissive(0x000000, 0xff8000, [1, 1, 1]);
    expect((out >> 16) & 0xff).toBe(0xff);
    expect((out >> 8) & 0xff).toBe(0x80);
    expect(out & 0xff).toBe(0x00);
  });

  // neon carries its own glow; a lamp that assigns emissive would delete it off every unlit part.
  it('adds onto the base rather than replacing it', () => {
    const out = litEmissive(0x004000, 0x00ff00, [0.25, 0.25, 0.25]);
    expect((out >> 8) & 0xff).toBeGreaterThan(0x40);
  });

  it('clamps rather than wrapping', () => {
    const out = litEmissive(0xffffff, 0xffffff, [8, 8, 8]);
    expect(out).toBe(0xffffff);
  });

  it('keeps each light channel on its own channel', () => {
    expect(litEmissive(0x000000, 0x40ff80, [0.5, 0, 1])).toBe(0x200080);
  });

  it('adds each light channel onto its own base channel', () => {
    expect(litEmissive(0x102030, 0xffffff, [0, 0, 0.25])).toBe(0x102070);
  });
});
