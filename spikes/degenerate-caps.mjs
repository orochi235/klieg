/**
 * Which capitals does a tube look draw as nothing?
 *
 *   npm run build -w klieg && node spikes/degenerate-caps.mjs [--look tubing] [--seeds 26]
 *
 * `tubing` hides its body, so a letter whose runs all fall away is not a dim letter — it is a gap
 * in the word. The tube is cut into runs and only some are lit, and the cut is seeded by the
 * letter's position, so the same character can survive at one index and vanish at another. Reports
 * lit tube length per (face, char) as a fraction of the contour the tracer found, over every seed,
 * so a fragile letter is told apart from an unlucky one.
 */
import { readdirSync, readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { buildTubeBlueprint } from '../packages/core/dist/render/tube/index.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const FONT_DIR = new URL('../apps/lab/public/fonts/', import.meta.url);
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const LOOK = arg('look', 'tubing');
const SEEDS = Number(arg('seeds', 26));
const CHARS = arg('chars', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
const DEPTH = 0.3;
const spec = specOf(LOOK).decoration;
let lost = 0;
if (spec?.kind !== 'tube') throw new Error(`${LOOK} is not a tube look`);

const faces = readdirSync(FONT_DIR).filter((f) => f.endsWith('.ttf'));
const len = (pts) => {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += pts[i].distanceTo(pts[i - 1]);
  return s;
};

console.log(`${LOOK}: lit tube per letter, over ${SEEDS} seeds\n`);
const dead = [];
for (const file of faces) {
  const buf = readFileSync(new URL(file, FONT_DIR));
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const name = file.replace(/\.ttf$/, '');
  const row = [];
  for (const ch of CHARS) {
    const shapes = glyphToShapes(font, ch, 1);
    let traced = 0;
    let blank = 0;
    let litTotal = 0;
    let giveUp = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      // What the resume walk discards, reported by the walk itself: a trim of a vertex or two at
      // a corner is the point of it, a whole leg is the failure.
      const bp = buildTubeBlueprint(shapes, spec, DEPTH, seed, {
        onRepair(id, site) {
          if (id === 'resume' && site) giveUp += len(site.removed);
        },
      });
      traced = bp.paths.reduce((a, p) => a + len(p.points), 0);
      const lit = bp.runs.filter((r) => r.lit !== false);
      const litLen = lit.reduce((a, r) => a + len(r.points), 0);
      litTotal += litLen;
      if (traced === 0 || litLen / traced < 0.15) blank++;
      bp.dispose();

    }
    const share = litTotal / SEEDS / (traced || 1);
    row.push({ ch, traced, share, blank, giveUp: giveUp / SEEDS });
    lost += giveUp / SEEDS;
    if (blank > 0) dead.push({ name, ch, traced, share, blank });
  }
  const bad = row.filter((r) => r.blank > 0);
  const worst = [...row].sort((a, b) => b.giveUp - a.giveUp).slice(0, 3);
  console.log(
    `${name.padEnd(16)} ${(bad.length ? bad.map((r) => `${r.ch}(${r.blank}/${SEEDS})`).join(' ') : 'all lit').padEnd(24)}` +
      ` resume discards ${row.reduce((a, r) => a + r.giveUp, 0).toFixed(2)} em/alphabet` +
      ` (${worst.map((r) => `${r.ch} ${r.giveUp.toFixed(2)}`).join(', ')})`,
  );
}
console.log(`\nthe resume walk discards ${lost.toFixed(1)} em across ${faces.length} alphabets\n`);
for (const d of dead.sort((a, b) => b.blank - a.blank).slice(0, 20))
  console.log(`  ${d.name.padEnd(16)} ${d.ch}  traced ${d.traced.toFixed(2)} em  mean lit ${(d.share * 100).toFixed(0)}%  blank at ${d.blank}/${SEEDS} seeds`);
