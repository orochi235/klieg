import type { Font } from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { WordCaches } from '../../src/render/caches.js';
import type { LoadedFont } from '../../src/text/font.js';

const UPEM = 1000;
const ADVANCE = 600;
/** Every letter is a 0.5 em box, so each one builds a real geometry. */
const BOX = (size: number) => [
  { type: 'M', x: 0, y: 0 },
  { type: 'L', x: 0.5 * size, y: 0 },
  { type: 'L', x: 0.5 * size, y: -0.7 * size },
  { type: 'Z' },
];

function stubFont(): LoadedFont {
  const font = {
    unitsPerEm: UPEM,
    charToGlyph: (char: string) => ({
      advanceWidth: ADVANCE,
      getPath: (_x: number, _y: number, size: number) => ({
        commands: char === ' ' ? [] : BOX(size),
      }),
    }),
    getKerningValue: () => 0,
  } as unknown as Font;
  return {
    font,
    unitsPerEm: UPEM,
    metrics: { advanceOf: () => ADVANCE, kernOf: () => 0 },
    bytes: new ArrayBuffer(8),
  };
}

describe('WordCaches.glyph', () => {
  it('returns the same geometry object for a repeated (font, char, depth)', () => {
    const caches = new WordCaches();
    const font = stubFont();
    expect(caches.glyph(font, 'A', 0.3)).toBe(caches.glyph(font, 'A', 0.3));
  });

  it('discriminates the font, the char and the depth one at a time', () => {
    const caches = new WordCaches();
    const font = stubFont();
    const other = stubFont();
    const base = caches.glyph(font, 'A', 0.3);
    expect(caches.glyph(other, 'A', 0.3)).not.toBe(base);
    expect(caches.glyph(font, 'B', 0.3)).not.toBe(base);
    expect(caches.glyph(font, 'A', 0.4)).not.toBe(base);
  });

  it('disposes every geometry it built and refuses to build after dispose', () => {
    const caches = new WordCaches();
    const font = stubFont();
    const geo = caches.glyph(font, 'A', 0.3);
    let disposed = false;
    geo.addEventListener('dispose', () => {
      disposed = true;
    });
    caches.dispose();
    expect(disposed).toBe(true);
    expect(() => caches.glyph(font, 'A', 0.3)).toThrow(/after dispose/);
  });
});
