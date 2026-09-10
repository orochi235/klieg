/**
 * What a whole pavé word costs to build, glyph by glyph, in this process's own CPU time.
 *
 *   npm run build -w klieg && node spikes/pave-word.mjs ["FUCK YOU TRAVIS"] [pitch]
 *
 * CPU time rather than wall clock: `process.cpuUsage` counts only what this process spent, so a
 * box running other sessions cannot inflate it the way it inflates `performance.now()`. It still
 * moves with clock speed and cache, so read it to a few percent, not to the millisecond.
 *
 * Distinct characters only. `WellBuilder` answers a body per character rather than per letter
 * slot, so a word pays for each character once however often it repeats.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import * as THREE from 'three';
import { cutterFor } from '../packages/core/dist/render/wells/cutters.js';
import { fillFor } from '../packages/core/dist/render/wells/fills.js';
import { regionOf } from '../packages/core/dist/render/wells/region.js';
import { buildShell, DEFAULT_SHELL } from '../packages/core/dist/render/wells/shell.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const WORD = process.argv[2] ?? 'FUCK YOU TRAVIS';
const PITCH = Number(process.argv[3] ?? 0.05);

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const SPEC = {
  kind: 'well',
  cutter: 'pave',
  insets: 'proportional',
  bezel: 0.026,
  floor: 0.07,
  pitch: PITCH,
  wall: 0.008,
  relax: 4,
  edge: 'absorb',
  size: 0.048,
  rimBevel: 0.003,
  rimDrop: 0.003,
  look: {},
  fill: 'stone',
  sink: 0.25,
};

const stubMaterial = () => {
  const m = new THREE.MeshPhysicalMaterial();
  m.userData.flake = {
    uFlakeDensity: { value: 0 },
    uFlakeSize: { value: 0 },
    uFlakeSpread: { value: 0 },
    uFlakeBump: { value: 0 },
    uFlakeGloss: { value: 0 },
    uFlakeColor: { value: new THREE.Color() },
    uFlakeColorMix: { value: 0 },
  };
  return m;
};

const cpuMs = (fn) => {
  const before = process.cpuUsage();
  fn();
  const d = process.cpuUsage(before);
  return (d.user + d.system) / 1000;
};

const letters = [...WORD].filter((c) => c.trim());
const distinct = [...new Set(letters)];
console.log(`"${WORD}": ${letters.length} letters, ${distinct.length} distinct, pitch ${PITCH}\n`);
console.log('         cpu ms  cells');

let total = 0;
let cells = 0;
for (const [i, char] of distinct.entries()) {
  const shapes = glyphToShapes(font, char, 1);
  let n = 0;
  const ms = cpuMs(() => {
    const region = regionOf(shapes, SPEC.insets);
    const cut = cutterFor('pave')(shapes, region, SPEC);
    buildShell(shapes, cut, {
      ...DEFAULT_SHELL,
      depth: 0.3,
      bezel: SPEC.bezel,
      rimBevel: SPEC.rimBevel,
      rimDrop: SPEC.rimDrop,
    });
    fillFor('stone')(
      cut.seats,
      { material: stubMaterial, faceZ: 0, floorZ: -SPEC.floor, girdleZ: -0.003 },
      SPEC,
    );
    n = cut.seats.length;
  });
  total += ms;
  cells += n;
  console.log(
    `  ${`${i + 1}/${distinct.length}`.padEnd(6)} ${char}  ${ms.toFixed(0).padStart(6)}  ${String(n).padStart(5)}`,
  );
}
console.log(`\n  word    ${total.toFixed(0).padStart(6)}ms  ${String(cells).padStart(5)} cells`);
console.log(`  mean    ${(total / distinct.length).toFixed(0).padStart(6)}ms a glyph`);
