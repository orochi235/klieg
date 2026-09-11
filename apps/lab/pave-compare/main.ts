/**
 * Pavé three ways, at the angles a spinning word passes through: the real wells, a shader painting
 * them on, and one baked sheet shown through the letter under a raised rim.
 *
 *   /pave-compare/            one letter, 'R'
 *   /pave-compare/#S          any letter
 */
import * as THREE from 'three';
import { buildEnvironment } from '../../../packages/core/src/render/environment.js';
import { specOf } from '../../../packages/core/src/render/looks.js';
import { Word } from '../../../packages/core/src/render/word.js';
import { loadFont } from '../../../packages/core/src/text/font.js';
import { DEFAULT_GLYPH_OPTIONS } from '../../../packages/core/src/text/glyphs.js';
import { fromEuler } from '../../../packages/core/src/transform.js';
import { paintPave } from './fake.js';
import { bakeSheet, maskMaterial, maskOf, metalOf, rimOf } from './sheet.js';

const LETTER = decodeURIComponent(location.hash.slice(1)) || 'R';
const ANGLES = [0, 25, 50, 70, 84];
const TILE = 520;
const DEG = Math.PI / 180;
const ENV: [number, number] = [0.35, 0.6];

/** The real look's own numbers, so the rows differ in method and nothing else. */
const REAL = specOf('pave');
const decoration = REAL.decoration as unknown as Record<string, unknown> & {
  pitch: number;
  wall?: number;
  stone?: object;
};
const FAKE_BODY = { ...(decoration.stone ?? {}), thickness: 0.4 };
const FAKE = {
  pitch: decoration.pitch,
  wall: (decoration.wall ?? 0.008) / decoration.pitch,
  metal: REAL.color ?? 0xffc44d,
  metalRoughness: REAL.roughness ?? 0.16,
  facets: 8,
};

/** What a row needs from whatever it draws: somewhere to hang it, and a turn. */
interface Row {
  label: string;
  group: THREE.Object3D;
  turn(t: ReturnType<typeof fromEuler>): void;
}

const asRow = (label: string, word: Word): Row => {
  word.setEnvRotation(...ENV);
  return { label, group: word.group, turn: (t) => (word.transform = t) };
};

async function main(): Promise<void> {
  const status = document.getElementById('status') as HTMLElement;
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(TILE, TILE, false);
  renderer.setClearColor(0x0a0a0a);
  const env = buildEnvironment(renderer).texture;

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0, 11);
  const budget = {
    width: 5.4,
    height: 5.4,
    cameraZ: 11,
    extent: 7.5,
    cap: Number.POSITIVE_INFINITY,
  };
  const loaded = await loadFont('/font.ttf');
  const tick = () => new Promise((r) => setTimeout(r, 0));

  status.textContent = `building '${LETTER}' as real geometry…`;
  await tick();
  let t = performance.now();
  const real = new Word(LETTER, loaded, 'pave', budget, false, undefined, undefined, env);
  const realMs = performance.now() - t;

  t = performance.now();
  const fake = new Word(LETTER, loaded, FAKE_BODY, budget, false, undefined, undefined, env);
  fake.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) paintPave(mesh.material as THREE.MeshPhysicalMaterial, FAKE);
  });
  const fakeMs = performance.now() - t;

  // The sheet is the one-time cost, so it is timed apart from what each letter pays.
  status.textContent = 'baking the sheet…';
  await tick();
  const shapes = real.shapes(LETTER);
  const box = new THREE.Box2();
  for (const s of shapes) for (const p of s.getPoints(24)) box.expandByPoint(p);
  box.expandByScalar(0.08);
  const sheet = bakeSheet(box, decoration, env);

  t = performance.now();
  const mask = maskOf(shapes);
  const rim = rimOf(mask);
  const letterMs = performance.now() - t;

  const body = metalOf(REAL, env);
  const shellMetal = metalOf(REAL, env);
  const rimMetal = metalOf(REAL, env);
  maskMaterial(body, mask, 'cap');
  maskMaterial(shellMetal, mask, 'inside');
  maskMaterial(sheet.stoneMaterial, mask, 'inside');
  for (const m of [body, shellMetal, rimMetal, sheet.stoneMaterial]) {
    m.envMapRotation.set(...ENV, 0);
  }

  // Placed exactly as the real word places its one letter: the same fit, the same cell offset.
  const fit = new THREE.Group();
  fit.scale.copy(real.group.scale);
  fit.position.copy(real.group.position);
  const inner = new THREE.Group();
  const cell = new THREE.Group();
  cell.position.set(real.baseX[0] as number, real.baseY[0] as number, 0);
  cell.add(
    new THREE.Mesh(real.glyph(LETTER, DEFAULT_GLYPH_OPTIONS.depth), body),
    new THREE.Mesh(sheet.shell, shellMetal),
    new THREE.Mesh(sheet.stones, sheet.stoneMaterial),
    new THREE.Mesh(rim, rimMetal),
  );
  inner.add(cell);
  fit.add(inner);
  const composed: Row = {
    label: `sheet + rim — sheet baked once in ${sheet.ms.toFixed(0)}ms, this letter ${letterMs.toFixed(0)}ms`,
    group: fit,
    turn: (m) =>
      new THREE.Matrix4()
        .fromArray(m as number[])
        .decompose(inner.position, inner.quaternion, inner.scale),
  };

  const rows: Row[] = [
    asRow(`real geometry — built in ${realMs.toFixed(0)}ms`, real),
    asRow(`shader — built in ${fakeMs.toFixed(0)}ms`, fake),
    composed,
  ];

  const grid = document.getElementById('grid') as HTMLElement;
  for (const row of rows) {
    const scene = new THREE.Scene();
    scene.environment = env;
    scene.add(row.group);
    const head = document.createElement('div');
    head.className = 'label';
    head.textContent = row.label;
    grid.appendChild(head);
    for (const angle of ANGLES) {
      row.turn(fromEuler(0, angle * DEG, 0));
      // Twice: transmission reads the frame before, so the first render of a pose shows the last.
      renderer.render(scene, camera);
      renderer.render(scene, camera);
      const img = document.createElement('img');
      img.src = canvas.toDataURL('image/png');
      img.title = `${row.label}, ${angle}°`;
      grid.appendChild(img);
    }
    scene.remove(row.group);
  }

  const foot = document.createElement('div');
  foot.className = 'angles';
  foot.innerHTML = ANGLES.map((a) => `<span>${a}°</span>`).join('');
  grid.appendChild(foot);
  status.textContent = `'${LETTER}' at pitch ${FAKE.pitch}, turned about its vertical axis`;
  (globalThis as unknown as { DONE: boolean }).DONE = true;
}

void main();
