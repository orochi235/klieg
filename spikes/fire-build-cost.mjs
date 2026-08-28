/**
 * What a fire() rebuilds that a previous fire() already built.
 *
 *   npm run build -w klieg && node spikes/fire-build-cost.mjs [word] [repeats]
 *
 * GlyphCache is a Word field, so it dies with the word: firing the same text twice re-extrudes
 * every glyph. This times the CPU-side build a fire pays — extrusion per distinct (char, depth),
 * and tube blueprints, which are per letter because they carry a per-letter seed — against the
 * same work with one cache shared across fires. GL is out of scope here; this is the main-thread
 * block before the first frame, not the draw.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { buildTubeBlueprint } from '../packages/core/dist/render/tube/index.js';
import {
  buildGlyphGeometry,
  DEFAULT_GLYPH_OPTIONS,
  GlyphCache,
  glyphToShapes,
} from '../packages/core/dist/text/glyphs.js';

const WORD = process.argv[2] ?? 'JACKPOT!';
const REPEATS = Number(process.argv[3] ?? 5);
const DEPTH = DEFAULT_GLYPH_OPTIONS.depth;

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const t0 = performance.now();
const font = opentype.parse(bytes);
const parseMs = performance.now() - t0;
console.log(`parse ${(bytes.byteLength / 1024).toFixed(0)}KB font: ${parseMs.toFixed(1)}ms`);

const letters = Array.from(WORD);
const distinct = [...new Set(letters)];
console.log(`word ${JSON.stringify(WORD)}: ${letters.length} letters, ${distinct.length} distinct`);

const ms = (fn) => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};

/** One fire's worth of extrusion, against whichever cache it is handed. */
function extrude(cache) {
  for (const ch of letters) cache.get(ch, DEPTH);
}

const newCache = () =>
  new GlyphCache((char, depth) =>
    buildGlyphGeometry(font, char, 1, { ...DEFAULT_GLYPH_OPTIONS, depth }),
  );

console.log('\n--- extrusion (every look pays this) ---');
let coldTotal = 0;
for (let i = 0; i < REPEATS; i++) {
  const cache = newCache();
  const t = ms(() => extrude(cache));
  coldTotal += t;
  console.log(`  cold fire ${i + 1}/${REPEATS}: ${t.toFixed(1)}ms`);
  cache.dispose();
}

const shared = newCache();
let warmTotal = 0;
for (let i = 0; i < REPEATS; i++) {
  const t = ms(() => extrude(shared));
  warmTotal += t;
  console.log(`  shared fire ${i + 1}/${REPEATS}: ${t.toFixed(1)}ms`);
}

console.log('\n--- tube blueprints (tubing/piping only) ---');
const tubeSpec = specOf('tubing').decoration;
const shapesOf = new Map(distinct.map((ch) => [ch, glyphToShapes(font, ch, 1)]));
let tubeTotal = 0;
for (let i = 0; i < REPEATS; i++) {
  const t = ms(() => {
    // Per letter, not per char: the seed is the letter slot, so two 'C's differ.
    letters.forEach((ch, slot) =>
      buildTubeBlueprint(shapesOf.get(ch), tubeSpec, DEPTH, slot * 7919),
    );
  });
  tubeTotal += t;
  console.log(`  fire ${i + 1}/${REPEATS}: ${t.toFixed(1)}ms`);
}

const avg = (n) => (n / REPEATS).toFixed(1);
console.log('\n--- per fire, averaged ---');
console.log(`  extrusion, cache per word (today): ${avg(coldTotal)}ms`);
console.log(`  extrusion, cache per instance:     ${avg(warmTotal)}ms`);
console.log(`  tube blueprints (tubing look):     ${avg(tubeTotal)}ms  [seeded per letter]`);
console.log(`\n  a repeat fire on 'gold' would drop ${avg(coldTotal - warmTotal)}ms of the block`);
console.log(`  on 'tubing' the blueprints stay, so ${avg(tubeTotal)}ms of it survives any cache`);
