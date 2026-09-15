/**
 * Where in the cut does a lost counter die -- the corner stage, or the `minRun` floor?
 *
 *   node spikes/counter-cut.mjs --out counter-cut.md
 *
 * `spikes/counter-loss.mjs` establishes which counters draw nothing at the shipped `tubing`
 * settings. This one asks what killed each of them, to decide where a fix belongs.
 *
 * The hypothesis under test: `cornersByBend` detects on a bend RADIUS (`rho < detect`), so a
 * counter small enough to be tight at every vertex has every vertex hit. Adjacent hits group, the
 * seam-wrap branch merges head and tail, and the ring collapses to ONE corner covering the whole
 * loop -- `rawSpansOf` then walks `start === end` all the way round, and the corner treatment eats
 * the remainder down under `minRun`.
 *
 * Raw spans, before the floor, are recovered by re-running `cutIntoRuns` over the blueprint's own
 * already-wandered paths with `runs: 0, minRun: 0`: `extra` is then zero so no span is sliced, and
 * nothing is dropped, which yields exactly one run per span with `dark` intact. The strategy draws
 * are seeded off `cornerBase` and the seed alone, so neither knob perturbs them -- checked below by
 * replaying the shipped settings the same way and requiring the original run count back.
 *
 * Corner counts and hit rates are seed-independent (`cornersByBend` takes no seed); span lengths
 * are not, since the strategy each corner draws is seeded.
 *
 * Reads the built package, so `npm run build -w klieg` first.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { cornersByBend, minBendRadius, STYLE_FACTOR, vertexBends } from '../packages/core/dist/render/tube/bend.js';
import { buildTubeBlueprint } from '../packages/core/dist/render/tube/index.js';
import { offsetRing, orientRings } from '../packages/core/dist/render/tube/offset.js';
import { pathLength, resample } from '../packages/core/dist/render/tube/resample.js';
import { cutIntoRuns, polyLength } from '../packages/core/dist/render/tube/runs.js';
import { surfacesOf } from '../packages/core/dist/render/tube/surfaces.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const LETTERS = [...'ABDOPQRabdegopq04689@&'];
const DEPTH = 0.3;
const SEED = 0;
const RING_SPACING = 0.01;
/** The band the coordinator asked for a matched set of survivors across. */
const BAND = [0.3, 0.75];

const FONT_DIR = new URL('../apps/lab/public/fonts/', import.meta.url);
const outArg = process.argv.indexOf('--out');
const outPath = outArg >= 0 ? process.argv[outArg + 1] : null;

const spec = specOf('tubing').decoration;
if (spec?.kind !== 'tube') throw new Error('tubing has no tube decoration');
const MIN_RUN = spec.minRun;

const RHO_MIN = minBendRadius(spec.radius, spec.bend);
const RHO_STYLE = spec.radius * STYLE_FACTOR;
const DETECT = Math.max(RHO_MIN, RHO_STYLE);

/** The options the cut stage builds from the spec, less the two knobs this spike varies. */
const cutOpts = {
  corners: spec.corners,
  spacing: spec.spacing,
  bend: spec.bend,
  radius: spec.radius,
  blockout: spec.blockout,
  shortRun: spec.shortRun,
  rejoin: spec.rejoin,
  hairpin: spec.hairpin,
  seed: SEED,
};

function contourPoints(contour) {
  const raw = contour.getPoints(24).map((p) => ({ x: p.x, y: p.y }));
  const first = raw[0];
  const last = raw[raw.length - 1];
  if (raw.length > 1 && first && last && Math.hypot(first.x - last.x, first.y - last.y) < 1e-9) {
    raw.pop();
  }
  return resample(raw, RING_SPACING);
}

function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  }
  return Math.abs(sum / 2);
}

function ringsOf(shapes) {
  const rings = [];
  for (let s = 0; s < shapes.length; s++) {
    const shape = shapes[s];
    const contours = [shape, ...shape.holes];
    for (let c = 0; c < contours.length; c++) {
      const ring = contourPoints(contours[c]);
      if (ring.length < 3) continue;
      rings.push({
        shape: s,
        hole: c === 0 ? -1 : c - 1,
        perimeter: pathLength([...ring, ring[0]]),
        area: ringArea(ring),
        path: -1,
      });
    }
  }
  const oriented = orientRings(
    shapes.flatMap((shape) => [shape, ...shape.holes].map(contourPoints).filter((r) => r.length >= 3)),
  );
  let path = 0;
  for (let i = 0; i < rings.length; i++) {
    const line = resample(offsetRing(oriented[i], spec.level), spec.spacing);
    if (line.length >= 4) rings[i].path = path++;
  }
  return rings;
}

/** Which ring each run belongs to, by the path index its source vertices carry. */
function attribute(runs, rings) {
  const byRing = rings.map(() => []);
  for (const run of runs) {
    const paths = [...new Set(run.from.filter(Boolean).map((f) => f.path))];
    if (paths.length === 0) continue;
    const i = rings.findIndex((r) => r.path === paths[0]);
    if (i >= 0) byRing[i].push(run);
  }
  return byRing;
}

const files = readdirSync(FONT_DIR).filter((f) => /\.(ttf|otf)$/.test(f)).sort();
const jobs = files.length * LETTERS.length;
const rows = [];
const problems = [];
let replayMismatches = 0;
let done = 0;

for (const file of files) {
  const buf = readFileSync(new URL(file, FONT_DIR));
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

  for (const ch of LETTERS) {
    done++;
    const head = `${String(done).padStart(3)}/${jobs}  ${file.padEnd(22)} ${ch}`;
    if (font.charToGlyphIndex(ch) === 0) {
      console.log(`${head}  -- not in face`);
      continue;
    }

    const shapes = glyphToShapes(font, ch, 1);
    const rings = ringsOf(shapes);
    if (rings.every((r) => r.hole < 0)) {
      console.log(`${head}  no counters`);
      continue;
    }

    const bp = buildTubeBlueprint(shapes, spec, DEPTH, SEED);
    const paths = bp.paths;
    const shippedByRing = attribute(bp.runs, rings);
    const shippedCount = bp.runs.length;

    // The floor and the run budget switched off, over the same already-wandered paths: one run per
    // raw span, nothing sliced, nothing dropped.
    const raw = cutIntoRuns(paths, { ...cutOpts, runs: 0, minRun: 0 });
    const rawByRing = attribute(raw.runs, rings);

    // Same call at the shipped settings has to reproduce the pipeline's own result, or re-running
    // the cut over these paths is not faithful and none of the rest counts.
    const replay = cutIntoRuns(paths, { ...cutOpts, runs: spec.runs, minRun: MIN_RUN });
    if (replay.runs.length !== shippedCount) {
      replayMismatches++;
      problems.push(`${file} ${ch}: replay gave ${replay.runs.length} runs, pipeline gave ${shippedCount}`);
    }

    for (let i = 0; i < rings.length; i++) {
      if (rings[i].hole < 0) continue;
      const j = rings[i].path;
      const points = j >= 0 ? paths[j].points : [];
      const closed = j >= 0 ? paths[j].closed : true;
      const bends = j >= 0 ? vertexBends(points, closed) : [];
      const hits = bends.filter((b) => b.rho < DETECT);
      const corners = j >= 0 ? cornersByBend(points, closed, RHO_MIN, RHO_STYLE) : [];
      const spans = rawByRing[i] ?? [];
      const kept = shippedByRing[i] ?? [];
      const loopLen = j >= 0 ? polyLength([...points, points[0]]) : 0;
      const spanTotal = spans.reduce((a, s) => a + s.length, 0);

      rows.push({
        font: file,
        ch,
        hole: rings[i].hole,
        perimeter: rings[i].perimeter,
        area: rings[i].area,
        noPath: j < 0,
        vertices: points.length,
        hits: hits.length,
        hitRate: bends.length > 0 ? hits.length / bends.length : 0,
        corners: corners.length,
        hard: corners.filter((c) => c.hard).length,
        spans: spans.length,
        spanTotal,
        loopLen,
        consumed: loopLen > 0 ? (loopLen - spanTotal) / loopLen : 0,
        clearing: spans.filter((s) => s.length >= MIN_RUN).length,
        darkSpans: spans.filter((s) => s.dark).length,
        longestSpan: spans.reduce((a, s) => Math.max(a, s.length), 0),
        runs: kept.length,
        keptLen: kept.reduce((a, r) => a + r.length, 0),
        lost: kept.length === 0,
      });
    }

    const lost = rows.filter((r) => r.font === file && r.ch === ch && r.lost).length;
    console.log(`${head}  counters ${String(rings.filter((r) => r.hole >= 0).length).padStart(2)}  lost ${String(lost).padStart(2)}`);
    bp.dispose();
  }
}

// ---- report ----------------------------------------------------------------

const f = (n, w, d) => n.toFixed(d).padStart(w);
const i = (n, w) => String(n).padStart(w);
const L = [];
const say = (s = '') => L.push(s);

const lost = rows.filter((r) => r.lost);
const survivors = rows.filter((r) => !r.lost);
const band = survivors.filter((r) => r.perimeter >= BAND[0] && r.perimeter < BAND[1]);

say('# Where a lost counter dies in the cut');
say('');
say(`Seed ${SEED}, shipped \`tubing\`. Counter rings measured: ${rows.length}, of which ${lost.length} drew no run.`);
say('');
say('## Resolved thresholds');
say('');
say('| symbol | value em | from |');
say('|:-------|---------:|:-----|');
say(`| \`radius\` | ${f(spec.radius, 8, 4)} | spec |`);
say(`| \`rhoMin\` | ${f(RHO_MIN, 8, 4)} | \`minBendRadius(radius, bend ${spec.bend})\` = radius x max(1.25, bend) |`);
say(`| \`rhoStyle\` | ${f(RHO_STYLE, 8, 4)} | \`radius * STYLE_FACTOR\` (${STYLE_FACTOR}) |`);
say(`| \`detect\` | ${f(DETECT, 8, 4)} | \`max(rhoMin, rhoStyle)\` |`);
say(`| \`minRun\` | ${f(MIN_RUN, 8, 4)} | spec |`);
say('');
say('A vertex is a corner hit when its bend radius `rho < detect`. A ring whose own radius is under');
say(`${f(DETECT, 0, 4)} em is therefore tight at every vertex -- a circular counter of perimeter p has`);
say(`radius p/2pi, so every ring under ${f(DETECT * 2 * Math.PI, 0, 3)} em of perimeter is hit at every vertex.`);
say('');

say('## Faithfulness check');
say('');
say(`Re-running \`cutIntoRuns\` over the blueprint's own paths at the shipped settings reproduced the`);
say(`pipeline's run count on every glyph but ${replayMismatches}.`);
if (problems.length) {
  say('');
  for (const p of problems.slice(0, 20)) say(`  ${p}`);
  if (problems.length > 20) say(`  ... and ${problems.length - 20} more`);
}
say('');

say('## The hypothesis');
say('');
const tally = (set, pred) => set.filter(pred).length;
say('| corners on the ring | lost | survived | survivors 0.30-0.75 em |');
say('|:--------------------|-----:|---------:|-----------------------:|');
for (const [label, pred] of [
  ['0  (uncut whole loop)', (r) => r.corners === 0],
  ['1  (one corner, whole-loop arc)', (r) => r.corners === 1],
  ['2', (r) => r.corners === 2],
  ['3-5', (r) => r.corners >= 3 && r.corners <= 5],
  ['6+', (r) => r.corners >= 6],
]) {
  say(`| ${label.padEnd(31)} | ${i(tally(lost, pred), 4)} | ${i(tally(survivors, pred), 8)} | ${i(tally(band, pred), 22)} |`);
}
say('');
const everyVertex = (r) => r.hitRate >= 0.999;
say(`Lost counters whose every vertex was a corner hit: ${tally(lost, everyVertex)}/${lost.length}.`);
say(`Survivors whose every vertex was a corner hit: ${tally(survivors, everyVertex)}/${survivors.length}.`);
say(`Mean vertex hit rate -- lost ${f(lost.reduce((a, r) => a + r.hitRate, 0) / Math.max(1, lost.length), 0, 3)}, survivors ${f(survivors.reduce((a, r) => a + r.hitRate, 0) / Math.max(1, survivors.length), 0, 3)}, band survivors ${f(band.reduce((a, r) => a + r.hitRate, 0) / Math.max(1, band.length), 0, 3)}.`);
say('');
say(`**Lost with ZERO corners detected (died purely to \`minRun\` on an uncut loop): ${tally(lost, (r) => r.corners === 0)}.**`);
const zeroCorner = lost.filter((r) => r.corners === 0);
if (zeroCorner.length) {
  say('');
  say('| font | letter | hole | perim em | loop em | spans | longest em |');
  say('|:-----|:------:|-----:|---------:|--------:|------:|-----------:|');
  for (const r of zeroCorner) {
    say(`| ${r.font.replace(/\.[to]tf$/, '').padEnd(18)} | ${r.ch} | ${i(r.hole, 4)} | ${f(r.perimeter, 8, 3)} | ${f(r.loopLen, 7, 3)} | ${i(r.spans, 5)} | ${f(r.longestSpan, 10, 3)} |`);
  }
}
say('');

say('## Length accounting');
say('');
say('`loop` is the closed path length the cut received. `spans` is what the corner stage handed the');
say('floor, `span em` their total, `eaten %` the share the corner stage consumed. `>=min` is how many');
say('spans cleared `minRun`; `kept em` is what actually became runs at the shipped settings.');
say('');
const accTable = (set, title) => {
  say(`### ${title}`);
  say('');
  say('| font | letter | hole | perim em | loop em | verts | hit % | corn | hard | spans | span em | eaten % | >=min | dark | kept em |');
  say('|:-----|:------:|-----:|---------:|--------:|------:|------:|-----:|-----:|------:|--------:|--------:|------:|-----:|--------:|');
  for (const r of set) {
    say(
      `| ${r.font.replace(/\.[to]tf$/, '').padEnd(18)} | ${r.ch} | ${i(r.hole, 4)} | ${f(r.perimeter, 8, 3)} | ${f(r.loopLen, 7, 3)} | ${i(r.vertices, 5)} | ${f(r.hitRate * 100, 5, 1)} | ${i(r.corners, 4)} | ${i(r.hard, 4)} | ${i(r.spans, 5)} | ${f(r.spanTotal, 7, 3)} | ${f(r.consumed * 100, 7, 1)} | ${i(r.clearing, 5)} | ${i(r.darkSpans, 4)} | ${f(r.keptLen, 7, 3)} |`,
    );
  }
  say('');
};
accTable([...lost].sort((a, b) => b.perimeter - a.perimeter), `Every lost counter (${lost.length})`);
accTable([...band].sort((a, b) => a.perimeter - b.perimeter), `Survivors, ${BAND[0].toFixed(2)}-${BAND[1].toFixed(2)} em (${band.length})`);

say('## What rejected what');
say('');
const noSpans = tally(lost, (r) => r.spans === 0);
const allUnder = tally(lost, (r) => r.spans > 0 && r.clearing === 0);
say(`Lost counters with no span at all left by the corner stage: ${noSpans}.`);
say(`Lost counters whose spans all fell under \`minRun\`: ${allUnder}.`);
say(`Of those, the corner stage had already eaten a mean ${f((lost.filter((r) => r.spans > 0 && r.clearing === 0).reduce((a, r) => a + r.consumed, 0) / Math.max(1, allUnder)) * 100, 0, 1)}% of the loop.`);
say('');
// A survivor's spans clear the floor; a lost one's do not. If that reading is right, span length
// alone predicts the outcome, and the shipped build must agree on every ring.
const predicted = rows.filter((r) => (r.clearing === 0) === r.lost).length;
say(`Predicting loss from the raw spans alone (\`no span clears minRun\`) agrees with the shipped`);
say(`build on ${predicted}/${rows.length} rings.`);
say('');
say('Longest single span left on a lost counter, against `minRun`:');
say('');
say('| | em |');
say('|:--|---:|');
if (lost.length) {
  const longest = lost.reduce((a, b) => (b.longestSpan > a.longestSpan ? b : a));
  say(`| largest surviving span on any lost counter | ${f(longest.longestSpan, 6, 3)} |`);
  say(`| \`minRun\` | ${f(MIN_RUN, 6, 3)} |`);
}
say('');

say('## Blockout');
say('');
const darkRings = rows.filter((r) => r.darkSpans > 0);
say(`Counter rings carrying at least one \`dark\` span: ${darkRings.length}/${rows.length}.`);
const darkOnly = rows.filter((r) => r.spans > 0 && r.darkSpans === r.spans);
say(`Counter rings whose every span is dark -- present as glass, never lit: ${darkOnly.length}.`);
if (darkRings.length) {
  say('');
  say('| font | letter | hole | perim em | spans | dark | runs | kept em |');
  say('|:-----|:------:|-----:|---------:|------:|-----:|-----:|--------:|');
  for (const r of darkRings.sort((a, b) => b.darkSpans - a.darkSpans).slice(0, 30)) {
    say(`| ${r.font.replace(/\.[to]tf$/, '').padEnd(18)} | ${r.ch} | ${i(r.hole, 4)} | ${f(r.perimeter, 8, 3)} | ${i(r.spans, 5)} | ${i(r.darkSpans, 4)} | ${i(r.runs, 4)} | ${f(r.keptLen, 7, 3)} |`);
  }
  if (darkRings.length > 30) say(`| ... ${darkRings.length - 30} more | | | | | | | |`);
}
say('');

const text = L.join('\n') + '\n';
if (outPath) {
  writeFileSync(new URL('../' + outPath, import.meta.url), text);
  console.log(`\nwrote ${outPath}`);
} else {
  console.log(text);
}
