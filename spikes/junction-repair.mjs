/**
 * The three ways to answer an untangential splice, drawn side by side.
 *
 *   npm run build -w klieg && node spikes/junction-repair.mjs > out.html
 *
 * A fillet is tangent to leg lines fit outside the stretch detection collapsed the corner to. Where
 * the corner keeps turning past that stretch, the fit reads a turning shoulder as straight and the
 * arc splices in at an angle. Each row is one failing corner: as it is built today, refit against a
 * group widened to the shoulder, and cut instead. The leg fit here mirrors runs.ts rather than
 * calling it — those functions are module-private, so this is a prototype, not the shipped path.
 */
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import * as THREE from 'three';
import { specOf } from '../packages/core/dist/render/looks.js';
import {
  cornersByBend,
  filletAt,
  minBendRadius,
  STYLE_FACTOR,
  vertexBends,
} from '../packages/core/dist/render/tube/bend.js';
import { generatePaths } from '../packages/core/dist/render/tube/generators.js';
import { buildTubeBlueprint } from '../packages/core/dist/render/tube/index.js';
import { tightestBend } from '../packages/core/dist/render/tube/sweep.js';
import { surfacesOf } from '../packages/core/dist/render/tube/surfaces.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';

const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const CASES = [
  ['piping', 'direct', 'B'],
  ['piping', 'exact', 'B'],
  ['piping', 'field', 'S'],
];
const LEG_WINDOW = 4;
const SPAN = 0.15;
const PX = 300;
const deg = (rad) => (rad * 180) / Math.PI;

const at = (pts, i) => pts[((i % pts.length) + pts.length) % pts.length];

/** runs.ts legDirection: several segments averaged, because a corner turns past its own stretch. */
function legDirection(pts, anchor, step) {
  const dir = new THREE.Vector3();
  for (let k = 0; k < LEG_WINDOW; k++) {
    const i = step === 1 ? anchor + k : anchor - k - 1;
    const d = at(pts, i + 1).clone().sub(at(pts, i));
    if (d.lengthSq() < 1e-18) break;
    dir.add(d.normalize());
  }
  return dir.lengthSq() < 1e-18 ? null : dir.normalize();
}

/** runs.ts legIntersection: the corner the path had before resampling rounded it. */
function legIntersection(a, u, b, v) {
  const uv = u.dot(v);
  const denom = 1 - uv * uv;
  if (Math.abs(denom) < 1e-9) return null;
  const w = a.clone().sub(b);
  const s = (uv * w.dot(v) - w.dot(u)) / denom;
  const t = w.dot(v) - uv * w.dot(u);
  return a.clone().addScaledVector(u, s).add(b.clone().addScaledVector(v, t / denom)).multiplyScalar(0.5);
}

/**
 * Fit a fillet for the corner whose stretch runs [lo, hi], and report where the legs would resume
 * and how far off tangent they arrive. The junction's honest radius uses the shorter of its two
 * steps: circumradius through a long chord is chord / (2 sin turn), which any step back inflates.
 */
function fit(points, lo, hi, rhoMin, spacing) {
  return fitAt(points, lo - 1, hi + 1, rhoMin, spacing);
}

/** The same fit, with the leg anchors given outright rather than derived from a stretch. */
function fitAt(points, anchorLo, anchorHi, rhoMin, spacing) {
  const lo = anchorLo + 1;
  const hi = anchorHi - 1;
  const a = at(points, anchorLo);
  const b = at(points, anchorHi);
  const u = legDirection(points, anchorLo, -1);
  const v = legDirection(points, anchorHi, 1);
  if (!u || !v) return null;
  const virtual = legIntersection(a, u, b, v);
  if (!virtual) return null;
  const probe = [
    virtual.clone().addScaledVector(u, -1),
    virtual.clone(),
    virtual.clone().addScaledVector(v, 1),
  ];
  const fillet = filletAt(probe, false, 1, rhoMin, spacing);
  if (!fillet) return null;

  const entry = fillet.points[0];
  const exit = fillet.points[fillet.points.length - 1];
  // The leg resumes at the last vertex still outside the tangent point, walking away from the arc.
  let i = lo - 1;
  while (i > lo - 12 && at(points, i).distanceTo(virtual) < entry.distanceTo(virtual)) i--;
  const resume = at(points, i);
  const chord = resume.distanceTo(entry);
  const incoming = resume.clone().sub(at(points, i - 1)).normalize();
  const turn = incoming.angleTo(entry.clone().sub(resume).normalize());
  const shortStep = Math.min(chord, at(points, i).distanceTo(at(points, i - 1)));
  const honest = turn < 1e-9 ? Infinity : shortStep / (2 * Math.sin(turn / 2));
  let j = hi + 1;
  while (j < hi + 13 && at(points, j).distanceTo(virtual) < exit.distanceTo(virtual)) j++;
  return {
    fillet, entry, exit, resume, chord, turn, honest, virtual, spacing,
    resumeIndex: i, resumeIndexOut: j,
  };
}

/**
 * The G1 biarc joining two directed points: two arcs meeting with a common tangent. Equal tangent
 * lengths pick one member of the one-parameter family, which is the standard choice. Unlike a
 * single fixed-radius arc tangent to two fitted lines, this exists for any pair of directed points,
 * so tangency is a property of the construction rather than something to test for afterwards.
 */
function biarc(p0, t0, p1, t1) {
  const d = p1.clone().sub(p0);
  const sum = t0.clone().add(t1);
  const a2 = 2 * t0.dot(t1) - 2;
  const b1 = -2 * d.dot(sum);
  const c0 = d.lengthSq();
  let alpha;
  if (Math.abs(a2) < 1e-12) {
    if (Math.abs(b1) < 1e-12) return null;
    alpha = -c0 / b1;
  } else {
    const disc = b1 * b1 - 4 * a2 * c0;
    if (disc < 0) return null;
    const root = Math.sqrt(disc);
    alpha = Math.max((-b1 + root) / (2 * a2), (-b1 - root) / (2 * a2));
  }
  if (!(alpha > 0)) return null;
  const pa = p0.clone().addScaledVector(t0, alpha);
  const pb = p1.clone().addScaledVector(t1, -alpha);
  const joint = pa.clone().add(pb).multiplyScalar(0.5);

  /** Radius of the arc from `p` with tangent `t` through `q`: chord over twice the sine of the deviation. */
  const radiusOf = (p, t, q) => {
    const chord = q.clone().sub(p);
    const len = chord.length();
    if (len < 1e-12) return Number.POSITIVE_INFINITY;
    const phi = t.angleTo(chord);
    return phi < 1e-9 ? Number.POSITIVE_INFINITY : len / (2 * Math.sin(phi));
  };
  return {
    joint,
    r1: radiusOf(p0, t0, joint),
    r2: radiusOf(p1, t1.clone().negate(), joint),
    span: p0.distanceTo(joint) + joint.distanceTo(p1),
  };
}

/** Sample one arc of the blend: from `p` along `t`, ending at `q`. */
function arcPoints(p, t, q, steps) {
  const chord = q.clone().sub(p);
  const perp = chord.clone().addScaledVector(t, -chord.dot(t));
  if (perp.lengthSq() < 1e-18) return [p.clone(), q.clone()];
  const n = perp.normalize();
  const phi = t.angleTo(chord);
  const radius = chord.length() / (2 * Math.sin(phi));
  const centre = p.clone().addScaledVector(n, radius);
  const from = p.clone().sub(centre);
  const to = q.clone().sub(centre);
  const axis = from.clone().cross(to);
  if (axis.lengthSq() < 1e-18) return [p.clone(), q.clone()];
  axis.normalize();
  const sweep = from.angleTo(to);
  const out = [];
  for (let k = 0; k <= steps; k++) {
    out.push(centre.clone().add(from.clone().applyAxisAngle(axis, (k / steps) * sweep)));
  }
  return out;
}

/** How far a drawn replacement strays from the path it replaces, in em. */
function deviation(points, i, j, drawn) {
  let worst = 0;
  for (const q of drawn) {
    let best = Number.POSITIVE_INFINITY;
    for (let k = i; k < j; k++) {
      const a = at(points, k);
      const b = at(points, k + 1);
      const ab = b.clone().sub(a);
      const t = Math.max(0, Math.min(1, q.clone().sub(a).dot(ab) / ab.lengthSq()));
      best = Math.min(best, q.distanceTo(a.clone().addScaledVector(ab, t)));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

/**
 * Fit a biarc across the corner, stepping both resume vertices outward until both radii clear
 * rho_min. More room only ever relaxes the blend, so this search is monotone — which is exactly
 * what the current step-back is not.
 */
function biarcFit(points, lo, hi, rhoMin) {
  for (let out = 0; out < 10; out++) {
    const i = lo - 1 - out;
    const j = hi + 1 + out;
    const p0 = at(points, i);
    const p1 = at(points, j);
    const t0 = p0.clone().sub(at(points, i - 1)).normalize();
    const t1 = at(points, j + 1).clone().sub(p1).normalize();
    const b = biarc(p0, t0, p1, t1);
    if (!b) continue;
    if (Math.min(b.r1, b.r2) >= rhoMin) {
      return { ...b, p0, p1, t0, t1, out, eaten: j - i, i, j };
    }
  }
  return null;
}

/** The whole tradeoff curve for one corner: what each step outward buys and what it costs. */
function biarcCurve(points, closed, lo, hi, rhoMin, r, corners, index) {
  const table = [];
  for (let out = 0; out < 10; out++) {
    const i = lo - 1 - out;
    const j = hi + 1 + out;
    const p0 = at(points, i);
    const p1 = at(points, j);
    const t0 = p0.clone().sub(at(points, i - 1)).normalize();
    const t1 = at(points, j + 1).clone().sub(p1).normalize();
    const b = biarc(p0, t0, p1, t1);
    if (!b) {
      table.push({ out, minR: null });
      continue;
    }
    const drawn = arcPoints(p0, t0, b.joint, 24).concat(arcPoints(p1, t1.clone().negate(), b.joint, 24));
    table.push({
      out,
      minR: Math.min(b.r1, b.r2) / r,
      strays: deviation(points, i, j, drawn) / r,
      swallows: corners.filter((k) => k.index !== index && k.index > i && k.index < j).length,
      eaten: j - i,
    });
  }
  return table;
}

const rows = [];
for (const [look, source, ch] of CASES) {
  const spec = specOf(look).decoration;
  const rhoMin = minBendRadius(spec.radius, spec.bend);
  const r = spec.radius;
  const paths = generatePaths(surfacesOf(glyphToShapes(font, ch, 1), 0.3), spec.surfaces, {
    level: spec.level,
    spacing: spec.spacing,
    wallDepth: 0.5,
    resolution: 256,
    pad: 0.35,
    source,
  });

  // The worst corner is the one whose splice arrives furthest off tangent.
  let worst = null;
  for (const path of paths) {
    if (path.surface !== 'front') continue;
    const bends = new Map(vertexBends(path.points, path.closed).map((v) => [v.index, v]));
    for (const corner of cornersByBend(path.points, path.closed, rhoMin, r * STYLE_FACTOR)) {
      if (!corner.hard) continue;
      const lo = corner.index - corner.groupBefore;
      const hi = corner.index + corner.groupAfter;
      const shown = fit(path.points, lo, hi, rhoMin, spec.spacing);
      if (!shown) continue;
      if (!worst || shown.turn > worst.shown.turn) worst = { path, corner, lo, hi, shown, bends };
    }
  }
  if (!worst) continue;

  // Widen the stretch outward while the next vertex is still turning through the same corner.
  let { lo, hi } = worst;
  const { path, bends } = worst;
  while (deg(bends.get(((lo - 1) % path.points.length + path.points.length) % path.points.length)?.turn ?? 0) >= 5) lo--;
  while (deg(bends.get((hi + 1) % path.points.length)?.turn ?? 0) >= 5) hi++;
  const widened = fit(path.points, lo, hi, rhoMin, spec.spacing);

  // Refit against the vertex the leg actually resumes at, rather than one outside the stretch.
  // The anchor and the arc each depend on the other, so this is a fixed point, not a formula.
  let iterated = worst.shown;
  let anchorLo = worst.lo - 1;
  let anchorHi = worst.hi + 1;
  for (let pass = 0; pass < 4 && iterated; pass++) {
    const next = fitAt(path.points, anchorLo, anchorHi, rhoMin, spec.spacing);
    if (!next) break;
    iterated = next;
    if (next.turn < 1e-3) break;
    anchorLo = next.resumeIndex;
    anchorHi = next.resumeIndexOut;
  }

  const curve = biarcCurve(
    path.points, path.closed, worst.lo, worst.hi, rhoMin, r,
    cornersByBend(path.points, path.closed, rhoMin, r * STYLE_FACTOR), worst.corner.index,
  );
  console.error(`\n${look}/${source} ${ch}  (stretch ${worst.hi - worst.lo + 1})`);
  console.error('  out  minRadius  strays  swallows  vertices');
  for (const t of curve) {
    console.error(
      t.minR === null
        ? `  ${String(t.out).padStart(3)}   no blend`
        : `  ${String(t.out).padStart(3)}  ${t.minR.toFixed(2).padStart(8)}r ${t.strays.toFixed(2).padStart(6)}r` +
          `  ${String(t.swallows).padStart(8)}  ${String(t.eaten).padStart(8)}`,
    );
  }
  const blend = biarcFit(path.points, worst.lo, worst.hi, rhoMin);
  if (blend) {
    blend.strays = deviation(
      path.points,
      blend.i,
      blend.j,
      arcPoints(blend.p0, blend.t0, blend.joint, 24).concat(
        arcPoints(blend.p1, blend.t1.clone().negate(), blend.joint, 24),
      ),
    );
    // Does the search reach past a neighbouring corner and blend across it?
    blend.swallowed = cornersByBend(path.points, path.closed, rhoMin, r * STYLE_FACTOR).filter(
      (k) => k.index !== worst.corner.index && k.index > blend.i && k.index < blend.j,
    ).length;
  }
  // What the letter actually ships at, so a panel cannot read worse or better than the tube does.
  const bp = buildTubeBlueprint(glyphToShapes(font, ch, 1), { ...spec, amplitude: 0, pathSource: source }, 0.3, 0);
  const shipped = Math.min(...bp.runs.map((run) => tightestBend(run))) / r;
  bp.dispose();

  rows.push({
    look, source, ch, r, rhoMin, path, worst, lo, hi, widened, iterated, blend, shipped,
    spacing: spec.spacing,
  });
}

const scale = (p, c, span) => [((p.x - c.x) / span + 0.5) * PX, (0.5 - (p.y - c.y) / span) * PX];
const poly = (pts, c, span) =>
  pts.map((p) => scale(p, c, span).map((n) => n.toFixed(1)).join(',')).join(' ');
const near = (p, c, span) => Math.abs(p.x - c.x) < span && Math.abs(p.y - c.y) < span;
const dot = (p, c, span, cls, rad = 2.6) => {
  const [x, y] = scale(p, c, span);
  return `<circle class="${cls}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad}"/>`;
};

function panel(title, caption, body) {
  return `<figure><svg viewBox="0 0 ${PX} ${PX}" role="img" aria-label="${title}">${body}</svg>
  <figcaption><b>${title}</b><br>${caption}</figcaption></figure>`;
}

const html = [];
for (const row of rows) {
  const { path, worst, widened, iterated, blend, r, rhoMin, spacing } = row;
  const c = path.points[worst.corner.index];

  const blendArcs = blend
    ? arcPoints(blend.p0, blend.t0, blend.joint, 24).concat(
        arcPoints(blend.p1, blend.t1.clone().negate(), blend.joint, 24),
      )
    : [];
  // One span for the whole row, sized to whatever the widest option draws, so the panels compare.
  const reach = [worst.shown, widened, iterated]
    .filter(Boolean)
    .flatMap((f) => f.fillet.points.concat([f.resume]))
    .concat(blendArcs)
    .reduce((m, p) => Math.max(m, Math.abs(p.x - c.x), Math.abs(p.y - c.y)), SPAN / 3);
  const span = Math.max(SPAN, reach * 2.4);

  const local = path.points.filter((p) => near(p, c, span));
  const raw = `<polyline class="raw" points="${poly(local, c, span)}"/>`;
  const ring = `<circle class="ring" cx="${PX / 2}" cy="${PX / 2}" r="${((rhoMin / span) * PX).toFixed(1)}"/>`;

  const draw = (f) =>
    f
      ? `<polyline class="arcline" points="${poly(f.fillet.points, c, span)}"/>` +
        `<polyline class="chord" points="${poly([f.resume, f.entry], c, span)}"/>` +
        dot(f.entry, c, span, 'built') + dot(f.resume, c, span, 'resume') +
        dot(f.virtual, c, span, 'virtual', 2)
      : '';

  const stat = (f) => {
    if (!f) return 'no fit';
    const strays = deviation(path.points, f.resumeIndex, f.resumeIndexOut, f.fillet.points);
    const chord = f.chord / spacing;
    // A junction radius is only meaningful across a chord the leg could actually have stepped. A
    // straight chord ten steps long reads as an infinite radius while the tube has left the glyph.
    const radius =
      deg(f.turn) < 1 ? 'straight' : `<b>${(f.honest / r).toFixed(2)}r</b>`;
    const bad = chord > 1.5 ? ' &middot; <b>chord unreachable</b>' : '';
    return `chord <b>${chord.toFixed(1)}x</b>${bad} &middot; turn ${deg(f.turn).toFixed(0)}&deg;
      &middot; junction radius ${radius} &middot; strays <b>${(strays / r).toFixed(2)}r</b>`;
  };

  // The stretch each option replaces, drawn under it, so straying is visible rather than asserted.
  const replaced = (i, j) => {
    const span2 = [];
    for (let k = i; k <= j; k++) span2.push(at(path.points, k));
    return `<polyline class="replaced" points="${poly(span2, c, span)}"/>`;
  };

  const blendPanel = blend
    ? replaced(blend.i, blend.j) +
      `<polyline class="arcline" points="${poly(blendArcs, c, span)}"/>` +
      dot(blend.p0, c, span, 'built') + dot(blend.p1, c, span, 'built') +
      dot(blend.joint, c, span, 'virtual', 2)
    : '';

  const cutStretch = [];
  for (let i = row.lo - 1; i <= row.hi + 1; i++) cutStretch.push(at(path.points, i));
  const brk =
    `<polyline class="cut" points="${poly(cutStretch, c, span)}"/>` +
    dot(at(path.points, row.lo - 1), c, span, 'resume') +
    dot(at(path.points, row.hi + 1), c, span, 'resume');

  html.push(`<section><h2>${row.look} &middot; ${row.source} &middot; ${row.ch}
    <small>ships at ${row.shipped.toFixed(2)}r against a ${(rhoMin / r).toFixed(2)}r floor</small></h2>
    <div class="grid">
    ${panel('fit today, before the step back', stat(worst.shown), raw + ring + replaced(worst.shown.resumeIndex, worst.shown.resumeIndexOut) + draw(worst.shown))}
    ${panel('group widened to the shoulder', stat(widened), raw + ring + draw(widened))}
    ${panel('refit at the resume vertex', stat(iterated), raw + ring + draw(iterated))}
    ${panel(
      'biarc blend',
      blend
        ? `radii <b>${(blend.r1 / r).toFixed(2)}r</b> and <b>${(blend.r2 / r).toFixed(2)}r</b>
           &middot; ${blend.eaten} vertices replaced &middot; strays <b>${(blend.strays / r).toFixed(2)}r</b>
           &middot; swallows <b>${blend.swallowed}</b> other corners`
        : 'no blend clears rho_min within ten steps',
      raw + ring + blendPanel,
    )}
    ${panel('cut instead', `the stretch runs dark; ${row.hi - row.lo + 3} vertices carry no light`, raw + ring + brk)}
  </div></section>`);
}

console.log(`<title>Junction repair</title>
<style>
  :root { --bg:#fbfbfa; --fg:#1a1a19; --muted:#6b6b68; --line:#d8d8d4; --panel:#fff;
          --raw:#b0b0ab; --arc:#1f9d6a; --chord:#d1453b; --virtual:#9a6bd1; --cut:#6b6b68; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --bg:#16171a; --fg:#e8e8e6; --muted:#9a9a96; --line:#2e3035; --panel:#1d1f23;
    --raw:#5a5c62; --arc:#4bd4a0; --chord:#ff6b60; --virtual:#c39bff; --cut:#9a9a96; } }
  :root[data-theme="dark"] { --bg:#16171a; --fg:#e8e8e6; --muted:#9a9a96; --line:#2e3035;
    --panel:#1d1f23; --raw:#5a5c62; --arc:#4bd4a0; --chord:#ff6b60; --virtual:#c39bff; --cut:#9a9a96; }
  body { background:var(--bg); color:var(--fg); margin:0; padding:2rem;
         font:15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  h1 { font-size:1.4rem; margin:0 0 .3rem; }
  h2 { font-size:1rem; margin:2rem 0 .6rem; font-weight:600; }
  h2 small { color:var(--muted); font-weight:400; margin-left:.5rem; }
  code { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:.9em; }
  p.lede { color:var(--muted); max-width:64ch; margin:0 0 1.2rem; }
  .grid { display:grid; gap:1rem; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); }
  figure { margin:0; background:var(--panel); border:1px solid var(--line); border-radius:10px;
           padding:.6rem; }
  svg { width:100%; height:auto; display:block; }
  figcaption { color:var(--muted); font-size:.8rem; margin-top:.4rem; }
  b { color:var(--fg); }
  .raw { fill:none; stroke:var(--raw); stroke-width:1.2; }
  .arcline { fill:none; stroke:var(--arc); stroke-width:2.6; }
  .chord { fill:none; stroke:var(--chord); stroke-width:2.6; stroke-dasharray:4 3; }
  .replaced { fill:none; stroke:var(--chord); stroke-width:6; opacity:.22; stroke-linecap:round; }
  .cut { fill:none; stroke:var(--cut); stroke-width:2.6; stroke-dasharray:2 4; }
  .ring { fill:none; stroke:var(--line); stroke-width:1; stroke-dasharray:3 4; }
  .built { fill:var(--arc); } .resume { fill:var(--chord); } .virtual { fill:var(--virtual); }
  .key { color:var(--muted); font-size:.85rem; margin:0 0 .4rem; }
  .key span { margin-right:1.1rem; }
  .sw { display:inline-block; width:.7rem; height:.7rem; border-radius:50%; margin-right:.35rem;
        vertical-align:-1px; }
  .dash { display:inline-block; width:1.4rem; height:0; margin-right:.35rem; vertical-align:3px;
          border-top:2px dashed var(--chord); }
</style>
<h1>Three ways to answer an untangential splice</h1>
<p class="lede">Each row is the corner that arrives furthest off tangent for that look and path
source. Grey is the extracted contour, green the arc built at the minimum bend radius, red dashed
the junction chord between the leg and the arc's tangent point. The dashed circle is the minimum
bend radius at true scale. Honest radius measures the junction with its shorter step, so stepping
back cannot inflate it.</p>
<p class="key">
  <span><i class="sw" style="background:var(--raw)"></i>contour</span>
  <span><i class="sw" style="background:var(--arc)"></i>arc and its tangent point</span>
  <span><i class="sw" style="background:var(--chord)"></i>where the leg resumes</span>
  <span><i class="dash"></i>junction chord: the gap between leg and arc</span>
  <span><i class="sw" style="background:var(--virtual)"></i>virtual corner or biarc joint</span>
  <span><i class="sw" style="background:var(--chord);opacity:.3"></i>the stretch being replaced</span>
</p>
${html.join('\n')}`);
