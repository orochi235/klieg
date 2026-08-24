/**
 * How faithfully a bedded lattice actually places chunks, and where it gives up.
 *
 *   npm run build -w klieg && node spikes/bed-lattice.mjs
 *
 * A site is a rejection, not a snap, so a stray tight enough to look regular is also a stray most
 * draws miss: the sampler tries a fixed number of times and then takes the point wherever it landed.
 * This measures the share of cap samples that reached a site, which is what separates a lattice from
 * an even scatter that merely has a pitch set on it.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { buildChunkBlueprint, poolFor } from '../packages/core/dist/render/decoration.js';
import { buildGlyphGeometry, DEFAULT_GLYPH_OPTIONS } from '../packages/core/dist/text/glyphs.js';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

// The glyph the renderer builds, at the 1 em scale every spec number is written in.
const DEPTH = DEFAULT_GLYPH_OPTIONS.depth;
const geometry = buildGlyphGeometry(font, 'O', 1, DEFAULT_GLYPH_OPTIONS);

const SPEC = { kind: 'chunks', count: 400, size: 0.045, shape: 'disc', align: 0, cluster: 0, proud: 0, lie: 1, faceBias: 8, look: {} };
const BED = { angle: 12, spacing: 0.09, thickness: 0.09, scatter: 1 };

/** Reimplemented here so this measures the field rather than the code that produced it. */
function sits(x, y, bed) {
  const radians = (bed.angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const along = x * cos + y * sin;
  const across = y * cos - x * sin;
  const row = Math.round(across / bed.spacing);
  const offset = row % 2 === 0 ? 0 : bed.pitch / 2;
  const d = Math.hypot(
    along - offset - Math.round((along - offset) / bed.pitch) * bed.pitch,
    across - row * bed.spacing,
  );
  return d <= bed.jitter * bed.pitch;
}

const JITTERS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5];
// Keyed on the normal, as the sampler is: the bevel stands proud of the cap plane, so a z cutoff
// files its samples as band and reports a lattice that looks worse than it is.
const CAP_FACING = 0.5;
const isCap = (bp, s) => Math.abs(bp.normal[s * 3 + 2]) >= CAP_FACING;

console.log('jitter  on-site  coverage  expected-by-chance');
for (const [i, jitter] of JITTERS.entries()) {
  const bed = { ...BED, pitch: 0.09, jitter };
  const blueprint = buildChunkBlueprint(geometry, { pool: poolFor(SPEC), bedding: bed, faceBias: SPEC.faceBias });

  let caps = 0;
  let onSite = 0;
  for (let s = 0; s < blueprint.position.length / 3; s++) {
    if (!isCap(blueprint, s)) continue;
    caps++;
    if (sits(blueprint.position[s * 3], blueprint.position[s * 3 + 1], bed)) onSite++;
  }

  // The share of the bed's own cell a site disc covers: what an unbedded scatter would hit anyway.
  const chance = (Math.PI * (jitter * bed.pitch) ** 2) / (bed.pitch * bed.spacing);
  console.log(
    `${jitter.toFixed(2).padStart(6)}  ${((onSite / caps) * 100).toFixed(1).padStart(6)}%  ` +
      `${caps.toString().padStart(8)}  ${(chance * 100).toFixed(1).padStart(17)}%`,
  );
  console.log(`  ${i + 1}/${JITTERS.length} done`);
}

// How many distinct sites a letter actually offers, which is the count a look should ask for:
// asking for more stacks several chunks on one site and undoes the regularity.
console.log('\npitch  spacing  sites-on-caps');
for (const [i, pitch] of [0.05, 0.06, 0.07, 0.08, 0.09, 0.11].entries()) {
  const bed = { ...BED, pitch, spacing: pitch, jitter: 0.2 };
  const blueprint = buildChunkBlueprint(geometry, { pool: poolFor(SPEC), bedding: bed, faceBias: SPEC.faceBias });
  const radians = (bed.angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const seen = new Set();
  for (let s = 0; s < blueprint.position.length / 3; s++) {
    const x = blueprint.position[s * 3];
    const y = blueprint.position[s * 3 + 1];
    if (!isCap(blueprint, s)) continue;
    const z = blueprint.position[s * 3 + 2];
    const along = x * cos + y * sin;
    const across = y * cos - x * sin;
    const row = Math.round(across / bed.spacing);
    const offset = row % 2 === 0 ? 0 : bed.pitch / 2;
    seen.add(`${Math.sign(z)}:${row}:${Math.round((along - offset) / bed.pitch)}`);
  }
  console.log(`${pitch.toFixed(2).padStart(5)}  ${bed.spacing.toFixed(2).padStart(7)}  ${seen.size.toString().padStart(13)}`);
  console.log(`  ${i + 1}/6 done`);
}
