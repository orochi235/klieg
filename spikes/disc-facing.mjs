/**
 * Which way a sequin disc's front face ends up pointing, and what `FrontSide` costs at each `lie`.
 *
 *   npm run build -w klieg && node spikes/disc-facing.mjs
 *
 * A disc is one open face. Culling its back hides only what the letter already hides if every disc
 * faces out of the surface it sits on; where one faces inward, `FrontSide` deletes it instead. That
 * is what sets `LIE_FACES_OUT`. `mean-tilt` is the cost of laying every chunk outward rather than
 * onto the near side of the same plane: the chunks that leaned the other way turn further to get
 * there and end up sitting less flat.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import * as THREE from 'three';
import {
  buildChunkBlueprint,
  chunkMatrices,
  poolFor,
} from '../packages/core/dist/render/decoration.js';
import { LOOKS } from '../packages/core/dist/render/looks.js';
import { buildGlyphGeometry, DEFAULT_GLYPH_OPTIONS } from '../packages/core/dist/text/glyphs.js';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const geometry = buildGlyphGeometry(font, 'O', 1, DEFAULT_GLYPH_OPTIONS);

const SEQUIN = LOOKS.sequin.decoration;
const SEED = 0;
const CAP_FACING = 0.5;

const blueprint = buildChunkBlueprint(geometry, {
  pool: poolFor(SEQUIN),
  bedding: SEQUIN.bedding,
  faceBias: SEQUIN.faceBias,
});

/** Where a sample sits: the cap facing the camera, the one behind it, or the extrusion band. */
function place(nz, pz) {
  if (Math.abs(nz) < CAP_FACING) return 'band';
  return pz >= 0 ? 'front' : 'back';
}

/** The nearest pool sample to a placed chunk, which is the surface it was sewn to. */
function surfaceOf(position) {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let s = 0; s < blueprint.position.length / 3; s++) {
    const d =
      (blueprint.position[s * 3] - position.x) ** 2 +
      (blueprint.position[s * 3 + 1] - position.y) ** 2 +
      (blueprint.position[s * 3 + 2] - position.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

const LIES = [0.4, 0.5, 0.6, 0.7, 0.82, 0.88, 1];
const position = new THREE.Vector3();
const rotation = new THREE.Quaternion();
const scale = new THREE.Vector3();
const face = new THREE.Vector3();
const normal = new THREE.Vector3();

console.log('  lie   region  chunks  face-out  culled-by-FrontSide  mean-tilt  p95-tilt');
for (const [i, lie] of LIES.entries()) {
  const matrices = chunkMatrices(blueprint, { ...SEQUIN, lie }, SEED);
  const tally = { front: [0, 0, 0], back: [0, 0, 0], band: [0, 0, 0] };
  const tilts = { front: [], back: [], band: [] };
  for (const m of matrices) {
    m.decompose(position, rotation, scale);
    const s = surfaceOf(position);
    normal.set(blueprint.normal[s * 3], blueprint.normal[s * 3 + 1], blueprint.normal[s * 3 + 2]);
    face.set(0, 0, 1).applyQuaternion(rotation);
    const region = place(normal.z, blueprint.position[s * 3 + 2]);
    const bucket = tally[region];
    bucket[0]++;
    if (face.dot(normal) > 0) bucket[1]++;
    // The camera looks down -z at the front cap, so a face with no +z component is culled.
    if (face.z <= 0) bucket[2]++;
    // How far off the surface's own plane the chunk ended up, which is what `lie` is for.
    tilts[region].push((Math.acos(Math.min(1, Math.abs(face.dot(normal)))) * 180) / Math.PI);
  }
  for (const region of ['front', 'back', 'band']) {
    const [n, out, culled] = tally[region];
    if (n === 0) continue;
    const sorted = tilts[region].sort((a, b) => a - b);
    const mean = sorted.reduce((sum, t) => sum + t, 0) / n;
    console.log(
      `${lie.toFixed(2).padStart(5)}  ${region.padStart(7)}  ${n.toString().padStart(6)}  ` +
        `${((out / n) * 100).toFixed(1).padStart(7)}%  ${((culled / n) * 100).toFixed(1).padStart(18)}%  ` +
        `${mean.toFixed(1).padStart(8)}°  ${sorted[Math.floor(n * 0.95)].toFixed(1).padStart(7)}°`,
    );
  }
  console.log(`  ${i + 1}/${LIES.length} done`);
}
