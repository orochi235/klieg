import { describe, expect, it } from 'vitest';
import type { LoadedFont } from '../../src/text/font.js';
import { faceOf } from '../../src/text/outline-face.js';

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
