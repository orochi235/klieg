/**
 * The lab's other shape source: a face's own glyphs, laid out on a baseline.
 *
 * `svgToShapeGroups` treats one `<path>` as one letter; this hands the same pipeline the real
 * thing, so a tube knob can be tuned against the letter that misbehaves rather than against art
 * that happens to resemble it.
 */
import opentype from 'opentype.js';
import { glyphToShapes } from '../../packages/core/dist/text/glyphs.js';

/** Every face the main lab ships, served from its public directory by the repo-root dev server. */
export const FACES = [
  'abril-fatface',
  'anton',
  'bebas-neue',
  'black-ops-one',
  'cinzel',
  'lobster',
  'monoton',
  'rye',
];

export const faceUrl = (id) => `/apps/lab/public/fonts/${id}.ttf`;

export async function loadFace(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} — run vite from the repo root, not this directory`);
  return opentype.parse(await res.arrayBuffer());
}

/**
 * One group per letter at 1 em, each carrying the x it sits at — advances and kerning from the
 * face, so the word spaces the way it would when fired.
 */
export function typeToShapeGroups(font, text) {
  const em = font.unitsPerEm;
  const groups = [];
  let pen = 0;
  let prev = null;
  let top = Number.NEGATIVE_INFINITY;
  let bottom = Number.POSITIVE_INFINITY;

  for (const ch of text) {
    const glyph = font.charToGlyph(ch);
    if (prev) pen += font.getKerningValue(prev, glyph) / em;
    const shapes = ch.trim() ? glyphToShapes(font, ch, 1) : [];
    if (shapes.length) {
      groups.push({ shapes, x: pen });
      for (const shape of shapes)
        for (const p of shape.getPoints(24)) {
          top = Math.max(top, p.y);
          bottom = Math.min(bottom, p.y);
        }
    }
    pen += glyph.advanceWidth / em;
    prev = glyph;
  }

  const height = groups.length ? top - bottom : 1;
  return {
    groups,
    width: Math.max(pen, 0.001),
    height: Math.max(height, 0.001),
    /** Where the ink's middle sits above the baseline, which is what centring has to cancel. */
    mid: groups.length ? (top + bottom) / 2 : 0,
  };
}
