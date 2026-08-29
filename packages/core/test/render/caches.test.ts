import type { Font } from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { WordCaches } from '../../src/render/caches.js';
import type { TubeBlueprint, TubeSpec } from '../../src/render/tube/index.js';
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
    key: '/f.ttf',
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

function stubBlueprint(): TubeBlueprint & { disposed: boolean } {
  const bp = {
    kind: 'tube' as const,
    runs: [],
    corners: [],
    paths: [],
    lit: [],
    dark: [],
    disposed: false,
    dispose() {
      bp.disposed = true;
    },
  };
  return bp;
}

const freed = (bp: TubeBlueprint) => (bp as ReturnType<typeof stubBlueprint>).disposed;

describe('WordCaches.takeBlueprint', () => {
  const SPEC = { kind: 'tube' } as unknown as TubeSpec;

  it('rebuilds nothing for a key released and taken again', () => {
    const caches = new WordCaches();
    const font = stubFont();
    let built = 0;
    const take = () =>
      caches.takeBlueprint(font, SPEC, 'A', 0.3, 0, undefined, () => {
        built++;
        return stubBlueprint();
      });
    const first = take();
    caches.releaseBlueprint(first);

    expect(take()).toBe(first);
    expect(built).toBe(1);
  });

  it('discriminates the font, the spec, the char, the depth, the seed and the tint alone', () => {
    const caches = new WordCaches();
    const font = stubFont();
    const other = stubFont();
    const otherSpec = { kind: 'tube' } as unknown as TubeSpec;
    const base = caches.takeBlueprint(font, SPEC, 'A', 0.3, 0, undefined, stubBlueprint);
    caches.releaseBlueprint(base);

    for (const take of [
      () => caches.takeBlueprint(other, SPEC, 'A', 0.3, 0, undefined, stubBlueprint),
      () => caches.takeBlueprint(font, otherSpec, 'A', 0.3, 0, undefined, stubBlueprint),
      () => caches.takeBlueprint(font, SPEC, 'B', 0.3, 0, undefined, stubBlueprint),
      () => caches.takeBlueprint(font, SPEC, 'A', 0.4, 0, undefined, stubBlueprint),
      () => caches.takeBlueprint(font, SPEC, 'A', 0.3, 1, undefined, stubBlueprint),
      () => caches.takeBlueprint(font, SPEC, 'A', 0.3, 0, 0xff0000, stubBlueprint),
    ]) {
      const got = take();
      expect(got).not.toBe(base);
      caches.releaseBlueprint(got);
    }
  });

  it('builds a second blueprint rather than lending one already out, and frees it on release', () => {
    const caches = new WordCaches();
    const font = stubFont();
    const held = caches.takeBlueprint(font, SPEC, 'A', 0.3, 0, undefined, stubBlueprint);
    const borrowed = caches.takeBlueprint(font, SPEC, 'A', 0.3, 0, undefined, stubBlueprint);
    expect(borrowed).not.toBe(held);

    caches.releaseBlueprint(borrowed);
    expect(freed(borrowed)).toBe(true);

    caches.releaseBlueprint(held);
    expect(freed(held)).toBe(false);
  });

  it('disposes every kept blueprint on dispose', () => {
    const caches = new WordCaches();
    const font = stubFont();
    const kept = caches.takeBlueprint(font, SPEC, 'A', 0.3, 0, undefined, stubBlueprint);
    caches.releaseBlueprint(kept);
    caches.dispose();

    expect(freed(kept)).toBe(true);
  });
});
