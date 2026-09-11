/**
 * Whether a font file lays out and extrudes through klieg, before it is offered as a preset.
 *
 *   npm run build -w klieg && node spikes/font-check.mjs <font file> [text]
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { Word } from '../packages/core/dist/render/word.js';
import { familyFor, registerFace } from '../packages/core/dist/text/outline-face.js';

const file = process.argv[2];
const text = process.argv[3] ?? 'FUCK YOU TRAVIS';
const buf = readFileSync(file);
const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const font = opentype.parse(bytes);
const loaded = {
  font,
  unitsPerEm: font.unitsPerEm,
  metrics: {
    advanceOf: (ch) => font.charToGlyph(ch).advanceWidth ?? 0,
    kernOf: (a, b) => font.getKerningValue(font.charToGlyph(a), font.charToGlyph(b)),
  },
  key: 'check',
  bytes,
  family: familyFor(1, 'check'),
};
await registerFace(loaded.family, loaded);

const word = new Word(text, loaded, 'gold', { width: 8, height: 3, cameraZ: 12, extent: 12 });
const read = word.readout();
const drawn = read.chars.filter((ch) => word.glyph(ch, 0.3).attributes.position?.count).length;
console.log(`${font.names.fullName?.en ?? file}: outlines ${font.outlinesFormat}, ${font.glyphs.length} glyphs`);
console.log(`"${text}": ${read.chars.length} slots, ${drawn} drawn, ${word.lineCount} line(s), fit scale ${read.fit.scale.toFixed(3)}`);
const xs = read.x.map((x) => x.toFixed(2)).join(' ');
console.log(`x: ${xs}`);
