/**
 * What a hairpin at a sharp corner would draw, against the fillet that ships there.
 *
 *   npm run build -w klieg && OUT=page.html node spikes/hairpin-view.mjs [look] [letters]
 *
 * A fillet is an arc tangent to both legs, so it cuts the apex off. A hairpin runs past the point
 * and turns around outside it, the way a bender does, so the apex is covered twice — and the tube
 * stands proud of the letter by `rho_min / cos(turn/2) + rho_min`, which is reported per corner.
 * `SHARP` is the turn in degrees past which a corner is offered one.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import {
  cornersByBend,
  minBendRadius,
  STYLE_FACTOR,
} from '../packages/core/dist/render/tube/bend.js';
import { generatePaths } from '../packages/core/dist/render/tube/generators.js';
import { surfacesOf } from '../packages/core/dist/render/tube/surfaces.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';
import * as THREE from 'three';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const SOURCE = process.env.PATH_SOURCE ?? 'field';
const look = process.argv[2] ?? 'tubing';
const letters = process.argv[3] ?? 'WAV';
const spec = { ...specOf(look).decoration, pathSource: SOURCE };
const rhoMin = minBendRadius(spec.radius, spec.bend);
const rhoStyle = spec.radius * STYLE_FACTOR;
const OUT = process.env.OUT ?? 'hairpin.html';
const LEG_WINDOW = 4;
/** Turn past which a fillet cuts enough of the apex to be worth replacing, in degrees. */
const SHARP = Number(process.env.SHARP ?? 100);

const at = (pts, i) => pts[((i % pts.length) + pts.length) % pts.length];

/** A leg's direction, averaged over four segments, as `runs.ts` measures it. */
function legDirection(pts, i, step) {
  const dir = new THREE.Vector3();
  for (let k = 0; k < LEG_WINDOW; k++) {
    const j = step === 1 ? i + k : i - k - 1;
    const a = at(pts, j);
    const b = at(pts, j + 1);
    const d = b.clone().sub(a);
    if (d.lengthSq() < 1e-18) break;
    dir.add(d.normalize());
  }
  return dir.lengthSq() < 1e-18 ? null : dir.normalize();
}

/**
 * The hairpin: the circle of radius rho_min inscribed in the wedge *opposite* the corner, taken the
 * long way round. Its tangent points are the fillet's own setback mirrored through the apex — the
 * tube runs past the point, turns around outside it, and comes back, so the apex is covered twice.
 *
 * `biarcBlend` cannot build this. A blend between two directed points takes the short way between
 * them, which is the fillet's side of the apex, and at a sharp corner that is tighter than the floor
 * — it refuses precisely the corners a hairpin is for.
 */
function hairpinAt(pts, corner) {
  const p = at(pts, corner.index);
  const u = legDirection(pts, corner.index - corner.groupBefore, -1);
  const v = legDirection(pts, corner.index + corner.groupAfter, 1);
  if (!u || !v) return null;
  const turn = u.angleTo(v);
  if (turn < 1e-6 || turn > Math.PI - 1e-6) return null;

  const setback = rhoMin * Math.tan(turn / 2);
  const a = p.clone().addScaledVector(u, setback);
  const b = p.clone().addScaledVector(v, -setback);
  // The internal bisector carries the fillet's centre; the hairpin's is the same distance the other
  // way, which is what puts the arc outside the apex rather than across it.
  const bisector = v.clone().sub(u).normalize();
  const centre = p.clone().addScaledVector(bisector, -rhoMin / Math.cos(turn / 2));

  const radial = a.clone().sub(centre);
  const axis = radial.clone().cross(u).normalize();
  if (!Number.isFinite(axis.x)) return null;
  // The major arc: the minor one is the fillet's own sweep reflected, and cuts the apex off again.
  const sweep = 2 * Math.PI - radial.angleTo(b.clone().sub(centre));
  const steps = Math.max(8, Math.ceil((sweep * rhoMin) / (spec.spacing / 2)));
  const points = [];
  for (let i = 0; i <= steps; i++) {
    points.push(centre.clone().add(radial.clone().applyAxisAngle(axis, (i / steps) * sweep)));
  }
  // How far the tube stands proud of the letter, measured over the arc rather than taken from the
  // centre: the leg directions are averaged over four segments, so the turn the arc is built from is
  // not the corner's own and the closed form disagrees with what is drawn.
  let proud = 0;
  for (const q of points) proud = Math.max(proud, q.distanceTo(p));
  return { points, s: setback, p, u, v, proud };
}

const CELL = 460;
const S = CELL * 0.62;
const panels = [];
for (const ch of letters) {
  const paths = generatePaths(surfacesOf(glyphToShapes(font, ch, 1), 0.3), spec.surfaces, {
    level: spec.level,
    spacing: spec.spacing,
    wallDepth: 0.5,
    resolution: 256,
    pad: 0.35,
    source: SOURCE,
  });
  const contours = [];
  const pins = [];
  let hit = 0;
  let miss = 0;
  for (const path of paths) {
    contours.push(path.points);
    for (const corner of cornersByBend(path.points, path.closed, rhoMin, rhoStyle)) {
      if (!corner.hard) continue;
      const deg = (corner.turn * 180) / Math.PI;
      const pin = deg >= SHARP ? hairpinAt(path.points, corner) : null;
      if (pin) {
        pins.push(pin);
        hit++;
      } else {
        miss++;
      }
      if (process.env.VERBOSE) {
        console.log(
          `    turn ${deg.toFixed(0).padStart(3)}deg  interior ${(180 - deg).toFixed(0).padStart(3)}` +
            `  ${deg < SHARP ? 'not sharp' : pin ? `hairpin stands ${(pin.proud / rhoMin).toFixed(1)} rhoMin proud (${pin.proud.toFixed(3)} em)` : 'REFUSED'}`,
        );
      }
    }
  }
  panels.push({ ch, contours, pins, hit, miss });
  console.log(`  ${ch}  ${hit} hairpins drawn, ${miss} refused`);
}

const svg = panels
  .map(({ ch, contours, pins, hit, miss }, k) => {
    const x0 = (k % 3) * CELL;
    const y0 = Math.floor(k / 3) * CELL;
    const map = (p) => `${(x0 + 60 + p.x * S).toFixed(1)},${(y0 + CELL - 60 - p.y * S).toFixed(1)}`;
    const contour = contours.map((c) => `<polyline points="${c.map(map).join(' ')}"/>`).join('');
    const pinPaths = pins.map((h) => `<polyline points="${h.points.map(map).join(' ')}"/>`).join('');
    const apexes = pins
      .map((h) => {
        const [cx, cy] = map(h.p).split(',');
        return `<circle cx="${cx}" cy="${cy}" r="${(rhoMin * S).toFixed(1)}"/>`;
      })
      .join('');
    return (
      `<g class="floor">${apexes}</g><g class="contour">${contour}</g>` +
      `<g class="pin">${pinPaths}</g>` +
      `<text x="${x0 + 14}" y="${y0 + 22}">${ch} — ${hit} hairpins, ${miss} refused</text>`
    );
  })
  .join('\n');
const rows = Math.ceil(panels.length / 3);
writeFileSync(
  OUT,
  `<!doctype html><meta charset="utf-8"><title>hairpin — ${look}</title>` +
    `<style>body{background:#111;color:#ddd;font:13px system-ui;margin:0;padding:16px}` +
    `.contour polyline{fill:none;stroke:#555;stroke-width:1.4}` +
    `.pin polyline{fill:none;stroke:#3aa0ff;stroke-width:3;stroke-linecap:round}` +
    `.floor circle{fill:none;stroke:#2a2a2a;stroke-width:1}` +
    `text{fill:#999;font:13px system-ui}</style>` +
    `<h1>${look} · ${SOURCE} · hairpin over the shipped fillet</h1>` +
    `<svg width="${3 * CELL}" height="${rows * CELL}">${svg}</svg>`,
);
console.log(`wrote ${OUT}`);
