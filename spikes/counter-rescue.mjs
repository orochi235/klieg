/**
 * Prototype rescue for counters that draw nothing or light nothing under `tubing`.
 *
 *   node spikes/counter-rescue.mjs --out spikes/counter-rescue.md
 *
 * Classifies every counter at stock settings (LIT, DARK_ALL, SELECT_UNLIT, NONE), then walks each
 * non-LIT one down a ladder -- blockout 0 at radius x 1.00, 0.85, 0.70, 0.60, 0.50 -- and stops at
 * the first rung leaving a lightable (non-dark) span of at least `minRun`. Also evaluates rule F,
 * radius = min(radius, minRho / max(1.25, bend)), on the same counters.
 *
 * Every rung runs two ways, because neither is faithful on its own:
 *   isolated -- the counter alone, as its own outer contour (the direct generator's `orientRings`
 *     rewinds it). Changes the run budget, the corner seed base, the wander seed and the select
 *     pool. The select pool is the serious one: `select` lights round(0.85 x n), which is every run
 *     whenever n <= 3, so an isolated counter is lit almost by construction.
 *   in-glyph -- the override applied to the whole glyph, counter attributed back by path index.
 *     Context is real; the override is not per-counter, so the outer contour moves too.
 *
 * A rung's outcome at one seed can be a corner-strategy draw rather than the radius, so the ladder
 * is repeated at seeds 0-9 and a rung is only called robust when it rescues at all ten.
 *
 * Seed 0 for the letter set; Archivo Black (apps/lab/public/font.ttf) additionally builds
 * JACKPOT! at slot seeds, which is how decorations/tube.ts seeds a letter.
 *
 * Reads the built package, so `npm run build -w klieg` first.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import opentype from 'opentype.js';
import * as THREE from 'three';
import { specOf } from '../packages/core/dist/render/looks.js';
import { cornersByBend, minBendRadius, STYLE_FACTOR, vertexBends } from '../packages/core/dist/render/tube/bend.js';
import { buildTubeBlueprint } from '../packages/core/dist/render/tube/index.js';
import { offsetRing, orientRings } from '../packages/core/dist/render/tube/offset.js';
import { minCurvatureRadius3, pathLength, resample } from '../packages/core/dist/render/tube/resample.js';
import { cutIntoRuns } from '../packages/core/dist/render/tube/runs.js';
import { surfacesOf } from '../packages/core/dist/render/tube/surfaces.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const LETTERS = [...'ABDOPQRabdegopq04689@&'];
const WORD = 'JACKPOT!';
const DEPTH = 0.3;
const SEED = 0;
const SWEEP = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const RING_SPACING = 0.01;
const RUNGS = [
  ['R1', 1.0],
  ['R2', 0.85],
  ['R3', 0.7],
  ['R4', 0.6],
  ['R5', 0.5],
];

const FONT_DIR = new URL('../apps/lab/public/fonts/', import.meta.url);
const FONTS = [
  ...readdirSync(FONT_DIR)
    .filter((f) => /\.(ttf|otf)$/.test(f))
    .sort()
    .map((f) => ({ name: f.replace(/\.[to]tf$/, ''), url: new URL(f, FONT_DIR) })),
  { name: 'archivo-black', url: new URL('../apps/lab/public/font.ttf', import.meta.url) },
];
const ARCHIVO = 'archivo-black';

const outArg = process.argv.indexOf('--out');
const outPath = outArg >= 0 ? process.argv[outArg + 1] : null;

const stock = specOf('tubing').decoration;
if (stock?.kind !== 'tube') throw new Error('tubing has no tube decoration');
const R = stock.radius;
const BEND = stock.bend;
const MIN_RUN = stock.minRun;
const bendFloor = Math.max(1.25, BEND ?? 2);

const problems = [];
let replays = 0;

function loadFont(url) {
  const buf = readFileSync(url);
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function contourPoints(contour) {
  const raw = contour.getPoints(24).map((p) => ({ x: p.x, y: p.y }));
  const first = raw[0];
  const last = raw[raw.length - 1];
  if (raw.length > 1 && first && last && Math.hypot(first.x - last.x, first.y - last.y) < 1e-9) {
    raw.pop();
  }
  return resample(raw, RING_SPACING);
}

/** surfacesOf's ring list, each ring labeled with its contour and the path index it lands at. */
function ringsOf(shapes) {
  const rings = [];
  for (let s = 0; s < shapes.length; s++) {
    const contours = [shapes[s], ...shapes[s].holes];
    for (let c = 0; c < contours.length; c++) {
      const ring = contourPoints(contours[c]);
      if (ring.length < 3) continue;
      rings.push({ hole: c === 0 ? -1 : c - 1, contour: contours[c], ring, perimeter: pathLength([...ring, ring[0]]), path: -1 });
    }
  }
  const oriented = orientRings(rings.map((r) => r.ring));
  let path = 0;
  for (let i = 0; i < rings.length; i++) {
    const line = resample(offsetRing(oriented[i], stock.level), stock.spacing);
    if (line.length >= 4) rings[i].path = path++;
  }
  return rings;
}

const firstPath = (run) => run.from.find(Boolean)?.path ?? -1;

/** What a report needs from a run, taken before `dispose` empties the run list. */
const snap = (run) => ({ length: run.length, lit: run.lit, dark: run.dark === true, curv: minCurvatureRadius3(run.points) });

function classify(runs) {
  if (runs.length === 0) return 'NONE';
  if (runs.some((r) => r.lit)) return 'LIT';
  if (runs.every((r) => r.dark)) return 'DARK_ALL';
  return 'SELECT_UNLIT';
}
const rescued = (runs) => runs.some((r) => !r.dark);
const litAt = (runs) => runs?.some((r) => r.lit);

/** A hole as a shape of its own: same curves, so the same ring, with no holes of its own. */
function isolatedShape(contour) {
  const shape = new THREE.Shape();
  THREE.Path.prototype.copy.call(shape, contour);
  return shape;
}

const specAt = (k, blockout) => ({ ...stock, radius: R * k, blockout });

function buildIsolated(counter, spec, seed) {
  const bp = buildTubeBlueprint([isolatedShape(counter.contour)], spec, DEPTH, seed);
  if (bp.paths.length !== 1) problems.push(`${counter.font} ${counter.ch} hole ${counter.hole}: isolated build made ${bp.paths.length} paths`);
  const out = { runs: bp.runs.map(snap), points: bp.paths[0]?.points.map((p) => p.clone()) ?? [] };
  bp.dispose();
  return out;
}

const attribute = (runs, rings) => {
  const byRing = rings.map(() => []);
  for (const run of runs) {
    const i = rings.findIndex((r) => r.path === firstPath(run));
    if (i >= 0) byRing[i].push(run);
  }
  return byRing;
};

/** Runs per ring for one whole-glyph build, plus the wandered paths the cut received. */
function buildGlyph(shapes, rings, spec, seed) {
  const bp = buildTubeBlueprint(shapes, spec, DEPTH, seed);
  const byRing = attribute(bp.runs, rings).map((rs) => rs.map(snap));
  const out = { byRing, paths: bp.paths, runCount: bp.runs.length };
  bp.dispose();
  return out;
}

const cutOptsOf = (spec, seed) => ({
  corners: spec.corners,
  spacing: spec.spacing,
  bend: spec.bend,
  radius: spec.radius,
  blockout: spec.blockout,
  shortRun: spec.shortRun,
  rejoin: spec.rejoin,
  hairpin: spec.hairpin,
  seed,
});

const minRho = (points) => vertexBends(points, true).reduce((a, b) => Math.min(a, b.rho), Number.POSITIVE_INFINITY);

/** Every measurement for the counters of one glyph, headline at `seed`. */
function measureGlyph(fontName, font, ch, seed, context) {
  const shapes = glyphToShapes(font, ch, 1);
  const rings = ringsOf(shapes);
  const holeIdx = rings.map((r, i) => (r.hole >= 0 ? i : -1)).filter((i) => i >= 0);
  if (holeIdx.length === 0) return [];

  const face = surfacesOf(shapes, DEPTH).find((s) => s.kind === 'front');
  if (!face || face.polygons.length !== rings.length) problems.push(`${fontName} ${ch}: ring reconstruction disagrees with surfacesOf`);

  const glyphCache = new Map();
  const glyphAt = (spec, k, s) => {
    const key = `${k}:${spec.blockout}:${s}`;
    if (!glyphCache.has(key)) glyphCache.set(key, buildGlyph(shapes, rings, spec, s));
    return glyphCache.get(key);
  };
  const stockGlyph = glyphAt(stock, 1, seed);

  // Raw spans at stock, before the floor: one run per span, dark intact. Checked against the
  // pipeline by replaying the shipped settings the same way.
  const raw = attribute(cutIntoRuns(stockGlyph.paths, { ...cutOptsOf(stock, seed), runs: 0, minRun: 0 }).runs, rings);
  const replay = cutIntoRuns(stockGlyph.paths, { ...cutOptsOf(stock, seed), runs: stock.runs, minRun: MIN_RUN });
  replays++;
  if (replay.runs.length !== stockGlyph.runCount) problems.push(`${fontName} ${ch}: cut replay gave ${replay.runs.length} runs, pipeline ${stockGlyph.runCount}`);

  const mine = [];
  for (const i of holeIdx) {
    const c = { font: fontName, ch, hole: rings[i].hole, perimeter: rings[i].perimeter, seed, context, contour: rings[i].contour };
    c.cls = classify(stockGlyph.byRing[i]);
    c.raw = raw[i].map((r) => ({ length: r.length, dark: r.dark === true }));

    const iso0 = buildIsolated(c, stock, seed);
    c.isoCls = classify(iso0.runs);
    const isoRing = contourPoints(isolatedShape(c.contour));
    if (Math.abs(pathLength([...isoRing, isoRing[0]]) - c.perimeter) > 1e-9) problems.push(`${fontName} ${ch} hole ${c.hole}: isolated ring perimeter differs`);

    // Rule F, on the path the cut sees (wandered, 3D) and on the flat ring.
    const flat = iso0.points.map((p) => new THREE.Vector3(p.x, p.y, 0));
    c.minRho3 = minRho(iso0.points);
    c.minRho2 = minRho(flat);
    c.f3 = Math.min(R, c.minRho3 / bendFloor) / R;
    c.f2 = Math.min(R, c.minRho2 / bendFloor) / R;

    if (c.cls === 'LIT') {
      c.stockRuns = stockGlyph.byRing[i];
    } else {
      for (const [name, k] of RUNGS) {
        const runs = buildIsolated(c, specAt(k, 0), seed).runs;
        if (rescued(runs)) {
          Object.assign(c, { isoRung: name, isoK: k, isoRuns: runs });
          break;
        }
      }
      for (const [name, k] of RUNGS) {
        const runs = glyphAt(specAt(k, 0), k, seed).byRing[i];
        if (rescued(runs)) {
          Object.assign(c, { glyphRung: name, glyphK: k, glyphRuns: runs });
          break;
        }
      }
      // F as stated: only the radius moves, blockout stays stock.
      const rF = R * c.f3;
      const fBuild = buildIsolated(c, { ...stock, radius: rF }, seed);
      c.fCorners = cornersByBend(fBuild.points, true, minBendRadius(rF, BEND), rF * STYLE_FACTOR).length;
      c.fRescued = rescued(fBuild.runs);
      c.fCls = classify(fBuild.runs);

      // Every rung at every sweep seed, independently of the ladder's stop.
      c.sweepGlyph = RUNGS.map(() => 0);
      c.sweepGlyphUnlit = RUNGS.map(() => 0);
      c.sweepIso = RUNGS.map(() => 0);
      for (const s of SWEEP) {
        RUNGS.forEach(([, k], r) => {
          const g = glyphAt(specAt(k, 0), k, s).byRing[i];
          if (rescued(g)) {
            c.sweepGlyph[r]++;
            if (!litAt(g)) c.sweepGlyphUnlit[r]++;
          }
          if (rescued(buildIsolated(c, specAt(k, 0), s).runs)) c.sweepIso[r]++;
        });
      }
      const robust = (counts) => RUNGS[counts.findIndex((n) => n === SWEEP.length)]?.[0];
      c.robustGlyph = robust(c.sweepGlyph);
      c.robustIso = robust(c.sweepIso);
    }
    delete c.contour;
    mine.push(c);
  }
  return mine;
}

// ---- run -------------------------------------------------------------------

const counters = [];
const jobs = FONTS.length * LETTERS.length + WORD.length;
let done = 0;
const tag = (c) => (c.cls === 'LIT' ? 'LIT' : `${c.cls}->${c.isoRung ?? 'UNRESC'}/${c.glyphRung ?? 'UNRESC'} robust ${c.robustGlyph ?? '-'}`);

for (const { name, url } of FONTS) {
  const font = loadFont(url);
  for (const ch of LETTERS) {
    done++;
    const head = `${String(done).padStart(3)}/${jobs}  ${name.padEnd(18)} ${ch}`;
    if (font.charToGlyphIndex(ch) === 0) {
      console.log(`${head}  -- not in face`);
      continue;
    }
    const mine = measureGlyph(name, font, ch, SEED, 'set');
    counters.push(...mine);
    console.log(`${head}  counters ${String(mine.length).padStart(2)}  ${mine.map(tag).join('  ')}`);
  }
}

const archivo = loadFont(FONTS.find((x) => x.name === ARCHIVO).url);
const jackpot = [];
for (let slot = 0; slot < WORD.length; slot++) {
  done++;
  const ch = WORD[slot];
  const head = `${String(done).padStart(3)}/${jobs}  ${`${ARCHIVO} ${WORD}`.padEnd(18)} ${ch} seed ${slot}`;
  if (archivo.charToGlyphIndex(ch) === 0) {
    console.log(`${head}  -- not in face`);
    continue;
  }
  const mine = measureGlyph(ARCHIVO, archivo, ch, slot, WORD);
  jackpot.push(...mine);
  console.log(`${head}  counters ${String(mine.length).padStart(2)}  ${mine.map(tag).join('  ')}`);
}

// ---- report ----------------------------------------------------------------

const f = (n, w, d) => (Number.isFinite(n) ? n.toFixed(d) : 'inf').padStart(w);
const i = (n, w) => String(n).padStart(w);
const L = [];
const say = (s = '') => L.push(s);
const CLASSES = ['LIT', 'DARK_ALL', 'SELECT_UNLIT', 'NONE'];
const nonLit = counters.filter((c) => c.cls !== 'LIT');
const N = SWEEP.length;

say('# Counter rescue prototype');
say('');
say(`Shipped \`tubing\`: radius ${R}, bend ${BEND}, minRun ${MIN_RUN}, blockout ${stock.blockout}, select ${stock.select.by} ${stock.select.amount}.`);
say(`${FONTS.length} faces (the ${FONTS.length - 1} in apps/lab/public/fonts/ plus Archivo Black, apps/lab/public/font.ttf), letters ${LETTERS.join('')}, seed ${SEED}; seed sweep ${SWEEP[0]}-${SWEEP[SWEEP.length - 1]}.`);
say(`Counters measured: ${counters.length}, of which ${nonLit.length} are not LIT.`);
say('');
if (problems.length) {
  say('Problems:');
  for (const p of problems.slice(0, 30)) say(`  ${p}`);
  if (problems.length > 30) say(`  ... and ${problems.length - 30} more`);
} else {
  say(`Ring reconstruction, isolated-ring perimeter, isolated path count and ${replays} cut replays checked: no problems.`);
}
say('');

say('## Classes at stock settings (in-glyph, seed 0)');
say('');
say(`| face | ${CLASSES.map((k) => k.padStart(12)).join(' | ')} | total |`);
say(`|:--|${CLASSES.map(() => '-------------:').join('|')}|------:|`);
for (const { name } of FONTS) {
  const set = counters.filter((c) => c.font === name);
  if (set.length === 0) continue;
  say(`| ${name.padEnd(18)} | ${CLASSES.map((k) => i(set.filter((c) => c.cls === k).length, 12)).join(' | ')} | ${i(set.length, 5)} |`);
}
say(`| ${'ALL'.padEnd(18)} | ${CLASSES.map((k) => i(counters.filter((c) => c.cls === k).length, 12)).join(' | ')} | ${i(counters.length, 5)} |`);
const noHoles = FONTS.filter(({ name }) => counters.every((c) => c.font !== name)).map((x) => x.name);
if (noHoles.length) say(`\nNo counters in this letter set: ${noHoles.join(', ')}.`);
say('');

say('### Why DARK_ALL');
say('');
say('Raw spans at stock, before the floor. A dark span is exempt from `minRun`; a lightable one under it is dropped.');
say('');
const darkAll = counters.filter((c) => c.cls === 'DARK_ALL');
const lightable = (c) => c.raw.filter((s) => !s.dark);
const noLightable = darkAll.filter((c) => lightable(c).length === 0).length;
const shortLightable = darkAll.filter((c) => lightable(c).length > 0 && lightable(c).every((s) => s.length < MIN_RUN)).length;
say(`DARK_ALL counters: ${darkAll.length}. No lightable raw span at all: ${noLightable}. Lightable spans present but every one under ${MIN_RUN} em: ${shortLightable}. Any other: ${darkAll.length - noLightable - shortLightable}.`);
say('');
say('| face | letter | hole | perim em | dark spans | dark em | lightable spans | longest lightable em |');
say('|:--|:--:|---:|--------:|----------:|--------:|---------------:|--------------------:|');
for (const c of [...darkAll].sort((a, b) => b.perimeter - a.perimeter)) {
  const d = c.raw.filter((s) => s.dark);
  const l = lightable(c);
  say(`| ${c.font.padEnd(18)} | ${c.ch} | ${i(c.hole, 3)} | ${f(c.perimeter, 7, 3)} | ${i(d.length, 9)} | ${f(d.reduce((a, s) => a + s.length, 0), 7, 3)} | ${i(l.length, 14)} | ${f(l.reduce((a, s) => Math.max(a, s.length), 0), 19, 3)} |`);
}
say('');

say('## Isolation agreement at stock settings');
say('');
const agree = counters.filter((c) => c.cls === c.isoCls).length;
const nonLitAgree = nonLit.filter((c) => c.cls === c.isoCls).length;
say(`Isolated class matches in-glyph class on **${agree}/${counters.length} counters (${f((agree / counters.length) * 100, 0, 1)}%)**, but on only **${nonLitAgree}/${nonLit.length} (${f((nonLitAgree / nonLit.length) * 100, 0, 1)}%) of the non-LIT ones** -- the counters the ladder is for.`);
say('');
say('Rows in-glyph, columns isolated:');
say('');
say(`| in-glyph \\ isolated | ${CLASSES.map((k) => k.padStart(12)).join(' | ')} |`);
say(`|:--|${CLASSES.map(() => '-------------:').join('|')}|`);
for (const a of CLASSES) {
  say(`| ${a.padEnd(12)} | ${CLASSES.map((b) => i(counters.filter((c) => c.cls === a && c.isoCls === b).length, 12)).join(' | ')} |`);
}
say('');
say('`select` lights round(0.85 x n) runs, so a pool of 1, 2 or 3 lightable runs is lit in full: an isolated counter');
say('cannot be SELECT_UNLIT unless it carries 4 or more lightable runs.');
say('');

say('## Rescue ladder (blockout 0, radius x k), seed 0');
say('');
say(`Rescued = at least one non-dark run survives, i.e. a lightable span of at least ${MIN_RUN} em.`);
say('');
say('| rung | k | isolated | in-glyph |');
say('|:-----|-----:|---------:|---------:|');
for (const [name, k] of RUNGS) {
  say(`| ${name} | ${f(k, 4, 2)} | ${i(nonLit.filter((c) => c.isoRung === name).length, 8)} | ${i(nonLit.filter((c) => c.glyphRung === name).length, 8)} |`);
}
say(`| UNRESCUED | | ${i(nonLit.filter((c) => !c.isoRung).length, 8)} | ${i(nonLit.filter((c) => !c.glyphRung).length, 8)} |`);
say('');
const rungAgree = nonLit.filter((c) => (c.isoRung ?? 'U') === (c.glyphRung ?? 'U')).length;
say(`Isolated and in-glyph name the same seed-0 rung on ${rungAgree}/${nonLit.length} counters.`);
say('');
say('By stock class:');
say('');
say('| stock class | n | R1 iso | R1 glyph | later iso | later glyph | unresc iso | unresc glyph |');
say('|:--|--:|------:|--------:|---------:|-----------:|----------:|------------:|');
for (const k of CLASSES.slice(1)) {
  const set = nonLit.filter((c) => c.cls === k);
  if (set.length === 0) continue;
  say(`| ${k.padEnd(12)} | ${i(set.length, 3)} | ${i(set.filter((c) => c.isoRung === 'R1').length, 5)} | ${i(set.filter((c) => c.glyphRung === 'R1').length, 7)} | ${i(set.filter((c) => c.isoRung && c.isoRung !== 'R1').length, 8)} | ${i(set.filter((c) => c.glyphRung && c.glyphRung !== 'R1').length, 10)} | ${i(set.filter((c) => !c.isoRung).length, 9)} | ${i(set.filter((c) => !c.glyphRung).length, 11)} |`);
}
say('');

say('## Rung stability, seeds 0-9');
say('');
say(`Each rung built at every seed, independently of where the ladder stopped. A cell is the seeds out of ${N} at which that`);
say(`rung rescues. **Robust** is the first rung rescuing at all ${N}; \`unlit\` is how many of the ${N} seeds leave the counter`);
say('rescued but unlit by select at the robust in-glyph rung.');
say('');
say('| rung | robust in-glyph | robust isolated |');
say('|:--|---------------:|---------------:|');
for (const [name] of RUNGS) say(`| ${name} | ${i(nonLit.filter((c) => c.robustGlyph === name).length, 14)} | ${i(nonLit.filter((c) => c.robustIso === name).length, 14)} |`);
say(`| never robust | ${i(nonLit.filter((c) => !c.robustGlyph).length, 14)} | ${i(nonLit.filter((c) => !c.robustIso).length, 14)} |`);
say('');
const robustAgree = nonLit.filter((c) => (c.robustGlyph ?? 'U') === (c.robustIso ?? 'U')).length;
say(`Robust rung agrees between isolated and in-glyph on ${robustAgree}/${nonLit.length} counters.`);
const drawOnly = nonLit.filter((c) => c.sweepGlyph.some((n) => n > 0 && n < N) || c.sweepIso.some((n) => n > 0 && n < N));
say(`Counters with at least one rung that rescues at some seeds but not all (a draw, not a radius): ${drawOnly.length}/${nonLit.length}.`);
const robustSet = nonLit.filter((c) => c.robustGlyph);
const unlitSeeds = robustSet.reduce((a, c) => a + c.sweepGlyphUnlit[RUNGS.findIndex(([nm]) => nm === c.robustGlyph)], 0);
say(`At the robust in-glyph rung, select leaves a rescued counter unlit on ${unlitSeeds} of ${robustSet.length * N} counter-seeds (${f((unlitSeeds / Math.max(1, robustSet.length * N)) * 100, 0, 1)}%) -- the rate a "light the longest non-dark run" guarantee would fire.`);
say('');
say('| face | letter | hole | perim em | class | glyph R1 R2 R3 R4 R5 | iso R1 R2 R3 R4 R5 | robust glyph | robust iso | unlit |');
say('|:--|:--:|---:|--------:|:--|:--|:--|:--|:--|----:|');
for (const c of [...nonLit].sort((a, b) => b.perimeter - a.perimeter)) {
  const cells = (arr) => arr.map((n) => i(n, 2)).join(' ');
  const r = RUNGS.findIndex(([nm]) => nm === c.robustGlyph);
  say(`| ${c.font.padEnd(18)} | ${c.ch} | ${i(c.hole, 3)} | ${f(c.perimeter, 7, 3)} | ${c.cls.padEnd(12)} | ${cells(c.sweepGlyph)} | ${cells(c.sweepIso)} | ${(c.robustGlyph ?? 'never').padEnd(5)} | ${(c.robustIso ?? 'never').padEnd(5)} | ${r >= 0 ? i(c.sweepGlyphUnlit[r], 3) : '  —'} |`);
}
say('');
const neverGlyph = nonLit.filter((c) => !c.robustGlyph).sort((a, b) => b.perimeter - a.perimeter);
say('Never robustly rescued in-glyph, by perimeter:');
say('');
say('| face | letter | hole | perim em | best rung seeds/10 |');
say('|:--|:--:|---:|--------:|------------------:|');
for (const c of neverGlyph) say(`| ${c.font.padEnd(18)} | ${c.ch} | ${i(c.hole, 3)} | ${f(c.perimeter, 7, 3)} | ${i(Math.max(...c.sweepGlyph), 17)} |`);
say('');

say('## Does select light it at the seed-0 rescuing rung?');
say('');
const isoResc = nonLit.filter((c) => c.isoRung);
const glyphResc = nonLit.filter((c) => c.glyphRung);
const isoNeed = isoResc.filter((c) => !litAt(c.isoRuns));
const glyphNeed = glyphResc.filter((c) => !litAt(c.glyphRuns));
say('| | rescued | select lights one | needs the guarantee |');
say('|:--|--------:|------------------:|--------------------:|');
say(`| isolated | ${i(isoResc.length, 7)} | ${i(isoResc.length - isoNeed.length, 17)} | ${i(isoNeed.length, 19)} |`);
say(`| in-glyph | ${i(glyphResc.length, 7)} | ${i(glyphResc.length - glyphNeed.length, 17)} | ${i(glyphNeed.length, 19)} |`);
say('');
if (glyphNeed.length) {
  say('In-glyph, rescued but left unlit by select:');
  say('');
  say('| face | letter | hole | perim em | rung | runs | longest em |');
  say('|:--|:--:|---:|--------:|:--|---:|----------:|');
  for (const c of glyphNeed) say(`| ${c.font.padEnd(18)} | ${c.ch} | ${i(c.hole, 3)} | ${f(c.perimeter, 7, 3)} | ${c.glyphRung} | ${i(c.glyphRuns.length, 3)} | ${f(Math.max(...c.glyphRuns.map((r) => r.length)), 9, 3)} |`);
  say('');
}

say('## Rule F: radius = min(radius, minRho / max(1.25, bend))');
say('');
say('`minRho` is the tightest vertex bend radius on the counter path the cut receives (`F cut`, wandered, 3D) and on the');
say(`same points flattened (\`F flat\`). Fractions are of the glyph radius ${R}. \`F corners\` and \`F rescued\` build the counter`);
say('isolated at the `F cut` radius with stock blockout -- the rule as stated.');
say('');
const touched = nonLit.filter((c) => c.f3 < 1 - 1e-9 || c.f2 < 1 - 1e-9).sort((a, b) => a.f3 - b.f3);
say(`Rule F touches ${touched.length}/${nonLit.length} non-LIT counters; ${touched.filter((c) => c.f3 < 0.5).length} fall below 0.5 on the cut path, ${touched.filter((c) => c.f2 < 0.5).length} on the flat ring. At its radius it leaves ${touched.filter((c) => c.fCorners === 0).length} with zero corners and rescues ${touched.filter((c) => c.fRescued).length}.`);
say('');
say('| face | letter | hole | perim em | minRho cut | F cut | minRho flat | F flat | <0.5 | F corners | F rescued | robust ladder (glyph) |');
say('|:--|:--:|---:|--------:|-----------:|------:|------------:|-------:|:--:|---------:|:--:|:--|');
for (const c of touched) {
  say(`| ${c.font.padEnd(18)} | ${c.ch} | ${i(c.hole, 3)} | ${f(c.perimeter, 7, 3)} | ${f(c.minRho3, 10, 4)} | ${f(c.f3, 5, 3)} | ${f(c.minRho2, 11, 4)} | ${f(c.f2, 6, 3)} | ${c.f3 < 0.5 ? ' ! ' : '   '} | ${i(c.fCorners, 8)} | ${c.fRescued ? 'yes' : ' no'} | ${c.robustGlyph ?? 'never'} |`);
}
say('');

say('## Self-intersection check');
say('');
say('Every surviving run at the seed-0 rescuing rung: `minCurvatureRadius3(run)` against `minBendRadius(radius x k, bend)`.');
say('The stock baseline runs the same check over LIT counters at stock radius. The control checks the thinned rungs\'');
say('runs against the stock radius\'s limit instead, which they should break -- it shows the check can go red.');
say('');
const flags = [];
const check = (set, mode, runsKey, kFor) => {
  let runs = 0;
  let worst = Number.POSITIVE_INFINITY;
  let flagged = 0;
  for (const c of set) {
    const limit = minBendRadius(R * kFor(c), BEND);
    for (const r of c[runsKey] ?? []) {
      runs++;
      const ratio = r.curv / limit;
      worst = Math.min(worst, ratio);
      if (ratio < 1 - 1e-9) {
        flagged++;
        if (mode !== 'control') flags.push({ mode, c, rung: c[mode === 'isolated' ? 'isoRung' : 'glyphRung'] ?? 'R0', len: r.length, curv: r.curv, limit, ratio });
      }
    }
  }
  return { runs, worst, flagged };
};
const sIso = check(isoResc, 'isolated', 'isoRuns', (c) => c.isoK);
const sGlyph = check(glyphResc, 'in-glyph', 'glyphRuns', (c) => c.glyphK);
const sStock = check(counters.filter((c) => c.cls === 'LIT'), 'stock', 'stockRuns', () => 1);
const sControl = check(isoResc.filter((c) => c.isoK < 1), 'control', 'isoRuns', () => 1);
say('| check | runs | flagged | worst curv / limit |');
say('|:--|-----:|-------:|------------------:|');
for (const [label, s] of [['rescued, isolated', sIso], ['rescued, in-glyph', sGlyph], ['stock LIT baseline', sStock], ['control (stock limit)', sControl]]) {
  say(`| ${label.padEnd(21)} | ${i(s.runs, 4)} | ${i(s.flagged, 6)} | ${f(s.worst, 17, 3)} |`);
}
say('');
const rescueFlags = flags.filter((x) => x.mode === 'isolated' || x.mode === 'in-glyph');
if (rescueFlags.length) {
  say('Every flag at a rescuing rung:');
  say('');
  say('| mode | face | letter | hole | rung | run em | curv em | limit em | ratio |');
  say('|:--|:--|:--:|---:|:--|------:|-------:|--------:|------:|');
  for (const x of rescueFlags.sort((a, b) => a.ratio - b.ratio)) {
    say(`| ${x.mode} | ${x.c.font.padEnd(18)} | ${x.c.ch} | ${i(x.c.hole, 3)} | ${x.rung} | ${f(x.len, 5, 3)} | ${f(x.curv, 6, 4)} | ${f(x.limit, 7, 4)} | ${f(x.ratio, 5, 3)} |`);
  }
} else {
  say('No run at any rescuing rung bends tighter than its glass allows.');
}
say('');

say(`## Archivo Black, ${WORD} at slot seeds`);
say('');
say('| letter | seed | hole | perim em | stock class | isolated class | rung iso | rung glyph | lit at rung (glyph) | robust glyph | F cut |');
say('|:--:|---:|---:|--------:|:--|:--|:--|:--|:--:|:--|------:|');
for (const c of jackpot) {
  const na = c.cls === 'LIT';
  const rungLit = na || !c.glyphRung ? '—' : litAt(c.glyphRuns) ? 'yes' : 'no';
  say(`| ${c.ch} | ${i(c.seed, 3)} | ${i(c.hole, 3)} | ${f(c.perimeter, 7, 3)} | ${c.cls} | ${c.isoCls} | ${na ? '—' : c.isoRung ?? 'UNRESCUED'} | ${na ? '—' : c.glyphRung ?? 'UNRESCUED'} | ${rungLit} | ${na ? '—' : c.robustGlyph ?? 'never'} | ${f(c.f3, 5, 3)} |`);
}
say('');

const text = L.join('\n') + '\n';
if (outPath) {
  writeFileSync(new URL('../' + outPath, import.meta.url), text);
  console.log(`\nwrote ${outPath}`);
} else {
  console.log(text);
}
