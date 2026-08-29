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
  biarcBlend,
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
const OUT = process.env.OUT ?? new URL('hairpin.html', import.meta.url).pathname;
const LEG_WINDOW = 4;
/** Turn past which a fillet cuts enough of the apex to be worth replacing, in degrees. */
const SHARP = Number(process.env.SHARP ?? 100);
/** How far past the apex a `uturn` puts its tip, in multiples of rho_min. */
const TIP = Number(process.env.TIP ?? 0.5);
const SHAPES = { bisector: hairpinAt, uturn: uturnAt };

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
  return { points, p, proud: proudOf(points, p) };
}

/** How far past the apex the drawn tube reaches — the whole question for this strategy. */
function proudOf(points, p) {
  let proud = 0;
  for (const q of points) proud = Math.max(proud, q.distanceTo(p));
  return proud;
}

/** Samples a circular arc of `radius` about `centre`, from `from`, sweeping `sweep` about `axis`. */
function arcPoints(centre, from, axis, sweep) {
  const radial = from.clone().sub(centre);
  const steps = Math.max(8, Math.ceil((sweep * radial.length()) / (spec.spacing / 2)));
  const out = [];
  for (let i = 0; i <= steps; i++) {
    out.push(centre.clone().add(radial.clone().applyAxisAngle(axis, (i / steps) * sweep)));
  }
  return out;
}

/**
 * The other hairpin: a U-turn of diameter 2 rho_min laid on the corner's own axis, its tip a fixed
 * `TIP` past the apex, blended back onto each leg. The footprint is the tip overshoot rather than
 * the corner angle, so unlike the bisector construction it does not run away as the corner sharpens
 * — it pays for that sideways, being 2 rho_min wide where the legs may be much closer together.
 */
function uturnAt(pts, corner) {
  const p = at(pts, corner.index);
  const u = legDirection(pts, corner.index - corner.groupBefore, -1);
  const v = legDirection(pts, corner.index + corner.groupAfter, 1);
  if (!u || !v) return null;
  const turn = u.angleTo(v);
  if (turn < 1e-6 || turn > Math.PI - 1e-6) return null;

  // Out of the apex: the internal bisector reversed, which is where a fillet would never go.
  const axis = new THREE.Vector3(0, 0, 1);
  const outward = v.clone().sub(u).normalize().negate();
  const across = outward.clone().cross(axis).normalize();
  const tip = p.clone().addScaledVector(outward, rhoMin * TIP);
  const centre = tip.clone().addScaledVector(outward, -rhoMin);
  // The U is entered from the side the tube arrives on, which is behind the apex along `u`.
  const sign = Math.sign(across.dot(u.clone().negate())) || 1;
  const entry = centre.clone().addScaledVector(across, rhoMin * sign);
  const exit = centre.clone().addScaledVector(across, -rhoMin * sign);
  // Both rotations land on `exit`; only one bulges through the tip, and that is the U.
  const turnaround = [1, -1]
    .map((way) => arcPoints(centre, entry, axis.clone().multiplyScalar(way), Math.PI))
    .sort(
      (a, b) =>
        a[a.length >> 1].distanceTo(tip) - b[b.length >> 1].distanceTo(tip),
    )[0];

  // Reach back along each leg for room to blend onto the U's ends, which run along `outward`.
  for (const factor of [1, 1.5, 2, 3, 4, 6]) {
    const s = rhoMin * factor;
    const a = p.clone().addScaledVector(u, -s);
    const b = p.clone().addScaledVector(v, s);
    const into = biarcBlend(a, u, entry, outward, rhoMin, spec.spacing);
    const outOf = biarcBlend(exit, outward.clone().negate(), b, v, rhoMin, spec.spacing);
    if (!into || !outOf) continue;
    const points = into.concat(turnaround.slice(1), outOf.slice(1));
    return { points, p, proud: proudOf(points, p) };
  }
  return null;
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
  const pins = Object.fromEntries(Object.keys(SHAPES).map((k) => [k, []]));
  const tally = Object.fromEntries(
    Object.keys(SHAPES).map((k) => [k, { hit: 0, miss: 0, proud: 0 }]),
  );
  for (const path of paths) {
    contours.push(path.points);
    for (const corner of cornersByBend(path.points, path.closed, rhoMin, rhoStyle)) {
      if (!corner.hard) continue;
      const deg = (corner.turn * 180) / Math.PI;
      if (deg < SHARP) continue;
      const drawn = {};
      for (const [shape, build] of Object.entries(SHAPES)) {
        const pin = build(path.points, corner);
        if (pin) {
          pins[shape].push(pin);
          tally[shape].hit++;
          tally[shape].proud = Math.max(tally[shape].proud, pin.proud);
          drawn[shape] = pin.proud;
        } else {
          tally[shape].miss++;
        }
      }
      if (process.env.VERBOSE) {
        const said = Object.keys(SHAPES)
          .map((k) =>
            drawn[k] === undefined
              ? `${k} refused`.padEnd(22)
              : `${k} ${(drawn[k] / rhoMin).toFixed(1)}r (${drawn[k].toFixed(3)} em)`.padEnd(22),
          )
          .join('  ');
        console.log(`    turn ${deg.toFixed(0).padStart(3)}deg  ${said}`);
      }
    }
  }
  panels.push({ ch, contours, pins, tally });
  const said = Object.entries(tally)
    .map(([k, t]) => `${k} ${t.hit}/${t.hit + t.miss}, worst ${t.proud.toFixed(3)} em`)
    .join('   ');
  console.log(`  ${ch}  ${said}`);
}

const svg = panels
  .map(({ ch, contours, pins, tally }, k) => {
    const x0 = (k % 3) * CELL;
    const y0 = Math.floor(k / 3) * CELL;
    const map = (p) => `${(x0 + 60 + p.x * S).toFixed(1)},${(y0 + CELL - 60 - p.y * S).toFixed(1)}`;
    const contour = contours.map((c) => `<polyline points="${c.map(map).join(' ')}"/>`).join('');
    const drawn = Object.keys(SHAPES)
      .map(
        (shape) =>
          `<g class="pin ${shape}">` +
          pins[shape].map((h) => `<polyline points="${h.points.map(map).join(' ')}"/>`).join('') +
          '</g>',
      )
      .join('');
    const said = Object.entries(tally)
      .map(([k, t]) => `${k} ${t.hit}/${t.hit + t.miss}, worst ${t.proud.toFixed(3)} em`)
      .join(' · ');
    return (
      `<g class="contour">${contour}</g>${drawn}` +
      `<text x="${x0 + 14}" y="${y0 + 22}">${ch} — ${said}</text>`
    );
  })
  .join('\n');
const rows = Math.ceil(panels.length / 3);
writeFileSync(
  OUT,
  `<!doctype html><meta charset="utf-8"><title>hairpin — ${look}</title>` +
    `<style>body{background:#111;color:#ddd;font:13px system-ui;margin:0;padding:16px}` +
    `.contour polyline{fill:none;stroke:#555;stroke-width:1.4}` +
    `.pin polyline{fill:none;stroke-width:3;stroke-linecap:round}` +
    `.bisector polyline{stroke:#3aa0ff}.uturn polyline{stroke:#ffa63a}` +
    `text{fill:#999;font:13px system-ui}` +
    `.bisector-key{color:#3aa0ff}.uturn-key{color:#ffa63a}</style>` +
    `<h1>${look} · ${SOURCE} · <span class="bisector-key">bisector</span> vs <span class="uturn-key">u-turn</span> hairpin</h1>` +
    `<svg width="${3 * CELL}" height="${rows * CELL}">${svg}</svg>`,
);
console.log(`wrote ${OUT}`);
