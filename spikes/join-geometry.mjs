/**
 * The per-vertex geometry of a run that bends tighter than rho_min.
 *
 *   npm run build -w klieg && node spikes/join-geometry.mjs <look> <letter> <source>
 *
 * Prints step, turn and local bend radius for every vertex, with the fillet stage's authored points
 * marked, so a failure can be attributed to the arc or to the junction that splices it in. Written
 * to answer why the `.AA` runs bend wrong: the arc is sampled at half `spacing` and the legs at
 * `spacing`, and nothing reconciles the segment between them.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { minBendRadius } from '../packages/core/dist/render/tube/bend.js';
import { buildTubeBlueprint } from '../packages/core/dist/render/tube/index.js';
import { minCurvatureRadius3 } from '../packages/core/dist/render/tube/resample.js';
import { smoothedPoints, tightestBend } from '../packages/core/dist/render/tube/sweep.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';
const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const [look, ch, source] = [process.argv[2], process.argv[3], process.argv[4]];
const base = { ...specOf(look).decoration, amplitude: 0, pathSource: source };
const rhoMin = minBendRadius(base.radius, base.bend), r = base.radius;
const bp = buildTubeBlueprint(glyphToShapes(font, ch, 1), base, 0.3, 0);
for (const run of bp.runs) {
  if (tightestBend(run) >= rhoMin * (1 - 1e-6)) continue;
  console.log(`\n${look} ${ch} run ${run.index} (${source})  rho_min ${(rhoMin / r).toFixed(2)}r`);
  console.log('   i  authored   step from prev   turn deg   rho(i-1,i,i+1)');
  const p = run.points;
  for (let i = 0; i < p.length; i++) {
    const step = i ? p[i].distanceTo(p[i - 1]) : 0;
    let turn = 0, rho = Infinity;
    if (i > 0 && i + 1 < p.length) {
      const a = p[i].clone().sub(p[i - 1]).normalize(), b = p[i + 1].clone().sub(p[i]).normalize();
      turn = (Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) * 180) / Math.PI;
      rho = minCurvatureRadius3([p[i - 1], p[i], p[i + 1]].map((q) => ({ x: q.x, y: q.y, z: q.z })));
    }
    const flag = rho < rhoMin ? '  <-- under' : '';
    console.log(`  ${String(i).padStart(2)}  ${run.from[i] === null ? 'authored' : '   .    '}   ${step.toFixed(5)}` +
      `        ${turn.toFixed(1).padStart(6)}     ${(rho / r).toFixed(2).padStart(7)}r${flag}`);
  }
}
bp.dispose();
