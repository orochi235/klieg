/**
 * What a well-cut letter costs to build on the main thread, per cutter, stage by stage.
 *
 *   npm run build -w klieg && node spikes/well-cost.mjs [word] [face] [--cutters tile,lattice,pave]
 *
 * Every stage a letter pays before its first frame: the region (the distance field `lattice` and
 * `pave` read, and `tile` never builds), the cut, the shell stitched around the wells, and the
 * stone fill. Quote the total, not a stage — a stage on its own has been mistaken for the pipeline
 * more than once. Cutting and filling are pure geometry, so this runs without GL.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import * as THREE from 'three';
import { cutterFor } from '../packages/core/dist/render/wells/cutters.js';
import { fillFor } from '../packages/core/dist/render/wells/fills.js';
import { lazyRegion, regionOf } from '../packages/core/dist/render/wells/region.js';
import { buildShell, DEFAULT_SHELL, shellPlanes } from '../packages/core/dist/render/wells/shell.js';
import { DEFAULT_GLYPH_OPTIONS, glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--cutters'));
const WORD = positional[0] ?? 'FUCK YOU TRAVIS';
const FACE = positional[1] ?? 'default';
const CUTTERS = (process.argv[process.argv.indexOf('--cutters') + 1] ?? '').includes(',') ||
  process.argv.includes('--cutters')
  ? process.argv[process.argv.indexOf('--cutters') + 1].split(',')
  : ['tile', 'lattice', 'pave'];

const buf = readFileSync(
  FACE === 'default'
    ? new URL('../apps/lab/public/font.ttf', import.meta.url)
    : new URL(`../apps/lab/public/fonts/${FACE}.ttf`, import.meta.url),
);
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const SPEC = {
  kind: 'well',
  bezel: 0.012,
  insets: 'proportional',
  floor: 0.09,
  pitch: 0.055,
  size: 0.048,
  look: {},
  fill: 'stone',
  tint: 0.5,
  sink: 0.25,
  // Under half the wall, so neighboring pockets' rims never meet on the face.
  rimBevel: 0.003,
  rimDrop: 0.003,
};

const chars = [...new Set([...WORD].filter((c) => c.trim()))];
console.log(`word "${WORD}": ${[...WORD].filter((c) => c.trim()).length} letters, ${chars.length} distinct\n`);

const pad = (s, w) => String(s).padEnd(w);
const f1 = (n, w) => n.toFixed(1).padStart(w);

/** `applyLook` writes flake uniforms the real pipeline attaches when it compiles the shader. */
const material = () => {
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

const depth = DEFAULT_GLYPH_OPTIONS.depth;
for (const cutter of CUTTERS) {
  const cut = cutterFor(cutter);
  const fill = fillFor('stone');
  const spec = { ...SPEC, cutter };
  const sum = [0, 0, 0, 0];
  let wells = 0;
  console.log(`--- ${cutter} ---`);
  console.log('     n/N  ch    region       cut     shell      fill     total  wells');
  for (const [i, char] of chars.entries()) {
    const shapes = glyphToShapes(font, char, 1);
    const t0 = performance.now();
    // What `WellBuilder` hands a cutter: built on first read, so `tile` never pays for it.
    const region = cutter === 'tile' ? lazyRegion(shapes, spec.insets) : regionOf(shapes, spec.insets);
    const t1 = performance.now();
    const result = cut(shapes, region, spec);
    const t2 = performance.now();
    const shell = buildShell(shapes, result, {
      ...DEFAULT_SHELL,
      depth,
      bezel: spec.bezel,
      rimBevel: spec.rimBevel,
      rimDrop: spec.rimDrop,
    });
    const t3 = performance.now();
    const planes = shellPlanes(depth, spec.floor, spec.bezel);
    const filled = fill(
      result.seats,
      { material, faceZ: planes.faceZ, floorZ: planes.floorZ, girdleZ: planes.faceZ - spec.rimDrop },
      spec,
    );
    const t4 = performance.now();
    const stages = [t1 - t0, t2 - t1, t3 - t2, t4 - t3];
    stages.forEach((ms, k) => {
      sum[k] += ms;
    });
    wells += result.seats.length;
    console.log(
      `  ${pad(`${i + 1}/${chars.length}`, 6)} ${pad(char, 3)}${stages.map((ms) => f1(ms, 8)).join('  ')}  ${f1(t4 - t0, 8)}  ${String(result.seats.length).padStart(5)}`,
    );
    shell.geometry.dispose();
    filled.geometry?.dispose?.();
  }
  const total = sum.reduce((a, b) => a + b, 0);
  console.log(`  total      ${sum.map((ms) => f1(ms, 8)).join('  ')}  ${f1(total, 8)}  ${String(wells).padStart(5)}`);
  console.log(`  every letter, uncached: ${f1((total / chars.length) * [...WORD].filter((c) => c.trim()).length, 8)}ms\n`);
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
