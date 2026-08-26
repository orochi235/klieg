/**
 * How much of a contour ends up with no tube over it?
 *
 *   npm run build -w klieg && node spikes/corner-coverage.mjs [look] [letters]
 *   CORNERS=connect|break|look  MIN_RUN=0  PATH_SOURCE=direct  node spikes/corner-coverage.mjs
 *
 * Path length minus run length is not the answer: a filleted corner is shorter than the corner it
 * replaced and still continuous. This walks the generated contour instead and asks, per vertex,
 * whether any drawn point lands within a tube radius of it. Uncovered arc length is what is missing.
 * `nicks` are stretches under 3 radii — a fillet cutting a sharp apex — and `holes` are the rest.
 *
 * `OUT=page.html` also draws every letter: grey contour, blue tube, red where nothing covers it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { minBendRadius } from '../packages/core/dist/render/tube/bend.js';
import { generatePaths } from '../packages/core/dist/render/tube/generators.js';
import { cutIntoRuns, RESUME_DROP } from '../packages/core/dist/render/tube/runs.js';
import { surfacesOf } from '../packages/core/dist/render/tube/surfaces.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const SOURCE = process.env.PATH_SOURCE ?? 'field';
const look = process.argv[2] ?? 'tubing';
const letters = process.argv[3] ?? 'tWMNSREAKX';
const spec = { ...specOf(look).decoration, pathSource: SOURCE };
const rhoMin = minBendRadius(spec.radius, spec.bend);
const WEIGHTS = { connect: { break: 0, connect: 1 }, break: { break: 1, connect: 0 } };
const mode = process.env.CORNERS ?? 'connect';
const corners = WEIGHTS[mode] ?? spec.corners;
const minRun = Number(process.env.MIN_RUN ?? spec.minRun);
const NICK = 3 * spec.radius;
const OUT = process.env.OUT;
const CELL = 260;
const panels = [];

/** Uniform grid over the drawn points, answering "is anything within `cell` of this probe". */
function coverGrid(points, cell) {
  const cells = new Map();
  const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (const p of points) {
    const k = key(p.x, p.y, p.z);
    const bucket = cells.get(k);
    if (bucket) bucket.push(p);
    else cells.set(k, [p]);
  }
  return (probe, within) => {
    const cx = Math.floor(probe.x / cell);
    const cy = Math.floor(probe.y / cell);
    const cz = Math.floor(probe.z / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          for (const p of cells.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            if (probe.distanceTo(p) <= within) return true;
          }
        }
    return false;
  };
}

console.log(
  `look ${look}  source ${SOURCE}  corners ${mode}  blockout ${process.env.BLOCKOUT ?? 0}  minRun ${minRun}  ` +
    `radius ${spec.radius}  rhoMin ${rhoMin.toFixed(4)} em`,
);
console.log(
  'letter   path  uncovered        nicks         holes   corners  cn  rt  bk   resume  break',
);
let totalPath = 0;
let totalUncovered = 0;
let totalHoles = 0;
let totalResume = 0;
let totalDrop = 0;
let totalWipe = 0;
for (const ch of letters) {
  const shapes = glyphToShapes(font, ch, 1);
  const paths = generatePaths(surfacesOf(shapes, 0.3), spec.surfaces, {
    level: spec.level,
    spacing: spec.spacing,
    wallDepth: 0.5,
    resolution: 256,
    pad: 0.35,
    source: SOURCE,
  });
  RESUME_DROP.back = 0;
  RESUME_DROP.fwd = 0;
  RESUME_DROP.drop = 0;
  RESUME_DROP.wipeBack = 0;
  RESUME_DROP.wipeFwd = 0;
  const cut = cutIntoRuns(paths, {
    runs: spec.runs,
    minRun,
    corners,
    radius: spec.radius,
    bend: spec.bend,
    spacing: spec.spacing,
    blockout: Number(process.env.BLOCKOUT ?? 0),
    seed: 0,
  });
  const drawn = cut.runs.flatMap((r) => r.points);
  const covers = coverGrid(drawn, spec.radius);

  let pathLen = 0;
  let uncovered = 0;
  let holes = 0;
  let nicks = 0;
  const misses = [];
  for (const path of paths) {
    const pts = path.points;
    const n = pts.length;
    if (n < 2) continue;
    const hit = pts.map((p) => covers(p, spec.radius));
    // Arc length carried by vertex i: half its incoming leg plus half its outgoing one.
    const share = pts.map((p, i) => {
      const prev = pts[(i - 1 + n) % n];
      const next = pts[(i + 1) % n];
      const back = path.closed || i > 0 ? p.distanceTo(prev) / 2 : 0;
      const fwd = path.closed || i < n - 1 ? p.distanceTo(next) / 2 : 0;
      return back + fwd;
    });
    pathLen += share.reduce((a, b) => a + b, 0);
    // Maximal uncovered stretches, wrapping through the seam on a closed contour.
    let i = 0;
    const start = path.closed && !hit[n - 1] ? 0 : 0;
    const seen = new Array(n).fill(false);
    for (i = start; i < n; i++) {
      if (hit[i] || seen[i]) continue;
      let len = 0;
      let j = i;
      while (!hit[j] && !seen[j]) {
        seen[j] = true;
        len += share[j];
        j = path.closed ? (j + 1) % n : j + 1;
        if (!path.closed && j >= n) break;
      }
      uncovered += len;
      if (len > NICK) holes += len;
      else nicks += len;
    }
    if (OUT) misses.push([pts, hit]);
  }
  const census = { connect: 0, return: 0, break: 0 };
  for (const c of cut.corners) census[c.strategy]++;
  if (OUT) panels.push({ ch, misses, runs: cut.runs, holes, pathLen });
  totalPath += pathLen;
  totalUncovered += uncovered;
  totalHoles += holes;
  console.log(
    `  ${ch}    ${pathLen.toFixed(3)}  ${uncovered.toFixed(3)} ${((uncovered / pathLen) * 100).toFixed(0).padStart(3)}%  ` +
      `${nicks.toFixed(3)} ${((nicks / pathLen) * 100).toFixed(0).padStart(3)}%  ` +
      `${holes.toFixed(3)} ${((holes / pathLen) * 100).toFixed(0).padStart(3)}%  ` +
      `${String(cut.corners.length).padStart(5)}  ${String(census.connect).padStart(2)}  ` +
      `${String(census.return).padStart(2)}  ${String(census.break).padStart(2)}   ` +
      `${(RESUME_DROP.back + RESUME_DROP.fwd).toFixed(3)}  ${RESUME_DROP.drop.toFixed(3)}`,
  );
  totalWipe += RESUME_DROP.wipeBack + RESUME_DROP.wipeFwd;
  totalResume += RESUME_DROP.back + RESUME_DROP.fwd;
  totalDrop += RESUME_DROP.drop;
}
if (OUT) {
  const S = CELL * 0.72;
  const svg = panels
    .map(({ ch, misses, runs, holes, pathLen }, k) => {
      const x0 = (k % 5) * CELL;
      const y0 = Math.floor(k / 5) * CELL;
      const map = (p) => `${(x0 + 30 + p.x * S).toFixed(1)},${(y0 + 30 - p.y * S).toFixed(1)}`;
      const contour = misses
        .map(([pts]) => `<polyline points="${pts.map(map).join(' ')}"/>`)
        .join('');
      const tube = runs
        .map((r) => `<polyline points="${r.points.map(map).join(' ')}"/>`)
        .join('');
      const gaps = misses
        .flatMap(([pts, hit]) => pts.filter((_, i) => !hit[i]).map((p) => `<circle cx="${map(p).split(',')[0]}" cy="${map(p).split(',')[1]}" r="2.4"/>`))
        .join('');
      return (
        `<g class="contour">${contour}</g><g class="tube">${tube}</g><g class="gap">${gaps}</g>` +
        `<text x="${x0 + 10}" y="${y0 + CELL - 10}">${ch} — ${((holes / pathLen) * 100).toFixed(0)}% holes</text>`
      );
    })
    .join('\n');
  const rows = Math.ceil(panels.length / 5);
  writeFileSync(
    OUT,
    `<!doctype html><meta charset="utf-8"><title>corner coverage — ${look}</title>` +
      `<style>body{background:#111;color:#ddd;font:13px system-ui;margin:0;padding:16px}` +
      `.contour polyline{fill:none;stroke:#555;stroke-width:1}` +
      `.tube polyline{fill:none;stroke:#3aa0ff;stroke-width:3.2;stroke-linecap:round}` +
      `.gap circle{fill:#ff2d4d}text{fill:#999;font:12px system-ui}</style>` +
      `<h1>${look} · ${SOURCE} · corners ${mode}</h1>` +
      `<svg width="${5 * CELL}" height="${rows * CELL}">${svg}</svg>`,
  );
  console.log(`wrote ${OUT}`);
}
console.log(
  `total ${totalPath.toFixed(3)} em: uncovered ${totalUncovered.toFixed(3)} ` +
    `(${((totalUncovered / totalPath) * 100).toFixed(1)}%), holes ${totalHoles.toFixed(3)} ` +
    `(${((totalHoles / totalPath) * 100).toFixed(1)}%)`,
);
console.log(
  `discarded by resumeAt ${totalResume.toFixed(3)} em, by break drops ${totalDrop.toFixed(3)} em; ${totalWipe} whole-leg wipes`,
);
