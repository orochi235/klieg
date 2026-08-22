/**
 * What a junction chord hides.
 *
 *   npm run build -w klieg && node spikes/junction-chord.mjs
 *
 * A fillet splices in at a tangent point the leg does not reach, and the gap is bridged by one long
 * chord. Circumradius through that chord is chord / (2 sin turn), so lengthening the chord raises
 * the measured radius while leaving the direction mismatch exactly where it was. Filling the chord
 * with plain interpolation removes the inflation and reports the bend the junction really carries.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import * as THREE from 'three';
import { specOf } from '../packages/core/dist/render/looks.js';
import { isAuthored, minBendRadius } from '../packages/core/dist/render/tube/bend.js';
import { buildTubeBlueprint } from '../packages/core/dist/render/tube/index.js';
import { minCurvatureRadius3, smooth } from '../packages/core/dist/render/tube/resample.js';
import { tightestBend } from '../packages/core/dist/render/tube/sweep.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const LETTERS = process.argv[2] ?? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CASES = [
  ['tubing', 'direct'],
  ['tubing', 'field'],
  ['tubing', 'exact'],
  ['piping', 'direct'],
  ['piping', 'field'],
  ['piping', 'exact'],
];

const minRho = (pts) => minCurvatureRadius3(pts.map((p) => ({ x: p.x, y: p.y, z: p.z })));

/** The run's own smoothing, applied to a point list that may have grown. */
function smoothLike(pts, held) {
  const flat = smooth(pts.map((p) => ({ x: p.x, y: p.y })), 3, 'open', held);
  return pts.map((p, i) => new THREE.Vector3(flat[i].x, flat[i].y, p.z));
}

/** Plain interpolation into every chord longer than 1.5 steps, so no step is far from spacing. */
function fillChords(pts, held, spacing) {
  const out = [];
  const hold = [];
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) {
      const n = Math.floor(pts[i].distanceTo(pts[i - 1]) / (spacing * 1.5));
      for (let k = 1; k <= n; k++) {
        out.push(pts[i - 1].clone().lerp(pts[i], k / (n + 1)));
        hold.push(false);
      }
    }
    out.push(pts[i]);
    hold.push(held[i]);
  }
  return { points: out, hold };
}

for (const [look, source] of CASES) {
  const spec = { ...specOf(look).decoration, amplitude: 0, pathSource: source };
  const rhoMin = minBendRadius(spec.radius, spec.bend);
  const r = spec.radius;
  for (const ch of LETTERS) {
    const bp = buildTubeBlueprint(glyphToShapes(font, ch, 1), spec, 0.3, 0);
    for (const run of bp.runs) {
      if (tightestBend(run) >= rhoMin * (1 - 1e-6)) continue;
      const held = run.points.map(isAuthored);
      const filled = fillChords(run.points, held, spec.spacing);
      const longest = Math.max(
        ...run.points.map((p, i) => (i ? p.distanceTo(run.points[i - 1]) : 0)),
      );
      console.log(
        `${look}/${source} ${ch} run ${run.index}: built ${(minRho(run.points) / r).toFixed(2)}r raw / ` +
          `${(tightestBend(run) / r).toFixed(2)}r swept  ·  chord-filled ` +
          `${(minRho(filled.points) / r).toFixed(2)}r raw / ` +
          `${(minRho(smoothLike(filled.points, filled.hold)) / r).toFixed(2)}r swept  ·  ` +
          `longest chord ${(longest / spec.spacing).toFixed(1)}x spacing`,
      );
    }
    bp.dispose();
  }
}
