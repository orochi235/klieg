/**
 * Splits the runs that measure under rho_min into genuine junction failures and boundary noise.
 *
 *   npm run build -w klieg && node spikes/junction-split.mjs
 *
 * For every failing run it locates the vertex carrying the minimum curvature and asks whether its
 * triple is entirely arc (authored) points. An arc built at rho_min circumscribes at exactly
 * rho_min, so an all-arc triple reading fractionally under is float noise at the threshold; a
 * triple that includes a leg point is the fillet-to-path junction the spec is about.
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
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SOURCES = ['field', 'exact', 'direct'];

const CASES = [
  ['tubing', specOf('tubing').decoration],
  ['tubing no wander', { ...specOf('tubing').decoration, amplitude: 0 }],
  ['piping', specOf('piping').decoration],
  ['piping no wander', { ...specOf('piping').decoration, amplitude: 0 }],
];

let genuine = 0;
let noise = 0;
for (const [look, base] of CASES) {
  const rhoMin = minBendRadius(base.radius, base.bend);
  const spacing = base.spacing;
  const tol = rhoMin * 1e-6;
  for (const source of SOURCES) {
    const spec = { ...base, pathSource: source };
    for (const ch of LETTERS) {
      const bp = buildTubeBlueprint(glyphToShapes(font, ch, 1), spec, 0.3, 0);
      for (const run of bp.runs) {
        if (tightestBend(run) >= rhoMin - tol) continue;
        const raw = run.points;
        const sm = smoothedPoints(run);
        // argmin over the same triples tightestBend measures
        let best = Infinity;
        let at = -1;
        for (let i = 1; i + 1 < sm.length; i++) {
          const r = minCurvatureRadius3([sm[i - 1], sm[i], sm[i + 1]].map((q) => ({ x: q.x, y: q.y, z: q.z })));
          if (r < best) { best = r; at = i; }
        }
        const authored = run.from.map((source) => source === null);
        // Interior to one arc: three arc points at one constant step. Two abutting fillets are
        // all-authored too, and their shared vertex is a junction like any other.
        const s1 = raw[at].distanceTo(raw[at - 1]);
        const s2 = raw[at + 1].distanceTo(raw[at]);
        const allArc =
          authored[at - 1] && authored[at] && authored[at + 1] && Math.abs(s1 - s2) < 1e-9 * spacing;
        // longest step at a leg<->arc boundary, and the worst turn at a non-arc vertex
        let junctionStep = 0;
        for (let i = 1; i < raw.length; i++) {
          const d = raw[i].distanceTo(raw[i - 1]);
          if (!authored[i] || !authored[i - 1] || Math.abs(d - spacing / 2) > spacing / 4) {
            junctionStep = Math.max(junctionStep, d);
          }
        }
        const deficit = (rhoMin - best) / rhoMin;
        const kind = allArc ? 'noise' : 'GENUINE';
        if (kind === 'noise') noise += 1; else genuine += 1;
        console.log(
          `${kind.padEnd(8)} ${look.padEnd(17)} ${source.padEnd(7)} ${ch} run ${String(run.index).padStart(2)}` +
          `  rho ${(best / base.radius).toFixed(3)}r  deficit ${(deficit * 100).toFixed(3)}%` +
          `  vtx ${at}/${sm.length - 1} ${allArc ? 'all-arc' : 'junction'}` +
          `  maxJunctionStep ${(junctionStep / spacing).toFixed(2)}x spacing`,
        );
      }
      bp.dispose();
    }
  }
}
console.log(`\nGENUINE ${genuine}   noise ${noise}`);
