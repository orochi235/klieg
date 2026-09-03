/**
 * What a fire() rebuilds that a previous fire() already built.
 *
 *   npm run build -w klieg && node spikes/fire-build-cost.mjs [word] [repeats] [face]
 *
 * Times the CPU-side build a fire pays — extrusion per distinct (char, depth), and tube
 * blueprints, which are per letter because they carry a per-letter seed — with a cache built
 * fresh per fire against the instance-wide `WordCaches` klieg now holds. GL is out of scope here;
 * this is the main-thread block before the first frame, not the draw.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { WordCaches } from '../packages/core/dist/render/caches.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { buildTubeBlueprint } from '../packages/core/dist/render/tube/index.js';
import { DEFAULT_GLYPH_OPTIONS, glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const WORD = process.argv[2] ?? 'JACKPOT!';
const REPEATS = Number(process.argv[3] ?? 5);
const FACE = process.argv[4] ?? 'default';
const DEPTH = DEFAULT_GLYPH_OPTIONS.depth;

const buf = readFileSync(
  FACE === 'default'
    ? new URL('../apps/lab/public/font.ttf', import.meta.url)
    : new URL(`../apps/lab/public/fonts/${FACE}.ttf`, import.meta.url),
);
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

/** `WordCaches` keys on the loaded font object, which is all it reads off one. */
const loaded = { font, unitsPerEm: font.unitsPerEm, metrics: null, bytes };

/** One fire's worth of extrusion, against whichever cache it is handed. */
function extrude(caches) {
  for (const ch of letters) caches.glyph(loaded, ch, DEPTH);
}

/** One fire's worth of blueprints. The seed is the letter slot, so two 'C's differ. */
function sweep(caches) {
  letters.forEach((ch, slot) =>
    caches.takeBlueprint(loaded, tubeSpec, ch, DEPTH, slot, undefined, () =>
      buildTubeBlueprint(shapesOf.get(ch), tubeSpec, DEPTH, slot),
    ),
  );
}

const tubeSpec = specOf('tubing').decoration;
const shapesOf = new Map(distinct.map((ch) => [ch, glyphToShapes(font, ch, 1)]));

console.log('\n--- extrusion (every look pays this) ---');
let coldTotal = 0;
for (let i = 0; i < REPEATS; i++) {
  const caches = new WordCaches();
  const t = ms(() => extrude(caches));
  coldTotal += t;
  console.log(`  fresh cache, fire ${i + 1}/${REPEATS}: ${t.toFixed(1)}ms`);
  caches.dispose();
}

const shared = new WordCaches();
let warmTotal = 0;
for (let i = 0; i < REPEATS; i++) {
  const t = ms(() => extrude(shared));
  warmTotal += t;
  console.log(`  shared cache, fire ${i + 1}/${REPEATS}: ${t.toFixed(1)}ms`);
}

console.log('\n--- tube blueprints (tubing/piping only) ---');
let tubeTotal = 0;
for (let i = 0; i < REPEATS; i++) {
  const caches = new WordCaches();
  const t = ms(() => sweep(caches));
  tubeTotal += t;
  console.log(`  fresh cache, fire ${i + 1}/${REPEATS}: ${t.toFixed(1)}ms`);
  caches.dispose();
}

let tubeWarmTotal = 0;
for (let i = 0; i < REPEATS; i++) {
  // A blueprint is lent to one word at a time, so each fire releases before the next takes.
  const taken = [];
  const t = ms(() => {
    letters.forEach((ch, slot) =>
      taken.push(
        shared.takeBlueprint(loaded, tubeSpec, ch, DEPTH, slot, undefined, () =>
          buildTubeBlueprint(shapesOf.get(ch), tubeSpec, DEPTH, slot),
        ),
      ),
    );
  });
  for (const bp of taken) shared.releaseBlueprint(bp);
  tubeWarmTotal += t;
  console.log(`  shared cache, fire ${i + 1}/${REPEATS}: ${t.toFixed(1)}ms`);
}

const avg = (n) => (n / REPEATS).toFixed(1);
console.log('\n--- per fire, averaged ---');
console.log(`  extrusion, cache per word:     ${avg(coldTotal)}ms`);
console.log(`  extrusion, cache per instance: ${avg(warmTotal)}ms`);
console.log(`  blueprints, cache per word:     ${avg(tubeTotal)}ms  [seeded per letter]`);
console.log(`  blueprints, cache per instance: ${avg(tubeWarmTotal)}ms`);
console.log(`\n  a repeat fire on 'gold' drops ${avg(coldTotal - warmTotal)}ms of the block`);
console.log(`  on 'tubing' it drops ${avg(coldTotal - warmTotal + tubeTotal - tubeWarmTotal)}ms`);
