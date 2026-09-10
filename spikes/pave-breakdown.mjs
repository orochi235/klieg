/**
 * Where a pavé letter's build time actually goes, phase by phase.
 *
 *   npm run build -w klieg && node spikes/pave-breakdown.mjs [letter] [pitch]
 *   node --cpu-prof --cpu-prof-dir=/tmp/prof spikes/pave-breakdown.mjs   # per-function detail
 *
 * `well-cost.mjs` splits the build into cut and fill and sweeps `relax` and `pitch`. It stops at
 * two numbers and never touches the shell, so it cannot say whether the cost is the cell field, the
 * letter body, or the stones. The stones are the interesting one: a set stone is two bands of quads
 * and a triangulated cap, which should be nothing.
 *
 * Runs the shipped functions rather than a model of them. No GL — this is the main-thread block.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import * as THREE from 'three';
import { cutterFor } from '../packages/core/dist/render/wells/cutters.js';
import { fillFor } from '../packages/core/dist/render/wells/fills.js';
import { regionOf } from '../packages/core/dist/render/wells/region.js';
import { buildShell, DEFAULT_SHELL } from '../packages/core/dist/render/wells/shell.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const LETTER = process.argv[2] ?? 'R';
const PITCH = Number(process.argv[3] ?? 0.05);
const RELAX = Number(process.argv[4] ?? 4);

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

/** The `pave` look's own decoration, off the `pave-look` branch. */
const SPEC = {
  kind: 'well',
  cutter: 'pave',
  insets: 'proportional',
  bezel: 0.026,
  floor: 0.07,
  pitch: PITCH,
  wall: 0.008,
  relax: RELAX,
  edge: 'absorb',
  size: 0.048,
  rimBevel: 0.003,
  rimDrop: 0.003,
  look: {},
  fill: 'stone',
  sink: 0.25,
  facets: 8,
  stone: { color: 0xffffff, roughness: 0.04, transmission: 1, ior: 2.4, dispersion: 5 },
};

/** `applyLook` writes flake uniforms the real pipeline attaches when it compiles the shader. */
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

const ms = (fn) => {
  const t = performance.now();
  const out = fn();
  return [performance.now() - t, out];
};

const shapes = glyphToShapes(font, LETTER, 1);

const [regionMs, region] = ms(() => regionOf(shapes, SPEC.insets));
const [cutMs, cut] = ms(() => cutterFor('pave')(shapes, region, SPEC));
const wells = cut.seats.length;

// The rim bead re-derives every pocket at each growth it asks for. Priced apart from the cut
// because it is a repeat of the same clipping, not a different kind of work.
const growths = [0, SPEC.rimBevel, SPEC.rimBevel + SPEC.rimDrop];
const [beadMs] = ms(() => cut.bead?.(growths));

const [shellMs] = ms(() =>
  buildShell(shapes, cut, {
    ...DEFAULT_SHELL,
    depth: 0.3,
    bezel: SPEC.bezel,
    rimBevel: SPEC.rimBevel,
    rimDrop: SPEC.rimDrop,
  }),
);

const [fillMs] = ms(() =>
  fillFor('stone')(
    cut.seats,
    { material: stubMaterial, faceZ: 0, floorZ: -SPEC.floor, girdleZ: -0.003 },
    SPEC,
  ),
);

const total = regionMs + cutMs + beadMs + shellMs + fillMs;
const row = (label, v) =>
  console.log(
    `  ${label.padEnd(22)} ${v.toFixed(1).padStart(8)}ms  ${((v / total) * 100).toFixed(1).padStart(5)}%  ${(v / wells).toFixed(3).padStart(7)}ms/cell`,
  );

console.log(`'${LETTER}' at pitch ${PITCH}, relax ${RELAX}: ${wells} cells\n`);
console.log(`  phase                        ms       share    per cell`);
row('region (insets)', regionMs);
row('cut (cells)', cutMs);
row('bead (pocket regrowth)', beadMs);
row('shell (letter body)', shellMs);
row('fill (stones)', fillMs);
console.log(`  ${'total'.padEnd(22)} ${total.toFixed(1).padStart(8)}ms`);
