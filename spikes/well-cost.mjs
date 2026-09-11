/**
 * What a well-cut letter costs to build on the main thread, per cutter and per fill.
 *
 *   npm run build -w klieg && node spikes/well-cost.mjs [word] [face]
 *
 * The question a shipped look has to answer: can `lattice` and `pave` be fired the way `gold` is,
 * or is the block before the first frame long enough that they need their own handling. Cutting
 * and filling are pure geometry, so this runs without GL — it is the CPU block, not the draw.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import * as THREE from 'three';
import { cutterFor } from '../packages/core/dist/render/wells/cutters.js';
import { fillFor } from '../packages/core/dist/render/wells/fills.js';
import { regionOf } from '../packages/core/dist/render/wells/region.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const WORD = process.argv[2] ?? 'FUCK YOU TRAVIS';
const FACE = process.argv[3] ?? 'default';

const buf = readFileSync(
  FACE === 'default'
    ? new URL('../apps/lab/public/font.ttf', import.meta.url)
    : new URL(`../apps/lab/public/fonts/${FACE}.ttf`, import.meta.url),
);
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const SPEC = {
  kind: 'well',
  bezel: 0.012,
  floor: 0.09,
  pitch: 0.055,
  size: 0.048,
  look: {},
  fill: 'stone',
  tint: 0.5,
  sink: 0.25,
};

const chars = [...new Set([...WORD].filter((c) => c.trim()))];
console.log(`word "${WORD}": ${[...WORD].filter((c) => c.trim()).length} letters, ${chars.length} distinct\n`);

const pad = (s, w) => String(s).padEnd(w);
const f1 = (n, w) => n.toFixed(1).padStart(w);

for (const cutter of ['lattice', 'pave']) {
  const cut = cutterFor(cutter);
  const fill = fillFor('stone');
  let cutMs = 0;
  let fillMs = 0;
  let wells = 0;
  console.log(`--- ${cutter} ---`);
  for (const [i, char] of chars.entries()) {
    const shapes = glyphToShapes(font, char, 1);
    const region = regionOf(shapes, 'proportional');
    const t0 = performance.now();
    const result = cut(shapes, region, { ...SPEC, cutter });
    const t1 = performance.now();
    const filled = fill(
      result.seats,
      {
        // `applyLook` writes flake uniforms straight into `userData.flake`, which the real
        // pipeline attaches when it compiles the shader. Stubbed here so the fill runs without GL.
        material: () => {
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
        },
        faceZ: 0,
        floorZ: -SPEC.floor,
        girdleZ: -0.003,
      },
      { ...SPEC, cutter },
    );
    const t2 = performance.now();
    cutMs += t1 - t0;
    fillMs += t2 - t1;
    wells += result.seats.length;
    console.log(`  ${pad(`${i + 1}/${chars.length}`, 6)} ${pad(char, 3)} ${f1(t1 - t0, 7)}ms cut  ${f1(t2 - t1, 7)}ms fill  ${String(result.seats.length).padStart(4)} wells`);
    filled.geometry?.dispose?.();
  }
  const perWord = ((cutMs + fillMs) / chars.length) * [...WORD].filter((c) => c.trim()).length;
  console.log(`  distinct total: ${f1(cutMs, 7)}ms cut + ${f1(fillMs, 7)}ms fill, ${wells} wells`);
  console.log(`  a whole word, cached per distinct char: ${f1(cutMs + fillMs, 7)}ms`);
  console.log(`  uncached, every letter cut: ${f1(perWord, 7)}ms\n`);
}

/**
 * Where pavé's time goes. `relax` is Lloyd iteration over the whole cell field, so it is the first
 * thing to suspect and the one knob that could move the cost by an order of magnitude.
 */
if (process.argv.includes('--relax')) {
  const cut = cutterFor('pave');
  console.log('--- pave, relax sweep on one letter ---');
  console.log('relax    cut      wells');
  for (const relax of [0, 1, 2, 3, 4, 6]) {
    const shapes = glyphToShapes(font, 'R', 1);
    const region = regionOf(shapes, 'proportional');
    const t0 = performance.now();
    const result = cut(shapes, region, { ...SPEC, cutter: 'pave', relax });
    const ms = performance.now() - t0;
    console.log(`${String(relax).padStart(5)}  ${f1(ms, 7)}ms  ${String(result.seats.length).padStart(5)}`);
  }
}

/** Cost against cell count. `pitch` is what sets how many cells a letter holds. */
if (process.argv.includes('--pitch')) {
  const cut = cutterFor('pave');
  console.log('--- pave, pitch sweep on one letter (relax 0) ---');
  console.log('pitch     cut    wells   ms/well');
  for (const pitch of [0.055, 0.07, 0.09, 0.12, 0.16, 0.22]) {
    const shapes = glyphToShapes(font, 'R', 1);
    const region = regionOf(shapes, 'proportional');
    const t0 = performance.now();
    const r = cut(shapes, region, { ...SPEC, cutter: 'pave', pitch, relax: 0 });
    const ms = performance.now() - t0;
    console.log(`${pitch.toFixed(3)}  ${f1(ms, 7)}ms  ${String(r.seats.length).padStart(5)}  ${f1(ms / Math.max(1, r.seats.length), 8)}`);
  }
}

/**
 * What the region itself costs. The per-cutter figures above start after `regionOf`, so they leave
 * out work every well-cut letter pays before a cutter is even called — and `proportional` insets
 * add `strokeWidths` over the whole distance field on top.
 */
if (process.argv.includes('--region')) {
  console.log('--- regionOf, per distinct letter ---');
  console.log('insets        shapes    region    total');
  for (const insets of ['uniform', 'proportional']) {
    let shapeMs = 0;
    let regionMs = 0;
    for (const char of chars) {
      const t0 = performance.now();
      const shapes = glyphToShapes(font, char, 1);
      const t1 = performance.now();
      regionOf(shapes, insets);
      const t2 = performance.now();
      shapeMs += t1 - t0;
      regionMs += t2 - t1;
    }
    console.log(
      `${insets.padEnd(14)}${f1(shapeMs, 6)}ms ${f1(regionMs, 8)}ms ${f1(shapeMs + regionMs, 8)}ms`,
    );
  }
}
