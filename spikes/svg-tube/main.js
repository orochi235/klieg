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

function build(shapeGroups, tune) {
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
    const affordable = Math.max(1, Math.floor(perimeterOf(shapes) / tune.minRun));
    if (affordable < tune.runs) starved++;
    const spec = {
      ...decoration,
      ...tune,
      runs: Math.min(tune.runs, affordable),
      look: { ...decoration.look, emissiveIntensity: tune.emissive, rim: tune.rim || undefined },
      colors: [tune.color],
      dark: { ...decoration.dark, color: tune.dark },
    };
    if (!spec.surfaces.length) return;
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
/**
 * Every knob `buildTubeBlueprint` actually reads, in the order a sign is built: the shape the tube
 * follows, how it is cut into runs, which runs light, which surfaces exist, and what they are made
 * of. Defaults are `tubing`'s own, so the page opens on the shipped look.
 */
const D = decoration;
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const unhex = (s) => Number.parseInt(s.slice(1), 16);
const CONTROLS = [
  { group: 'shape' },
  { id: 'contract', min: 0, max: 0.09, step: 0.002, value: 0, hint: 'inset before tracing' },
  { id: 'radius', min: 0.004, max: 0.06, step: 0.002, value: D.radius },
  { id: 'spacing', min: 0.005, max: 0.06, step: 0.005, value: D.spacing },
  { id: 'segments', min: 3, max: 24, step: 1, value: D.segments },
  { id: 'wander', min: 0, max: 0.08, step: 0.002, value: D.amplitude ?? 0 },
  { id: 'source', type: 'select', value: 'direct', options: ['direct', 'field', 'exact'] },

  { group: 'runs' },
  { id: 'runs', min: 1, max: 24, step: 1, value: D.runs },
  { id: 'minRun', min: 0.02, max: 0.6, step: 0.01, value: D.minRun },
  { id: 'bend', min: 1.25, max: 6, step: 0.25, value: D.bend ?? 2 },
  { id: 'connect', min: 0, max: 1, step: 0.05, value: D.corners?.connect ?? 0, hint: 'corners bent vs cut' },
  { id: 'blockout', min: 0, max: 1, step: 0.05, value: D.blockout ?? 0, hint: 'cuts carried unlit' },

  { group: 'lit' },
  { id: 'amount', min: 0, max: 1, step: 0.02, value: D.select.amount ?? 1, hint: 'fraction of runs lit' },
  { id: 'by', type: 'select', value: D.select.by, options: ['seed', 'length', 'index'] },

  { group: 'surfaces' },
  { id: 'front', type: 'check', value: D.surfaces.includes('front') },
  { id: 'back', type: 'check', value: D.surfaces.includes('back') },
  { id: 'wall', type: 'check', value: D.surfaces.includes('wall') },
  { id: 'wallDepth', min: 0, max: 1, step: 0.05, value: D.wallDepth ?? 0.5 },
  { id: 'connectors', min: 0, max: 8, step: 1, value: D.connectors ?? 0, hint: 'front-to-back links' },

  { group: 'material' },
  { id: 'emissive', min: 0, max: 8, step: 0.1, value: D.look.emissiveIntensity ?? 1 },
  { id: 'rim', min: 0, max: 1, step: 0.05, value: D.look.rim ?? 0, hint: 'limb brightening' },
  // The palette the runs are dealt from, which is where a tube look's colour actually lives:
  // `tintByRunColor` forces the material's own channel white so the per-vertex colour survives.
  { id: 'color', type: 'color', value: hex(D.colors[0] ?? 0xffffff), hint: 'run palette' },
  { id: 'dark', type: 'color', value: hex(D.dark.color ?? 0x222228), hint: 'unlit tube' },
];

const ui = {};
const panel = document.getElementById('controls');
let column = null;
for (const c of CONTROLS) {
  if (c.group) {
    column = document.createElement('div');
    column.className = 'col';
    const h = document.createElement('div');
    h.className = 'group';
    h.textContent = c.group;
    column.appendChild(h);
    panel.appendChild(column);
    continue;
  }
  const label = document.createElement('label');
  if (c.hint) label.title = c.hint;
  const name = document.createElement('span');
  name.textContent = c.id;
  label.appendChild(name);

  let input;
  if (c.type === 'select') {
    input = document.createElement('select');
    for (const o of c.options) {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
      input.appendChild(opt);
    }
    input.value = c.value;
  } else if (c.type === 'check') {
    label.className = 'check';
    input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = c.value;
  } else if (c.type === 'color') {
    input = document.createElement('input');
    input.type = 'color';
    input.value = c.value;
  } else {
    input = document.createElement('input');
    input.type = 'range';
    Object.assign(input, { min: c.min, max: c.max, step: c.step, value: c.value });
  }
  input.id = `c-${c.id}`;
  label.appendChild(input);

  if (!c.type) {
    const out = document.createElement('output');
    out.id = `v-${c.id}`;
    label.appendChild(out);
  }
  column.appendChild(label);
  ui[c.id] = input;
}

const val = (id) => Number(ui[id].value);
const on = (id) => ui[id].checked;



const stats = document.getElementById('stats');

function tuneFromUi() {
  const surfaces = ['front', 'back', 'wall'].filter(on);
  return {
    // Contraction is a negative isocontour level: the trace rides inside the outline rather than
    // on it. `direct` offsets each ring by a normal and cannot split, so a deep contract needs
    // `field`, whose marching squares over an SDF handles a shape breaking into pieces.
    level: -val('contract'),
    radius: val('radius'),
    spacing: val('spacing'),
    segments: val('segments'),
    amplitude: val('wander'),
    pathSource: ui.source.value,
    runs: val('runs'),
    minRun: val('minRun'),
    bend: val('bend'),
    corners: { break: 1 - val('connect'), connect: val('connect') },
    blockout: val('blockout'),
    select: { by: ui.by.value, amount: val('amount') },
    surfaces,
    wallDepth: val('wallDepth'),
    connectors: val('connectors'),
    emissive: val('emissive'),
    rim: val('rim'),
    color: unhex(ui.color.value),
    dark: unhex(ui.dark.value),
  };
}

function rebuild() {
  for (const c of CONTROLS) {
    if (c.group || c.type) continue;
    const out = document.getElementById(`v-${c.id}`);
    const v = val(c.id);
    out.textContent = c.step >= 1 ? String(v) : v.toFixed(3);
  }
  const tune = tuneFromUi();
  const t0 = performance.now();
  const { litCount, runCount, starved, empty } = build(groups, tune);
  fit(width, height);
  const notes = [];
  if (!tune.surfaces.length) notes.push('no surface enabled');
  if (starved) notes.push(`${starved} capped by minRun`);
  if (empty) notes.push(`${empty} EMPTY`);
  stats.textContent =
    `${groups.length} paths · ${runCount} runs · ${litCount} lit · ${(performance.now() - t0).toFixed(0)}ms` +
    (notes.length ? ` · ${notes.join(' · ')}` : '');
}

for (const input of Object.values(ui)) {
  input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', rebuild);
}

document.getElementById('title').addEventListener('click', () => {
  const hud = document.getElementById('hud');
  const hidden = hud.classList.toggle('collapsed');
  hud.querySelector('#title .hint').textContent = hidden ? '[show]' : '[hide]';
});

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
