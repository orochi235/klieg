/**
 * How far the lamp is from the cursor, and why, in the word's own layout space.
 *
 *   npm run build -w klieg && node spikes/lamp-registration.mjs [word] [look]
 *
 * Two errors stack, and they are separate bugs. `pointerFrame` maps the canvas' whole -1..1 onto
 * the word's *ink* box, while `lamp` measures distance to each part's *origin* — and on a single
 * line every origin shares the baseline, so the cursor's y ranges over a height no part has. This
 * prints what that costs as a fraction of a lamp's reach, which is the number that decides whether
 * the y frame or the x stretch is worth fixing first.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { familyFor, registerFace } from '../packages/core/dist/text/outline-face.js';
import { Word } from '../packages/core/dist/render/word.js';

const WORD = process.argv[2] ?? 'klieg';
const LOOK = process.argv[3] ?? 'gold';
const RADIUS = 0.5; // lamp's default reach, em of layout space
const BUDGET = { width: 8, height: 3, cameraZ: 12, extent: 12 };

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const font = opentype.parse(bytes);
// Hand-built rather than through `loadFont`, which fetches. An unregistered face lays out
// nothing at all and says nothing about why, so the registration is the load-bearing line.
const loaded = {
  font,
  unitsPerEm: font.unitsPerEm,
  metrics: {
    advanceOf: (ch) => font.charToGlyph(ch).advanceWidth ?? 0,
    kernOf: (a, b) => font.getKerningValue(font.charToGlyph(a), font.charToGlyph(b)),
  },
  key: 'spike',
  bytes,
  family: familyFor(1, 'spike'),
};
await registerFace(loaded.family, loaded);

const word = new Word(WORD, loaded, LOOK, BUDGET, false);
const extent = word.partExtent();
const parts = word.parts;

const ys = [...new Set(parts.map((p) => +p.y.toFixed(6)))].sort((a, b) => a - b);
const xs = [...new Set(parts.map((p) => +p.x.toFixed(6)))].sort((a, b) => a - b);
const inkH = extent.maxY - extent.minY;
const inkW = extent.maxX - extent.minX;

const inkKeys = new Set(
  parts.map((p) => `${p.ink.minX.toFixed(4)}|${p.ink.maxX.toFixed(4)}|${p.ink.minY.toFixed(4)}`),
);
console.log(
  `'${WORD}' @ ${LOOK}: ${parts.length} parts, ${xs.length} distinct origin x, ${inkKeys.size} distinct ink boxes, ${ys.length} distinct origin y`,
);
console.log(`  ink box   x ${extent.minX.toFixed(3)}..${extent.maxX.toFixed(3)} (${inkW.toFixed(3)} em)`);
console.log(`            y ${extent.minY.toFixed(3)}..${extent.maxY.toFixed(3)} (${inkH.toFixed(3)} em)`);
console.log(`  origin y  ${ys.map((y) => y.toFixed(3)).join(', ')}`);

// `origin` is what `lamp` measured to before `PartInfo.ink` existed; `ink` is what it measures to
// now. Both are printed because the gap between them is the whole defect.
const inkCentreY = parts.map((p) => (p.ink.minY + p.ink.maxY) / 2);
const nearest = (from, pointerY) => Math.min(...from.map((y) => Math.abs(pointerY - y)));
const pct = (d) => `${((d / RADIUS) * 100).toFixed(0)}%`;
const flag = (d) => (d >= RADIUS ? ' DARK' : '     ');

console.log('  cursor y              to origin        to ink centre');
for (const [label, py] of [
  ['top of ink', extent.maxY],
  ['bottom of ink', extent.minY],
  ['middle', (extent.maxY + extent.minY) / 2],
]) {
  const o = nearest(ys, py);
  const i = nearest(inkCentreY, py);
  console.log(
    `  ${label.padEnd(14)} ${py.toFixed(3).padStart(6)}  ${o.toFixed(3)} em ${pct(o).padStart(4)}${flag(o)}  ${i.toFixed(3)} em ${pct(i).padStart(4)}${flag(i)}`,
  );
}

// x is no longer this spike's to measure: the cursor maps through the visible frustum at the
// word's plane, which needs a camera. `a cursor lands on the letter it is over` in
// test/render/word.test.ts covers it end to end.
console.log(`  ink is ${inkW.toFixed(3)} em wide; x registration is covered by word.test.ts`);

word.dispose();
