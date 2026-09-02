/**
 * Which corners does the bevel push past the letter?
 *
 *   node spikes/bevel-spur.mjs [chars] [--face cinzel] [--svg out.svg]
 *
 * three offsets each bevel ring by mitering the corner, and a miter grows as 1/sin(interior/2).
 * `getBevelVec` caps it at sqrt(2) units ("prevent crazy spikes"), so every corner under 90 degrees
 * lands at 1.41x the bevel along its bisector however acute it is — a nub standing off the outline,
 * with the two bevel walls converging into it. Reports each capped corner with the angle that
 * caused it, and with `--svg` draws the contour against the outer ring.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import opentype from 'opentype.js';
import {
  buildGlyphGeometry,
  glyphToShapes,
  DEFAULT_GLYPH_OPTIONS,
} from '../packages/core/dist/text/glyphs.js';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const CHARS = (process.argv[2] ?? '').startsWith('--') ? 'AN' : (process.argv[2] ?? 'AN');
const FACE = arg('face', 'cinzel');
const SVG = arg('svg', null);
const O = DEFAULT_GLYPH_OPTIONS;
const CAP = Math.SQRT2 * O.bevelSize;

const buf = readFileSync(new URL(`../apps/lab/public/fonts/${FACE}.ttf`, import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const interiorAngle = (p, c, n) => {
  const a = Math.atan2(p.y - c.y, p.x - c.x);
  const z = Math.atan2(n.y - c.y, n.x - c.x);
  let d = ((z - a) * 180) / Math.PI;
  while (d < 0) d += 360;
  return Math.min(d, 360 - d);
};

/** three's getBevelVec, cap included, so the ring can be predicted and then checked against it. */
function bevelVec(c, p, n) {
  const px = c.x - p.x, py = c.y - p.y, nx = n.x - c.x, ny = n.y - c.y;
  const cross = px * ny - py * nx;
  if (Math.abs(cross) <= Number.EPSILON) return null; // collinear branch, including duplicate points
  const pl = Math.hypot(px, py), nl = Math.hypot(nx, ny);
  const psx = p.x - py / pl, psy = p.y + px / pl;
  const nsx = n.x - ny / nl, nsy = n.y + nx / nl;
  const sf = ((nsx - psx) * ny - (nsy - psy) * nx) / cross;
  let tx = psx + px * sf - c.x, ty = psy + py * sf - c.y;
  const lensq = tx * tx + ty * ty;
  if (lensq <= 2) return { x: tx, y: ty, want: Math.sqrt(lensq), capped: false };
  const shrink = Math.sqrt(lensq / 2);
  return { x: tx / shrink, y: ty / shrink, want: Math.sqrt(lensq), capped: true };
}

const panels = [];
for (const ch of CHARS) {
  const shapes = glyphToShapes(font, ch, 1);
  if (!shapes.length) continue;
  const rings = shapes.flatMap((s) => {
    const p = s.extractPoints(O.curveSegments);
    return [p.shape, ...p.holes];
  });

  const geo = buildGlyphGeometry(font, ch, 1, O);
  geo.computeBoundingBox();
  const pos = geo.getAttribute('position');
  const verts = [];
  for (let i = 0; i < pos.count; i++) verts.push([pos.getX(i), pos.getY(i)]);
  let top = -Infinity;
  for (const r of rings) for (const q of r) top = Math.max(top, q.y);

  const outer = [];
  const capped = [];
  let unmatched = 0;
  for (const r of rings) {
    const ring = [];
    for (let i = 0; i < r.length; i++) {
      const c = r[i], p = r[(i - 1 + r.length) % r.length], n = r[(i + 1) % r.length];
      const v = bevelVec(c, p, n);
      if (!v) { ring.push({ x: c.x, y: c.y, capped: false }); continue; }
      const x = c.x + v.x * O.bevelSize, y = c.y + v.y * O.bevelSize;
      ring.push({ x, y, capped: v.capped });
      if (!verts.some((q) => Math.hypot(q[0] - x, q[1] - y) < 1e-6)) unmatched++;
      const angle = interiorAngle(p, c, n);
      if (v.capped && angle < 89) capped.push({ at: c, angle, want: v.want * O.bevelSize });
    }
    outer.push(ring);
  }
  geo.dispose();

  capped.sort((a, b) => a.angle - b.angle);
  console.log(
    `${FACE} ${ch}: mesh stands +${(geo.boundingBox.max.y - top).toFixed(4)} em above the outline ` +
      `(bevelSize ${O.bevelSize}, cap ${CAP.toFixed(4)}), ${unmatched} predicted ring points missing`,
  );
  for (const c of capped)
    console.log(
      `  (${c.at.x.toFixed(3)}, ${c.at.y.toFixed(3)})  ${c.angle.toFixed(1)}deg  ` +
        `wanted ${c.want.toFixed(4)} em (${(c.want / O.bevelSize).toFixed(1)}x), got ${CAP.toFixed(4)}`,
    );
  panels.push({ rings, outer });
}

if (SVG) {
  let x0 = 0, parts = '';
  for (const p of panels) {
    const draw = (rs, stroke) =>
      rs
        .map(
          (r) =>
            `<path d="M${r.map((q) => `${(q.x + x0).toFixed(4)},${(-q.y).toFixed(4)}`).join('L')}Z" fill="none" stroke="${stroke}" stroke-width="0.004"/>`,
        )
        .join('');
    parts += draw(p.outer, '#e0483c') + draw(p.rings, '#4a9de0');
    for (const r of p.outer)
      for (const q of r)
        if (q.capped)
          parts += `<circle cx="${(q.x + x0).toFixed(4)}" cy="${(-q.y).toFixed(4)}" r="0.008" fill="#ffd24a"/>`;
    x0 += 1.1;
  }
  const w = x0 + 0.1;
  writeFileSync(
    SVG,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * 1200)}" height="${Math.round(1.15 * 1200)}" viewBox="-0.1 -1.05 ${w} 1.15"><rect x="-0.1" y="-1.05" width="${w}" height="1.15" fill="#12151c"/>${parts}</svg>`,
  );
  console.log(`\nwrote ${SVG} — blue the contour, red the outer bevel ring, yellow a capped corner`);
}
