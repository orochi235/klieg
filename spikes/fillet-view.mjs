/**
 * Draw what the corner stage did, corner by corner, as an SVG page.
 *
 *   npm run build -w klieg && node spikes/fillet-view.mjs [look] [letters] > out.html
 *
 * `PATH_SOURCE` overrides the look's own source, matching where-under-bend.mjs.
 *
 * Each panel zooms one detected corner. Grey is the path the field extracted; red dots are the
 * vertices bending tighter than rho_min — the stretch, which is routinely more than one. Blue is
 * what the run draws there, with the built arc in green. The circle is rho_min at true scale.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import {
  cornersByBend,
  isAuthored,
  minBendRadius,
  STYLE_FACTOR,
  vertexBends,
} from '../packages/core/dist/render/tube/bend.js';
import { generatePaths } from '../packages/core/dist/render/tube/generators.js';
import { cutIntoRuns } from '../packages/core/dist/render/tube/runs.js';
import { surfacesOf } from '../packages/core/dist/render/tube/surfaces.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const LOOK = process.argv[2] ?? 'tubing';
const spec = specOf(LOOK).decoration;
const SOURCE = process.env.PATH_SOURCE ?? spec.pathSource ?? 'direct';
const rhoMin = minBendRadius(spec.radius, spec.bend);
const LETTERS = process.argv[3] ?? 'MWSB';
const SPAN = 0.16; // em across a panel
const PX = 300;

const scale = (p, c) => [
  ((p.x - c.x) / SPAN + 0.5) * PX,
  (0.5 - (p.y - c.y) / SPAN) * PX,
];
const poly = (pts, c) => pts.map((p) => scale(p, c).map((n) => n.toFixed(1)).join(',')).join(' ');
const near = (p, c) => Math.abs(p.x - c.x) < SPAN && Math.abs(p.y - c.y) < SPAN;

const panels = [];
for (const ch of LETTERS) {
  const shapes = glyphToShapes(font, ch, 1);
  const paths = generatePaths(surfacesOf(shapes, 0.3), spec.surfaces, {
    level: spec.level,
    spacing: spec.spacing,
    wallDepth: 0.5,
    resolution: 256,
    pad: 0.35,
    source: SOURCE,
  });
  const { runs } = cutIntoRuns(paths, {
    runs: spec.runs,
    minRun: spec.minRun,
    corners: { break: 0, connect: 1, loop: 0 },
    radius: spec.radius,
    bend: spec.bend,
    spacing: spec.spacing,
    seed: 0,
  });

  for (const path of paths) {
    const corners = cornersByBend(path.points, path.closed, rhoMin, spec.radius * STYLE_FACTOR);
    const bends = new Map(vertexBends(path.points, path.closed).map((b) => [b.index, b.rho]));
    for (const corner of corners) {
      if (panels.length >= 24) break;
      const width = corner.groupBefore + corner.groupAfter + 1;
      const c = path.points[corner.index];
      const raw = path.points.filter((p) => near(p, c));
      if (raw.length < 3) continue;

      const dots = raw
        .map((p) => {
          const i = path.points.indexOf(p);
          const rho = bends.get(i) ?? Number.POSITIVE_INFINITY;
          const [x, y] = scale(p, c);
          const cls = rho < rhoMin ? 'tight' : 'loose';
          return `<circle class="${cls}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.4"/>`;
        })
        .join('');

      const drawn = runs
        .map((r) => r.points.filter((p) => near(p, c)))
        .filter((pts) => pts.length > 1)
        .map((pts) => `<polyline class="drawn" points="${poly(pts, c)}"/>`)
        .join('');
      const built = runs
        .flatMap((r) => r.points)
        .filter((p) => near(p, c) && isAuthored(p))
        .map((p) => {
          const [x, y] = scale(p, c);
          return `<circle class="built" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2"/>`;
        })
        .join('');

      const ringR = (rhoMin / SPAN) * PX;
      panels.push(`<figure>
  <svg viewBox="0 0 ${PX} ${PX}" role="img" aria-label="${ch} corner">
    <circle class="ring" cx="${PX / 2}" cy="${PX / 2}" r="${ringR.toFixed(1)}"/>
    <polyline class="raw" points="${poly(raw, c)}"/>
    ${drawn}${dots}${built}
  </svg>
  <figcaption><b>${ch}</b> &middot; stretch ${width} ${width === 1 ? 'vertex' : 'vertices'}
    &middot; turn ${((corner.turn * 180) / Math.PI).toFixed(0)}&deg;
    &middot; ${(corner.rho / spec.radius).toFixed(2)}r</figcaption>
</figure>`);
    }
  }
}

console.log(`<title>Group filleting</title>
<style>
  :root { --bg:#fbfbfa; --fg:#1a1a19; --muted:#6b6b68; --line:#d8d8d4; --panel:#fff;
          --raw:#b0b0ab; --tight:#d1453b; --drawn:#2f6fd0; --built:#1f9d6a; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --bg:#16171a; --fg:#e8e8e6; --muted:#9a9a96; --line:#2e3035; --panel:#1d1f23;
    --raw:#5a5c62; --tight:#ff6b60; --drawn:#6ea8ff; --built:#4bd4a0; } }
  :root[data-theme="dark"] { --bg:#16171a; --fg:#e8e8e6; --muted:#9a9a96; --line:#2e3035;
    --panel:#1d1f23; --raw:#5a5c62; --tight:#ff6b60; --drawn:#6ea8ff; --built:#4bd4a0; }
  body { background:var(--bg); color:var(--fg); margin:0; padding:2rem;
         font:15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  h1 { font-size:1.4rem; margin:0 0 .3rem; }
  p.lede { color:var(--muted); max-width:56ch; margin:0 0 1.6rem; }
  .grid { display:grid; gap:1rem; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); }
  figure { margin:0; background:var(--panel); border:1px solid var(--line); border-radius:10px;
           padding:.6rem; }
  svg { width:100%; height:auto; display:block; }
  figcaption { color:var(--muted); font-size:.8rem; margin-top:.4rem; }
  b { color:var(--fg); }
  .raw { fill:none; stroke:var(--raw); stroke-width:1.2; }
  .drawn { fill:none; stroke:var(--drawn); stroke-width:2.4; }
  .ring { fill:none; stroke:var(--line); stroke-width:1; stroke-dasharray:3 4; }
  .loose { fill:var(--raw); }
  .tight { fill:var(--tight); }
  .built { fill:var(--built); }
  .key { color:var(--muted); font-size:.85rem; margin:0 0 1.2rem; }
  .key span { margin-right:1.2rem; }
  .sw { display:inline-block; width:.7rem; height:.7rem; border-radius:50%; margin-right:.35rem;
        vertical-align:-1px; }
  .sw-raw { background:var(--raw); }
  .sw-tight { background:var(--tight); }
  .sw-drawn { background:var(--drawn); }
  .sw-built { background:var(--built); }
</style>
<h1>Group filleting, corner by corner</h1>
<p class="lede">Each panel zooms one detected corner of the ${LOOK} look at its shipped spec, traced
${SOURCE}. The dashed circle is the minimum bend radius at true scale &mdash; the tightest turn the
glass takes.</p>
<p class="key">
  <span><i class="sw sw-raw"></i>extracted path</span>
  <span><i class="sw sw-tight"></i>bends tighter than rho_min</span>
  <span><i class="sw sw-drawn"></i>what the run draws</span>
  <span><i class="sw sw-built"></i>built arc</span>
</p>
<div class="grid">
${panels.join('\n')}
</div>`);
