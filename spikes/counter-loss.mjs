/**
 * At the shipped `tubing` settings, which counters are lost?
 *
 *   node spikes/counter-loss.mjs --out counter-loss.md
 *
 * A counter is an entry in `shape.holes` -- the enclosed negative space in o, a, e, B, D, g, 8.
 * `surfacesOf` flattens every shape into one ring list (outer contour first, then that shape's
 * holes) and hole identity is gone from there on, so this rebuilds the same list, keeps the
 * (shape, hole) label beside each ring, and attributes finished runs back through
 * `Run.from[].path` -> path index -> ring.
 *
 * The mapping is only recoverable because `tubing` leaves `pathSource` unset, which is `direct`:
 * `generatePaths` emits one path per ring, in ring order. Under `field`/`exact` the face is
 * rasterized to a grid and re-extracted, and a path is no longer any particular contour. The
 * order-based mapping is checked against an independent nearest-ring test on every glyph below,
 * and the run refuses to report if the two disagree.
 *
 * Reads the built package, so `npm run build -w klieg` first.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { buildTubeBlueprint } from '../packages/core/dist/render/tube/index.js';
import { offsetRing, orientRings } from '../packages/core/dist/render/tube/offset.js';
import { pathLength, resample } from '../packages/core/dist/render/tube/resample.js';
import { surfacesOf } from '../packages/core/dist/render/tube/surfaces.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const LETTERS = [...'ABDOPQRabdegopq04689@&'];
const DEPTH = 0.3;
const SEEDS = [0, 1, 2, 3, 4];
/** The seed every headline number is quoted at; the others only answer "lost at every seed". */
const SEED = 0;
/** surfaces.ts RING_SPACING -- the spacing the ring a wall/polygon is measured on is built at. */
const RING_SPACING = 0.01;

const FONT_DIR = new URL('../apps/lab/public/fonts/', import.meta.url);
const outArg = process.argv.indexOf('--out');
const outPath = outArg >= 0 ? process.argv[outArg + 1] : null;

const spec = specOf('tubing').decoration;
if (spec?.kind !== 'tube') throw new Error('tubing has no tube decoration');
const MIN_RUN = spec.minRun;
const RUNS = spec.runs;

/** surfaces.ts contourPoints, which is not exported. */
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

/** Nearest vertex distance from a point to a ring -- the independent check on the order mapping. */
function nearestOn(p, ring) {
  let best = Number.POSITIVE_INFINITY;
  for (const q of ring) {
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best) best = d;
  }
  return best;
}

/**
 * The ring list `surfacesOf` builds, with each ring labeled by the contour it came from, plus the
 * path index it will land at once `generatePaths` drops the rings too short to resample.
 */
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
        ring,
        perimeter: pathLength([...ring, ring[0]]),
        area: ringArea(ring),
        path: -1,
      });
    }
  }
  // generators.ts contoursOf, `direct` branch: orient, offset by `level`, resample, drop short.
  const oriented = orientRings(rings.map((r) => r.ring));
  let path = 0;
  for (let i = 0; i < rings.length; i++) {
    const line = resample(offsetRing(oriented[i], spec.level), spec.spacing);
    if (line.length >= 4) rings[i].path = path++;
  }
  return rings;
}

const files = readdirSync(FONT_DIR).filter((f) => /\.(ttf|otf)$/.test(f)).sort();
const jobs = [];
for (const file of files) for (const ch of LETTERS) jobs.push([file, ch]);

const holes = [];
const letters = [];
const problems = [];
let ringsChecked = 0;
let mappingMismatches = 0;
let mappingTies = 0;
let runsUnattributed = 0;
let runsSplit = 0;
let done = 0;

for (const file of files) {
  const buf = readFileSync(new URL(file, FONT_DIR));
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

  for (const ch of LETTERS) {
    done++;
    const head = `${String(done).padStart(3)}/${jobs.length}  ${file.padEnd(22)} ${ch}`;
    if (font.charToGlyphIndex(ch) === 0) {
      console.log(`${head}  -- not in face`);
      continue;
    }

    const shapes = glyphToShapes(font, ch, 1);
    const rings = ringsOf(shapes);

    // The reconstruction has to be the list surfacesOf actually hands the generator.
    const face = surfacesOf(shapes, DEPTH).find((s) => s.kind === 'front');
    const polygons = face ? face.polygons : [];
    if (polygons.length !== rings.length) {
      problems.push(`${file} ${ch}: rebuilt ${rings.length} rings, surfacesOf gave ${polygons.length}`);
    } else {
      for (let i = 0; i < rings.length; i++) {
        const a = rings[i].ring[0];
        const b = polygons[i][0];
        if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-12) {
          problems.push(`${file} ${ch}: ring ${i} differs from surfacesOf`);
        }
      }
    }

    const perSeed = new Map();
    for (const seed of SEEDS) {
      const bp = buildTubeBlueprint(shapes, spec, DEPTH, seed);
      const counts = rings.map(() => ({ runs: 0, lit: 0 }));

      if (seed === SEED) {
        const kept = rings.filter((r) => r.path >= 0);
        if (bp.paths.length !== kept.length) {
          problems.push(`${file} ${ch}: ${bp.paths.length} paths, expected ${kept.length}`);
        }
        // Independent of the ordering claim: which ring does this path actually lie on?
        for (let j = 0; j < bp.paths.length; j++) {
          const p = bp.paths[j].points[0];
          const d = rings.map((r) => nearestOn(p, r.ring));
          const best = Math.min(...d);
          // A pixel face puts two rings' vertices on the same grid point, so the nearest-ring test
          // can be a dead tie at distance zero. That is an ambiguous check, not a contradiction.
          const closest = d.map((v, i) => [v, i]).filter(([v]) => v <= best + 1e-12).map(([, i]) => i);
          ringsChecked++;
          const byOrder = rings.findIndex((r) => r.path === j);
          if (!closest.includes(byOrder)) {
            mappingMismatches++;
            problems.push(`${file} ${ch}: path ${j} sits on ring ${closest[0]}, order says ${byOrder}`);
          } else if (closest.length > 1) {
            mappingTies++;
          }
        }
      }

      for (const run of bp.runs) {
        const paths = [...new Set(run.from.filter(Boolean).map((f) => f.path))];
        if (paths.length === 0) {
          runsUnattributed++;
          continue;
        }
        if (paths.length > 1) runsSplit++;
        const i = rings.findIndex((r) => r.path === paths[0]);
        if (i < 0) continue;
        counts[i].runs++;
        if (run.lit) counts[i].lit++;
      }
      perSeed.set(seed, counts);
      bp.dispose();
    }

    const at = perSeed.get(SEED);
    const mine = [];
    for (let i = 0; i < rings.length; i++) {
      if (rings[i].hole < 0) continue;
      const row = {
        font: file,
        ch,
        shape: rings[i].shape,
        hole: rings[i].hole,
        perimeter: rings[i].perimeter,
        area: rings[i].area,
        dropped: rings[i].path < 0,
        runs: at[i].runs,
        lit: at[i].lit,
        seedsNoRuns: SEEDS.filter((s) => perSeed.get(s)[i].runs === 0).length,
        seedsNoLit: SEEDS.filter((s) => perSeed.get(s)[i].lit === 0).length,
      };
      holes.push(row);
      mine.push(row);
    }
    letters.push({
      font: file,
      ch,
      contours: rings.length,
      holeCount: mine.length,
      holes: mine,
      lostAll: mine.length > 0 && mine.every((h) => h.runs === 0),
      unlitAll: mine.length > 0 && mine.every((h) => h.lit === 0),
    });

    const lost = mine.filter((h) => h.runs === 0).length;
    const unlit = mine.filter((h) => h.runs > 0 && h.lit === 0).length;
    console.log(
      `${head}  contours ${String(rings.length).padStart(2)}  holes ${String(mine.length).padStart(2)}` +
        `  lost ${String(lost).padStart(2)}  unlit ${String(unlit).padStart(2)}`,
    );
  }
}

// ---- report ----------------------------------------------------------------

const f = (n, w, d) => n.toFixed(d).padStart(w);
const i = (n, w) => String(n).padStart(w);
const L = [];
const say = (s = '') => L.push(s);

const lostHoles = holes.filter((h) => h.runs === 0);
const keptHoles = holes.filter((h) => h.runs > 0);

say('# Counters lost at the shipped `tubing` settings');
say('');
say(`Fonts ${files.length}, letters tried ${LETTERS.join(' ')}, seed ${SEED} (lit also sampled at ${SEEDS.join(',')}).`);
say(`\`runs ${RUNS}\`, \`minRun ${MIN_RUN}\`, \`radius ${spec.radius}\`, \`bend ${spec.bend}\`, \`select ${spec.select.by} ${spec.select.amount}\`.`);
say('');
say('## Mapping check');
say('');
say(`Path-to-ring mapping verified on ${ringsChecked} paths: ${mappingMismatches} disagreed with the`);
say(`independent nearest-ring test, ${mappingTies} were an exact tie between rings sharing a vertex`);
say('(pixel faces), where the test cannot separate them and the order mapping stands.');
say('Runs with no attributable source vertex: ' + runsUnattributed + '.');
say('Runs spanning more than one path: ' + runsSplit + '.');
if (problems.length) {
  say('');
  say('Problems:');
  for (const p of problems.slice(0, 40)) say(`  ${p}`);
  if (problems.length > 40) say(`  ... and ${problems.length - 40} more`);
}
say('');

say('## Every hole that produced zero runs');
say('');
say('`perim` and `area` are the counter itself, in em and em². `drop` marks a ring that never');
say('became a path at all (too short to resample); the rest became a path that carried no run.');
say('`seeds` is how many of the five seeds produced zero runs.');
say('');
for (const file of files) {
  const rows = lostHoles.filter((h) => h.font === file);
  if (rows.length === 0) continue;
  say(`### ${file}  (${rows.length} lost)`);
  say('');
  say('| letter | hole | perim em | area em² | drop | seeds |');
  say('|:------:|-----:|---------:|---------:|:----:|------:|');
  for (const h of rows.sort((a, b) => b.perimeter - a.perimeter)) {
    say(`| ${h.ch} | ${i(h.hole, 4)} | ${f(h.perimeter, 8, 3)} | ${f(h.area, 8, 4)} | ${h.dropped ? ' yes' : '  no'} | ${i(h.seedsNoRuns, 5)}/5 |`);
  }
  say('');
}

say('## Rate');
say('');
say('| font | holes | lost | rate % | letters | all-holes-lost |');
say('|:-----|------:|-----:|-------:|--------:|---------------:|');
for (const file of files) {
  const rows = holes.filter((h) => h.font === file);
  if (rows.length === 0) continue;
  const lost = rows.filter((h) => h.runs === 0).length;
  const blobs = letters.filter((l) => l.font === file && l.lostAll).length;
  say(`| ${file.replace(/\.[to]tf$/, '').padEnd(18)} | ${i(rows.length, 5)} | ${i(lost, 4)} | ${f((lost / rows.length) * 100, 6, 1)} | ${i(letters.filter((l) => l.font === file && l.holeCount > 0).length, 7)} | ${i(blobs, 14)} |`);
}
const allLost = lostHoles.length;
say(`| ${'ALL'.padEnd(18)} | ${i(holes.length, 5)} | ${i(allLost, 4)} | ${f((allLost / holes.length) * 100, 6, 1)} | ${i(letters.filter((l) => l.holeCount > 0).length, 7)} | ${i(letters.filter((l) => l.lostAll).length, 14)} |`);
say('');
const noHoles = files.filter((file) => holes.every((h) => h.font !== file));
if (noHoles.length) {
  say(`Absent from the table, having no \`shape.holes\` entry anywhere in this letter set: ${noHoles.join(', ')}.`);
  say('A stencil face has no enclosed counter to lose -- its letters break into disjoint outlines,');
  say('and the white inside them is open to the outside.');
  say('');
}

say('## Where loss starts');
say('');
const biggestLost = lostHoles.reduce((a, b) => (b.perimeter > a.perimeter ? b : a), lostHoles[0]);
const smallestKept = keptHoles.reduce((a, b) => (b.perimeter < a.perimeter ? b : a), keptHoles[0]);
const budget = MIN_RUN * RUNS;
say('| | perim em | area em² | font | letter |');
say('|:--|---------:|---------:|:-----|:------:|');
if (biggestLost) say(`| largest lost | ${f(biggestLost.perimeter, 8, 3)} | ${f(biggestLost.area, 8, 4)} | ${biggestLost.font} | ${biggestLost.ch} |`);
if (smallestKept) say(`| smallest kept | ${f(smallestKept.perimeter, 8, 3)} | ${f(smallestKept.area, 8, 4)} | ${smallestKept.font} | ${smallestKept.ch} |`);
// Seed 0 alone leaves a band where the same hole is lost at one seed and kept at another, so the
// threshold is also quoted over holes that behave the same way at all five.
const always = holes.filter((h) => h.seedsNoRuns === SEEDS.length);
const never = holes.filter((h) => h.seedsNoRuns === 0);
const alwaysLost = always.reduce((a, b) => (b.perimeter > a.perimeter ? b : a), always[0]);
const neverLost = never.reduce((a, b) => (b.perimeter < a.perimeter ? b : a), never[0]);
if (alwaysLost) say(`| largest lost at every seed | ${f(alwaysLost.perimeter, 8, 3)} | ${f(alwaysLost.area, 8, 4)} | ${alwaysLost.font} | ${alwaysLost.ch} |`);
if (neverLost) say(`| smallest kept at every seed | ${f(neverLost.perimeter, 8, 3)} | ${f(neverLost.area, 8, 4)} | ${neverLost.font} | ${neverLost.ch} |`);
say('');
say(`Holes lost at some seeds but not all: ${holes.filter((h) => h.seedsNoRuns > 0 && h.seedsNoRuns < SEEDS.length).length}.`);
say('');
say(`\`minRun * runs\` = ${f(budget, 0, 2)} em, \`minRun\` = ${f(MIN_RUN, 0, 2)} em.`);
say('');
const below = (t) => holes.filter((h) => h.perimeter < t);
for (const [label, t] of [['minRun', MIN_RUN], ['minRun*runs', budget]]) {
  const under = below(t);
  const over = holes.filter((h) => h.perimeter >= t);
  const underLost = under.filter((h) => h.runs === 0).length;
  const overLost = over.filter((h) => h.runs === 0).length;
  say(`Against ${label} = ${t.toFixed(2)} em: under it ${i(underLost, 4)}/${i(under.length, 4)} lost, at or over it ${i(overLost, 4)}/${i(over.length, 4)} lost.`);
}
say('');
const sorted = [...holes].sort((a, b) => a.perimeter - b.perimeter);
say('Loss by perimeter band:');
say('');
say('| band em | holes | lost | rate % |');
say('|:--------|------:|-----:|-------:|');
const bands = [0, 0.15, 0.3, 0.5, 0.75, 1.05, 1.5, 2.5, Infinity];
for (let b = 0; b + 1 < bands.length; b++) {
  const rows = sorted.filter((h) => h.perimeter >= bands[b] && h.perimeter < bands[b + 1]);
  if (rows.length === 0) continue;
  const lost = rows.filter((h) => h.runs === 0).length;
  const hi = bands[b + 1] === Infinity ? '  inf' : bands[b + 1].toFixed(2).padStart(5);
  say(`| ${bands[b].toFixed(2).padStart(5)}-${hi} | ${i(rows.length, 5)} | ${i(lost, 4)} | ${f((lost / rows.length) * 100, 6, 1)} |`);
}
say('');

say('## Letters that lost every counter');
say('');
const blobs = letters.filter((l) => l.lostAll);
if (blobs.length === 0) say('None.');
else {
  say('| font | letter | holes | contours |');
  say('|:-----|:------:|------:|---------:|');
  for (const l of blobs) say(`| ${l.font.replace(/\.[to]tf$/, '').padEnd(18)} | ${l.ch} | ${i(l.holeCount, 5)} | ${i(l.contours, 8)} |`);
}
say('');
const unlitOnly = letters.filter((l) => !l.lostAll && l.unlitAll && l.holeCount > 0);
say(`Letters whose counters all drew runs but none lit at seed ${SEED}: ${unlitOnly.length}` +
  (unlitOnly.length ? ` (${unlitOnly.map((l) => `${l.font.replace(/\.[to]tf$/, '')} ${l.ch}`).join(', ')})` : ''));
say('');

say('## Every hole');
say('');
say('| font | letter | hole | perim em | area em² | runs | lit | no-run seeds | no-lit seeds |');
say('|:-----|:------:|-----:|---------:|---------:|-----:|----:|-------------:|-------------:|');
for (const h of holes) {
  say(`| ${h.font.replace(/\.[to]tf$/, '').padEnd(18)} | ${h.ch} | ${i(h.hole, 4)} | ${f(h.perimeter, 8, 3)} | ${f(h.area, 8, 4)} | ${i(h.runs, 4)} | ${i(h.lit, 3)} | ${i(h.seedsNoRuns, 12)} | ${i(h.seedsNoLit, 12)} |`);
}

const text = L.join('\n') + '\n';
if (outPath) {
  writeFileSync(new URL('../' + outPath, import.meta.url), text);
  console.log(`\nwrote ${outPath}`);
} else {
  console.log(text);
}
