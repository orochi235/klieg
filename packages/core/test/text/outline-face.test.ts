import { outlineStatus } from '@weasel-js/font';
import { layoutRuns, resolveRuns, resolveTextStyle } from '@weasel-js/text';
import { describe, expect, it } from 'vitest';
import type { LoadedFont } from '../../src/text/font.js';
import { faceOf, familyFor, registerFace } from '../../src/text/outline-face.js';

const UPEM = 1000;

function stubLoaded(): LoadedFont {
  const font = {
    unitsPerEm: UPEM,
    ascender: 800,
    charToGlyph: (ch: string) => ({
      advanceWidth: ch === ' ' ? 250 : 600,
      getPath: () => ({ commands: ch === ' ' ? [] : [{ type: 'M', x: 0, y: 0 }] }),
    }),
    getKerningValue: () => -20,
  } as unknown as LoadedFont['font'];
  return {
    font,
    unitsPerEm: UPEM,
    metrics: { advanceOf: (ch) => (ch === ' ' ? 250 : 600), kernOf: () => -20 },
    key: '/f.ttf',
    family: 'klieg-test-face',
    bytes: new ArrayBuffer(8),
  };
}

describe('faceOf', () => {
  it('reports advances in em units, not font units', () => {
    expect(faceOf(stubLoaded()).advanceOf('A'.codePointAt(0) as number)).toBeCloseTo(0.6);
  });

  it('reports the ascender in em units', () => {
    expect(faceOf(stubLoaded()).ascender).toBeCloseTo(0.8);
  });

  it('scales kerning to em units too', () => {
    const face = faceOf(stubLoaded());
    expect(face.kernOf(65, 66)).toBeCloseTo(-0.02);
  });

  it('gives a space an advance and no outline', () => {
    const face = faceOf(stubLoaded());
    const sp = ' '.codePointAt(0) as number;
    expect(face.advanceOf(sp)).toBeCloseTo(0.25);
    expect(face.glyphD(sp)).toBeNull();
  });
});

describe('familyFor', () => {
  it('names a family per instance and per font, so two instances cannot collide', () => {
    expect(familyFor(1, 'display')).not.toBe(familyFor(2, 'display'));
    expect(familyFor(1, 'display')).not.toBe(familyFor(1, 'body'));
    expect(familyFor(1, 'display')).toBe(familyFor(1, 'display'));
  });
});

describe('registerFace', () => {
  it('resolves only once the face can actually serve a layout', async () => {
    const family = await registerFace(familyFor(101, 'display'), stubLoaded());

    expect(outlineStatus(family)).toBe('ready');
  });

  it('lays out through weasel once it has resolved', async () => {
    const family = await registerFace(familyFor(102, 'display'), stubLoaded());
    const laid = layoutRuns(
      resolveRuns([{ text: 'A B', fontFamily: family, fontSize: 1 }], resolveTextStyle()),
      { maxWidth: 1e6, lineHeight: 1.1, align: 'left' },
    );

    expect(laid.lines).toHaveLength(1);
    expect(laid.lines[0]?.cells.map((c) => String.fromCodePoint(c.cp))).toEqual(['A', ' ', 'B']);
  });

  it('returns straight away for a face already registered', async () => {
    const first = await registerFace(familyFor(103, 'display'), stubLoaded());
    const second = await registerFace(familyFor(103, 'display'), stubLoaded());

    expect(second).toBe(first);
  });
});
