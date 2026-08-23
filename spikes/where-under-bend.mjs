/**
 * Where in a run does the tightest bend sit, and does smoothing cause it?
 *
 *   npm run build -w klieg && node spikes/where-under-bend.mjs
 *
 * `tightestBend` measures the smoothed centerline, which is also what `sweepRun` sweeps, so a bend
 * the smoothing creates is a real one. This reports raw against smoothed per run, and the local
 * sample spacing at the tightest vertex, which says whether the offender is a fillet arc or a leg.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { minBendRadius } from '../packages/core/dist/render/tube/bend.js';
import { generatePaths } from '../packages/core/dist/render/tube/generators.js';
import { minCurvatureRadius3 } from '../packages/core/dist/render/tube/resample.js';
import { cutIntoRuns } from '../packages/core/dist/render/tube/runs.js';
import { surfacesOf } from '../packages/core/dist/render/tube/surfaces.js';
import { smoothedPoints, tightestBend } from '../packages/core/dist/render/tube/sweep.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const SOURCE = process.env.PATH_SOURCE ?? 'field';
const spec = { ...specOf(process.argv[2] ?? 'tubing').decoration, pathSource: SOURCE };
const rhoMin = minBendRadius(spec.radius, spec.bend);
/** A fillet is built at exactly rhoMin, so the invariant is `not below it`, not `strictly above`. */
const TOL = rhoMin * 1e-6;
const r = spec.radius;

/** Index of the tightest triple, on whichever point list is passed. */
function tightestAt(points) {
  let best = Number.POSITIVE_INFINITY;
  let at = -1;
  for (let i = 1; i + 1 < points.length; i++) {
    const rho = minCurvatureRadius3(points.slice(i - 1, i + 2));
    if (rho < best) {
      best = rho;
      at = i;
    }
  }
  return { best, at };
}

console.log(`path source: ${SOURCE}`);
for (const ch of process.argv[3] ?? 'MWNSRE') {
  const shapes = glyphToShapes(font, ch, 1);
  const paths = generatePaths(surfacesOf(shapes, 0.3), spec.surfaces, {
    level: spec.level,
    spacing: spec.spacing,
    wallDepth: 0.5,
    resolution: 256,
    pad: 0.35,
    source: SOURCE,
  });
  const { runs } = cutIntoRuns(paths, {
    runs: spec.runs,
    minRun: spec.minRun,
    corners: spec.corners,
    radius: spec.radius,
    bend: spec.bend,
    spacing: spec.spacing,
    seed: 0,
  });
  for (const run of runs) {
    const smoothed = smoothedPoints(run);
    const raw = run.points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    const rawTight = tightestAt(raw);
    const smoothTight = tightestAt(smoothed.map((p) => ({ x: p.x, y: p.y, z: p.z })));
    const bend = tightestBend(run);
    if (bend >= rhoMin - TOL) continue;
    const i = smoothTight.at;
    const step =
      i > 0 && i + 1 < run.points.length
        ? (run.points[i].distanceTo(run.points[i - 1]) +
            run.points[i + 1].distanceTo(run.points[i])) / 2
        : 0;
    // Which of the three points forming the tightest triple were built rather than extracted: an
    // all-authored triple is a fillet bending wrong, a mixed one is a join, none is plain path.
    const mark = [i - 1, i, i + 1]
      .map((k) => (run.points[k] && run.from[k] === null ? 'A' : '.'))
      .join('');
    const kind = mark === 'AAA' ? 'in fillet' : mark === '...' ? 'plain    ' : 'join     ';
    console.log(
      `  ${ch} run ${String(run.index).padStart(2)} n=${String(run.points.length).padStart(3)}` +
        `  raw ${(rawTight.best / r).toFixed(2)}r  smoothed ${(smoothTight.best / r).toFixed(2)}r` +
        `  at ${i}/${run.points.length}  ${kind} ${mark}  step ${step.toFixed(4)}`,
    );
  }
}
