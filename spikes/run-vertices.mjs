/**
 * Dump one run's vertices, to see what a bend diagnostic is pointing at.
 *
 *   node spikes/run-vertices.mjs W 1 [around] [look]
 *
 * Step is the segment leaving the vertex, turn is the direction change at it, and `A` marks a point
 * built analytically rather than extracted — so a stretch of equal steps and equal turns is a
 * fillet, and a lone spike between two of them is a join.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { minBendRadius } from '../packages/core/dist/render/tube/bend.js';
import { generatePaths } from '../packages/core/dist/render/tube/generators.js';
import { cutIntoRuns } from '../packages/core/dist/render/tube/runs.js';
import { surfacesOf } from '../packages/core/dist/render/tube/surfaces.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const [ch = 'W', runIndex = '1', around, look = 'tubing'] = process.argv.slice(2);
const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const spec = specOf(look).decoration;
const rhoMin = minBendRadius(spec.radius, spec.bend);

const paths = generatePaths(surfacesOf(glyphToShapes(font, ch, 1), 0.3), spec.surfaces, {
  level: spec.level,
  spacing: spec.spacing,
  wallDepth: 0.5,
  resolution: 256,
  pad: 0.35,
});
const { runs } = cutIntoRuns(paths, {
  runs: spec.runs,
  minRun: spec.minRun,
  corners: spec.corners,
  blockout: spec.blockout,
  radius: spec.radius,
  bend: spec.bend,
  spacing: spec.spacing,
  seed: 0,
});

const run = runs.find((r) => r.index === Number(runIndex));
if (!run) throw new Error(`no run ${runIndex} in ${ch} (have ${runs.map((r) => r.index).join(',')})`);
const at = around === undefined ? -1 : Number(around);
const lo = at < 0 ? 1 : Math.max(1, at - 6);
const hi = at < 0 ? run.points.length - 2 : Math.min(run.points.length - 2, at + 6);

console.log(`${ch} run ${run.index}, ${run.points.length} points, rho_min ${rhoMin.toFixed(4)}\n`);
for (let i = lo; i <= hi; i++) {
  const a = run.points[i].clone().sub(run.points[i - 1]);
  const b = run.points[i + 1].clone().sub(run.points[i]);
  const turn = a.angleTo(b);
  const rho = turn < 1e-9 ? Number.POSITIVE_INFINITY : ((a.length() + b.length()) / 2) / (2 * Math.sin(turn / 2));
  console.log(
    `  ${String(i).padStart(3)} ${run.from[i] === null ? 'A' : '.'}` +
      `  step ${b.length().toFixed(4)}  turn ${((turn * 180) / Math.PI).toFixed(1).padStart(5)}deg` +
      `  rho ${(rho / spec.radius).toFixed(2).padStart(6)}r` +
      `  (${run.points[i].x.toFixed(4)}, ${run.points[i].y.toFixed(4)})`,
  );
}
