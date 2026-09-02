import type { Font } from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { WordCaches } from '../../src/render/caches.js';
import type { TubeBlueprint, TubeSpec } from '../../src/render/tube/index.js';
import type { LoadedFont } from '../../src/text/font.js';
import { DEFAULT_GLYPH_OPTIONS } from '../../src/text/glyphs.js';

const STUB_FAMILY = 'klieg-test-caches';
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
        toPathData: () => 'M0 0',
      }),
    }),
    getKerningValue: () => 0,
  } as unknown as Font;
  return {
    font,
    unitsPerEm: UPEM,
    key: '/f.ttf',
    family: STUB_FAMILY,
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

// A host that knows its corpus can pay for every glyph it will ever draw before the first fire.
describe('WordCaches.preheat', () => {
  it('builds one geometry per distinct char', () => {
    const caches = new WordCaches();
    expect(caches.preheat(stubFont(), 'ABC')).toBe(3);
    expect(caches.size).toBe(3);
  });

  it('counts a char once however often the corpus repeats it', () => {
    expect(new WordCaches().preheat(stubFont(), 'AAAA')).toBe(1);
  });

  it('builds nothing the second time, which is what makes it a preheat', () => {
    const caches = new WordCaches();
    const font = stubFont();
    caches.preheat(font, 'ABC');
    expect(caches.preheat(font, 'ABC')).toBe(0);
    expect(caches.size).toBe(3);
  });

  // The claim worth pinning: a preheated glyph is the one a fire finds, not a parallel copy in a
  // cache nothing reads. A letter is built at the library's own depth, not at the look's.
  it('warms the entry a fire then hits', () => {
    const caches = new WordCaches();
    const font = stubFont();
    caches.preheat(font, 'A');
    const warmed = caches.glyph(font, 'A', DEFAULT_GLYPH_OPTIONS.depth);
    expect(caches.size).toBe(1);
    expect(caches.glyph(font, 'A', DEFAULT_GLYPH_OPTIONS.depth)).toBe(warmed);
  });

  it('takes a char with no outline without throwing, because a corpus carries spaces', () => {
    expect(() => new WordCaches().preheat(stubFont(), " 'A")).not.toThrow();
  });

  it('refuses a disposed cache the way every other entry point does', () => {
    const caches = new WordCaches();
    caches.dispose();
    expect(() => caches.preheat(stubFont(), 'A')).toThrow('WordCaches used after dispose');
  });
});
