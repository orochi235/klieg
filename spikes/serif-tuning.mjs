/**
 * Which tube knob buys a serif face back its strokes?
 *
 *   npm run build -w klieg && node spikes/serif-tuning.mjs [--face cinzel] [--look tubing]
 *
 * A serifed terminal is a corner, and every corner cuts, so a face like Cinzel keeps far less of
 * its contour under `tubing` than the packaged sans does — the letters read but they read as
 * dashes. This sweeps one knob at a time across the alphabet and reports two numbers: how much of
 * the traced contour survives as tube, and how many runs it survives as. More kept is better; more
 * runs for the same kept is worse, because that is the same glass in more pieces.
 *
 * Nothing here changes a shipped look. The output is a spec to hand `fire()`.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { buildTubeBlueprint } from '../packages/core/dist/render/tube/index.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const FACE = arg('face', 'cinzel');
const LOOK = arg('look', 'tubing');
const CHARS = arg('chars', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
const SEEDS = Number(arg('seeds', 4));
const DEPTH = 0.3;

const base = specOf(LOOK).decoration;
if (base?.kind !== 'tube') throw new Error(`${LOOK} is not a tube look`);
const buf = readFileSync(new URL(`../apps/lab/public/fonts/${FACE}.ttf`, import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const shapesOf = new Map([...CHARS].map((ch) => [ch, glyphToShapes(font, ch, 1)]));
const len = (pts) => {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += pts[i].distanceTo(pts[i - 1]);
  return s;
};

/** Kept contour and run count for one spec, averaged over the alphabet and the seeds. */
function score(spec) {
  let kept = 0;
  let traced = 0;
  let runs = 0;
  let n = 0;
  for (const ch of CHARS) {
    for (let seed = 0; seed < SEEDS; seed++) {
      const bp = buildTubeBlueprint(shapesOf.get(ch), spec, DEPTH, seed);
      traced += bp.paths.reduce((a, p) => a + len(p.points), 0);
      kept += bp.runs.reduce((a, r) => a + len(r.points), 0);
      runs += bp.runs.length;
      n++;
      bp.dispose();
    }
  }
  return { kept: kept / traced, runs: runs / n };
}

const SWEEPS = [
  ['bend', [1.25, 1.5, 2, 3, 4], (v) => ({ bend: v })],
  ['radius', [0.014, 0.018, 0.022, 0.028], (v) => ({ radius: v })],
  ['connect', [0, 0.3, 0.5, 0.7, 0.9, 1], (v) => ({ corners: { break: 1 - v, connect: v } })],
  ['blockout', [0, 0.35, 0.7, 1], (v) => ({ blockout: v })],
  ['minRun', [0.08, 0.15, 0.25, 0.4], (v) => ({ minRun: v })],
  ['runs', [3, 5, 7, 11], (v) => ({ runs: v })],
  ['rejoin', ['drop', 'bridge', 'widen', 'relax'], (v) => ({ rejoin: v })],
  ['spacing', [0.01, 0.02, 0.04], (v) => ({ spacing: v })],
];

const shipped = score(base);
console.log(`${FACE} on ${LOOK}, ${CHARS.length} letters x ${SEEDS} seeds`);
console.log(`  shipped          kept ${(shipped.kept * 100).toFixed(1)}%  runs/letter ${shipped.runs.toFixed(1)}\n`);

const best = [];
for (const [name, values, make] of SWEEPS) {
  for (const value of values) {
    const got = score({ ...base, ...make(value) });
    const mark = got.kept > shipped.kept + 0.02 ? ' <-' : '';
    console.log(
      `  ${name.padEnd(9)} ${String(value).padEnd(7)} kept ${(got.kept * 100).toFixed(1)}%` +
        `  runs/letter ${got.runs.toFixed(1)}${mark}`,
    );
    best.push({ name, value, ...got });
  }
  console.log('');
}

console.log('best single change by kept contour:');
for (const b of best.sort((a, b) => b.kept - a.kept).slice(0, 5)) {
  console.log(`  ${b.name} ${b.value}  kept ${(b.kept * 100).toFixed(1)}%  runs/letter ${b.runs.toFixed(1)}`);
}
