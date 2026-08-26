/**
 * The acceptance check: does any run of any letter bend tighter than the look's own rho_min?
 *
 *   npm run build -w klieg && node spikes/bend-acceptance.mjs
 *   REJOIN=bridge|widen|relax|drop  overrides how a fillet rejoins a leg it cannot meet cleanly.
 *
 * Runs the whole pipeline, not just the cut — so wander, which moves run points after cutting, is
 * included. A fillet is built at exactly rho_min, so the test is "not below", not "strictly above".
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { minBendRadius } from '../packages/core/dist/render/tube/bend.js';
import { buildTubeBlueprint } from '../packages/core/dist/render/tube/index.js';
import { tightestBend } from '../packages/core/dist/render/tube/sweep.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Wander is the one stage that can still bend a run after the corner stage has passed over it, so
// measuring with it off separates what the corner stage owes from what wander does.
const REJOIN = process.env.REJOIN;
const rejoined = (spec) => (REJOIN ? { ...spec, rejoin: REJOIN } : spec);
const CASES = [
  ['tubing', rejoined(specOf('tubing').decoration)],
  ['tubing no wander', rejoined({ ...specOf('tubing').decoration, amplitude: 0 })],
  ['piping', rejoined(specOf('piping').decoration)],
];

for (const [look, spec] of CASES) {
  const rhoMin = minBendRadius(spec.radius, spec.bend);
  const tol = rhoMin * 1e-6;
  let under = 0;
  let total = 0;
  let worst = Number.POSITIVE_INFINITY;
  let worstAt = '';
  for (const ch of LETTERS) {
    const bp = buildTubeBlueprint(glyphToShapes(font, ch, 1), spec, 0.3, 0);
    let letterUnder = 0;
    for (const run of bp.runs) {
      const bend = tightestBend(run);
      total += 1;
      if (bend < rhoMin - tol) {
        under += 1;
        letterUnder += 1;
      }
      if (bend < worst) {
        worst = bend;
        worstAt = `${ch} run ${run.index}`;
      }
    }
    bp.dispose();
    console.log(`  ${look} ${ch}  ${String(letterUnder).padStart(2)} under-bend`);
  }
  console.log(
    `${look}: ${under}/${total} runs under rho_min ${rhoMin.toFixed(4)} (${spec.bend ?? 2}r), ` +
      `worst ${(worst / spec.radius).toFixed(2)}r at ${worstAt}\n`,
  );
}
