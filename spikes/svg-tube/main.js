/**
 * Does `tubing` work on vector art rather than glyphs?
 *
 *   npx vite --port 5199        # from the repo root, then open /spikes/svg-tube/
 *
 * Reads `art.svg` from this directory, which is gitignored: bring your own.
 *
 * The tube pipeline already takes `THREE.Shape[]`, so this feeds it an SVG's paths instead of a
 * glyph's contours. One `<path>` is treated as one letter: it gets its own blueprint, its own run
 * budget and its own seed, which is what keeps `runs` meaning what it means for text.
 *
 * Deep imports into `dist` are the spike convention here (see `spikes/junction-split.mjs`);
 * `buildTubeBlueprint` is not public API and this is not consumer code.
 */
import * as THREE from 'three';
import { BloomPath } from '../../packages/core/dist/render/bloom.js';
import { applyLook, createMaterial, specOf } from '../../packages/core/dist/render/looks.js';
import { Stage } from '../../packages/core/dist/render/stage.js';
import { buildTubeBlueprint } from '../../packages/core/dist/render/tube/index.js';
import { tintByRunColor, tintChannelOf } from '../../packages/core/dist/render/tube/tint.js';
import { svgToShapeGroups } from './svg-shapes.mjs';

/** Drop an SVG in beside this file as `art.svg`, or point at another with `?svg=name.svg`. */
const SVG_URL = new URLSearchParams(location.search).get('svg') ?? './art.svg';
const host = document.getElementById('stage');
const fail = (e) => {
  document.getElementById('err').textContent = String(e?.stack ?? e);
  throw e;
};

const stage = new Stage({ idleTimeoutMs: 3_600_000, target: host });
const renderer = stage.mount();
const bloom = new BloomPath(renderer);

const art = new THREE.Group();
stage.scene.add(art);

const decoration = specOf('tubing').decoration;
const built = [];

/** Perimeter of every contour a shape list contributes, holes included. */
function perimeterOf(shapes) {
  const walk = (curve) => {
    const pts = curve.getPoints(128);
    let l = 0;
    for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return l;
  };
  return shapes.reduce((a, s) => a + walk(s) + (s.holes ?? []).reduce((b, h) => b + walk(h), 0), 0);
}

function build(shapeGroups, { level, radius, runs, source }) {
  for (const b of built) {
    b.blueprint.dispose();
    b.materials.forEach((m) => m.dispose());
  }
  built.length = 0;
  art.clear();

  let litCount = 0;
  let runCount = 0;
  let starved = 0;

  shapeGroups.forEach((shapes, i) => {
    // `runs` is a budget the cut allocates before it drops any piece under `minRun`, so a short
    // contour can lose every piece and render nothing (klieg's runs.ts:768). Ask for a count the
    // contour can actually carry. Remove once core bounds the budget itself, as TubeSpec promises.
    const affordable = Math.max(1, Math.floor(perimeterOf(shapes) / decoration.minRun));
    if (affordable < runs) starved++;
    const spec = { ...decoration, level, radius, runs: Math.min(runs, affordable), pathSource: source };
    const blueprint = buildTubeBlueprint(shapes, spec, 0.3, i);

    const lit = createMaterial();
    applyLook(lit, spec.look);
    tintByRunColor(lit, tintChannelOf(spec.look), undefined, undefined, spec.look.rim);
    lit.transparent = true;
    lit.side = THREE.DoubleSide;
    lit.emissiveIntensity = spec.look.emissiveIntensity ?? 1;

    const dark = createMaterial();
    applyLook(dark, spec.dark);
    dark.transparent = true;
    dark.side = THREE.DoubleSide;
    dark.emissiveIntensity = spec.dark.emissiveIntensity ?? 1;

    for (const geo of blueprint.lit) art.add(new THREE.Mesh(geo, lit));
    for (const geo of blueprint.dark) art.add(new THREE.Mesh(geo, dark));

    litCount += blueprint.lit.length;
    runCount += blueprint.runs.length;
    built.push({ blueprint, materials: [lit, dark] });
  });
  return { litCount, runCount, starved, empty: built.filter((b) => !b.blueprint.runs.length).length };
}

/** Scale the art to the same share of the frustum a fired word takes. */
function fit(width, height) {
  const budget = stage.viewportBudget();
  const scale = Math.min(budget.width / width, budget.height / height);
  art.scale.setScalar(scale);
}

// --- pivot ------------------------------------------------------------------
// Free rotation rather than the show route's snap-back: this exists to inspect the art from any
// angle, and a spring that pulls it head-on fights that.
const view = { yaw: 0, pitch: 0 };
host.addEventListener('pointerdown', (event) => {
  host.setPointerCapture(event.pointerId);
  host.classList.add('dragging');
  let last = { x: event.clientX, y: event.clientY };
  const move = (e) => {
    const span = Math.max(1, host.clientWidth);
    view.yaw += ((e.clientX - last.x) / span) * Math.PI;
    view.pitch += ((e.clientY - last.y) / span) * Math.PI;
    last = { x: e.clientX, y: e.clientY };
  };
  const up = () => {
    if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
    host.classList.remove('dragging');
    for (const t of ['pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'])
      host.removeEventListener(t, t === 'pointermove' ? move : up);
  };
  host.addEventListener('pointermove', move);
  host.addEventListener('pointerup', up);
  host.addEventListener('pointercancel', up);
  host.addEventListener('lostpointercapture', up);
});
host.addEventListener('dblclick', () => {
  view.yaw = 0;
  view.pitch = 0;
});

// --- run --------------------------------------------------------------------
const svgText = await fetch(SVG_URL).then((r) => {
  if (!r.ok) throw new Error(`${SVG_URL}: ${r.status} — put an SVG beside main.js as art.svg`);
  return r.text();
});
document.getElementById('ref').src = SVG_URL;

const { groups, width, height } = svgToShapeGroups(svgText, 1);
const controls = {
  contract: document.getElementById('contract'),
  radius: document.getElementById('radius'),
  runs: document.getElementById('runs'),
  source: document.getElementById('source'),
};
const stats = document.getElementById('stats');

function rebuild() {
  // Contracting the art is a negative isocontour level: the trace rides inside the outline rather
  // than on it. `direct` offsets each ring by a normal and cannot split, so a deep contract needs
  // `field`, whose marching squares over an SDF handles a shape breaking into pieces.
  const contract = Number(controls.contract.value);
  const radius = Number(controls.radius.value);
  const runs = Number(controls.runs.value);
  const source = controls.source.value;
  document.getElementById('contractV').textContent = contract.toFixed(3);
  document.getElementById('radiusV').textContent = radius.toFixed(3);
  document.getElementById('runsV').textContent = String(runs);
  const t0 = performance.now();
  const { litCount, runCount, starved, empty } = build(groups, {
    level: -contract,
    radius,
    runs,
    source,
  });
  fit(width, height);
  const notes = [];
  if (starved) notes.push(`${starved} path${starved > 1 ? 's' : ''} capped by minRun`);
  if (empty) notes.push(`${empty} EMPTY`);
  stats.textContent =
    `${groups.length} paths · ${runCount} runs · ${litCount} lit · ${(performance.now() - t0).toFixed(0)}ms` +
    (notes.length ? ` · ${notes.join(' · ')}` : '');
}
for (const c of Object.values(controls)) c.addEventListener('input', rebuild);
controls.source.addEventListener('change', rebuild);
document.getElementById('showRef').addEventListener('change', (e) => {
  document.getElementById('silhouette').classList.toggle('on', e.target.checked);
});

try {
  rebuild();
} catch (e) {
  fail(e);
}

const euler = new THREE.Euler(0, 0, 0, 'XYZ');
function frame() {
  euler.set(view.pitch, view.yaw, 0);
  art.setRotationFromEuler(euler);
  bloom.render(stage.scene, stage.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
