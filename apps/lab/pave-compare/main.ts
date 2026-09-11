/**
 * Pavé three ways, at the angles a spinning word passes through: the real wells, a shader painting
 * them on, and one baked sheet shown through the letter under a raised rim.
 *
 *   /pave-compare/            one letter, 'R'
 *   /pave-compare/#S          any letter
 */
import * as THREE from 'three';
import type { SheetSpec } from '../../../packages/core/src/render/decoration.js';
import { buildEnvironment } from '../../../packages/core/src/render/environment.js';
import { type LookSpec, specOf } from '../../../packages/core/src/render/looks.js';
import { Word } from '../../../packages/core/src/render/word.js';
import { loadFont } from '../../../packages/core/src/text/font.js';
import { fromEuler } from '../../../packages/core/src/transform.js';
import { paintPave } from './fake.js';

const LETTER = decodeURIComponent(location.hash.slice(1)) || 'R';
const ANGLES = [0, 25, 50, 70, 84];
const TILE = 520;
const DEG = Math.PI / 180;
const ENV: [number, number] = [0.35, 0.6];

/** The shipped look, which is now the sheet, and the carved wells it replaced, on the same numbers. */
const PAVE = specOf('pave');
const decoration = PAVE.decoration as SheetSpec;
const WELLS: LookSpec = {
  ...PAVE,
  decoration: { ...decoration, kind: 'well', insets: 'proportional' },
};
const FAKE_BODY = { ...(decoration.stone ?? {}), thickness: 0.4 };
const FAKE = {
  pitch: decoration.pitch,
  wall: (decoration.wall ?? 0.008) / decoration.pitch,
  metal: PAVE.color ?? 0xffc44d,
  metalRoughness: PAVE.roughness ?? 0.16,
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

  status.textContent = `building '${LETTER}' three ways…`;
  await tick();
  let t = performance.now();
  const wells = new Word(LETTER, loaded, WELLS, budget, false, undefined, undefined, env);
  const wellsMs = performance.now() - t;

  t = performance.now();
  const fake = new Word(LETTER, loaded, FAKE_BODY, budget, false, undefined, undefined, env);
  fake.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) paintPave(mesh.material as THREE.MeshPhysicalMaterial, FAKE);
  });
  const fakeMs = performance.now() - t;

  t = performance.now();
  const sheet = new Word(LETTER, loaded, 'pave', budget, false, undefined, undefined, env);
  const sheetMs = performance.now() - t;

  const rows: Row[] = [
    asRow(`carved wells — built in ${wellsMs.toFixed(0)}ms`, wells),
    asRow(`shader — built in ${fakeMs.toFixed(0)}ms`, fake),
    asRow(`sheet — built in ${sheetMs.toFixed(0)}ms, sheet baked in that`, sheet),
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
