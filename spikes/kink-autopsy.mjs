/**
 * When an exact path source produces a kink, what is bending?
 *
 *   npm run build -w klieg && node spikes/kink-autopsy.mjs [look] [letters]
 *
 * Runs the real blueprint per source with wander off, finds every run under rho_min, and reports
 * the tightest triple: whether its three points were authored by the fillet stage (`AAA`, a fillet
 * bending wrong), mixed (`join`), or extracted (`plain`), plus the local sample step. Draws the
 * offending run so the failure can be looked at rather than inferred.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { minBendRadius } from '../packages/core/dist/render/tube/bend.js';
import { buildTubeBlueprint } from '../packages/core/dist/render/tube/index.js';
import { minCurvatureRadius3 } from '../packages/core/dist/render/tube/resample.js';
import { smoothedPoints, tightestBend } from '../packages/core/dist/render/tube/sweep.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const LOOK = process.argv[2] ?? 'tubing';
const LETTERS = process.argv[3] ?? 'ABPQRJ';
const base = { ...specOf(LOOK).decoration, amplitude: 0 };
const rhoMin = minBendRadius(base.radius, base.bend);
const TOL = rhoMin * 1e-6;
const r = base.radius;
const SOURCES = [['field', 'today'], ['exact', 'A exact'], ['direct', 'B direct']];

function tightestAt(points) {
  let best = Infinity, at = -1;
  for (let i = 1; i + 1 < points.length; i++) {
    const rho = minCurvatureRadius3(points.slice(i - 1, i + 2));
    if (rho < best) { best = rho; at = i; }
  }
  return { best, at };
}

const found = [];
console.log(`${LOOK}, wander off, rho_min ${rhoMin.toFixed(4)} = ${(rhoMin / r).toFixed(2)}r\n`);
for (const [source, label] of SOURCES) {
  for (const ch of LETTERS) {
    const bp = buildTubeBlueprint(glyphToShapes(font, ch, 1), { ...base, pathSource: source }, 0.3, 0);
    for (const run of bp.runs) {
      if (tightestBend(run) >= rhoMin - TOL) continue;
      const sm = smoothedPoints(run).map((p) => ({ x: p.x, y: p.y, z: p.z }));
      const t = tightestAt(sm);
      const i = t.at;
      const mark = [i - 1, i, i + 1]
        .map((k) => (run.points[k] && run.from[k] === null ? 'A' : '.')).join('');
      const kind = mark === 'AAA' ? 'in fillet' : mark === '...' ? 'plain    ' : 'join     ';
      const step = i > 0 && i + 1 < run.points.length
        ? (run.points[i].distanceTo(run.points[i - 1]) + run.points[i + 1].distanceTo(run.points[i])) / 2 : 0;
      console.log(`  ${label.padEnd(8)} ${ch} run ${String(run.index).padStart(2)} n=${String(run.points.length).padStart(3)}` +
        `  tightest ${(t.best / r).toFixed(2)}r at ${i}/${run.points.length}  ${kind} ${mark}  step ${step.toFixed(4)}`);
      found.push({ label, ch, run, pts: sm, at: i, rho: t.best });
    }
    bp.dispose();
  }
}

// Draw the worst offender per source.
const worstPer = new Map();
for (const f of found) {
  const cur = worstPer.get(f.label);
  if (!cur || f.rho < cur.rho) worstPer.set(f.label, f);
}
const cards = [...worstPer.values()];
if (cards.length) {
  const CW = 520, HEAD = 70;
  const parts = [];
  cards.forEach((c, col) => {
    const xs = c.pts.map((p) => p.x), ys = c.pts.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const S = Math.min((CW - 90) / Math.max(maxX - minX, 1e-6), 420 / Math.max(maxY - minY, 1e-6));
    const ox = col * CW + 45, oy = HEAD + 30;
    const X = (p) => ox + (p.x - minX) * S, Y = (p) => oy + (maxY - p.y) * S;
    const d = c.pts.map((p, i) => `${i ? 'L' : 'M'}${X(p).toFixed(1)} ${Y(p).toFixed(1)}`).join(' ');
    parts.push(`<text class="hd" x="${col * CW + 45}" y="40">${c.label} — ${c.ch} run ${c.run.index}</text>`);
    parts.push(`<text class="sub" x="${col * CW + 45}" y="62">tightest ${(c.rho / r).toFixed(2)}r (rho_min ${(rhoMin / r).toFixed(2)}r)</text>`);
    parts.push(`<path d="${d}" fill="none" stroke="#334155" stroke-width="${(r * 2 * S).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    parts.push(`<path d="${d}" fill="none" stroke="#7dd3fc" stroke-width="1.6"/>`);
    c.pts.forEach((p, i) => {
      const authored = c.run.points[i] && c.run.from[i] === null;
      parts.push(`<circle cx="${X(p).toFixed(1)}" cy="${Y(p).toFixed(1)}" r="${i === c.at ? 7 : 2.6}" fill="${i === c.at ? '#ef4444' : authored ? '#fbbf24' : '#7dd3fc'}"/>`);
    });
  });
  const W = CW * cards.length, H = 560;
  writeFileSync(new URL(`../test-results/kink-${LOOK}.svg`, import.meta.url),
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>.hd{font:19px ui-monospace,monospace;fill:#e2e8f0}.sub{font:14px ui-monospace,monospace;fill:#94a3b8}</style>
<rect x="0" y="0" width="${W}" height="${H}" fill="#0d0f13"/>
<text class="sub" x="45" y="${H - 18}">red = tightest vertex · amber = authored by the fillet stage · blue = extracted from the path</text>
${parts.join('\n')}</svg>`);
  console.log(`\nwrote test-results/kink-${LOOK}.svg`);
}
