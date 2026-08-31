import type { OutlineFace } from '@weasel-js/font';
import type { LoadedFont } from './font.js';

/**
 * The face `layoutRuns` actually calls. Its published `OutlineFace` declares only `unitsPerEm` and
 * `glyphD`, but the layout tier reads `ascender`, `advanceOf` and `kernOf` off the same object —
 * satisfy the declared type alone and every advance comes back undefined.
 */
export interface LayoutFace extends OutlineFace {
  /** Line top to baseline, in em. */
  ascender: number;
  /** Em advance for a code point, or null when the face lacks the glyph. */
  advanceOf(cp: number): number | null;
  kernOf(left: number, right: number): number;
}

/**
 * weasel asks for metrics in em units and by code point; klieg holds them in font units and by
 * character. Nothing here parses — the face is already open.
 */
export function faceOf(loaded: LoadedFont): LayoutFace {
  const upem = loaded.unitsPerEm;
  const charOf = (cp: number) => String.fromCodePoint(cp);
  return {
    unitsPerEm: upem,
    ascender: (loaded.font.ascender ?? upem * 0.8) / upem,
    // klieg tessellates from its own pipeline, so nothing reads this; it satisfies the contract.
    glyphD: (cp) => {
      const path = loaded.font.charToGlyph(charOf(cp)).getPath(0, 0, 1);
      return path.commands.length ? path.toPathData(3) : null;
    },
    advanceOf: (cp) => loaded.metrics.advanceOf(charOf(cp)) / upem,
    kernOf: (left, right) => loaded.metrics.kernOf(charOf(left), charOf(right)) / upem,
  };
}
