/**
 * Real pavé geometry against pavé painted on in a shader, at the angles a spinning word passes
 * through. Straight on, sparkle can carry a painted surface; the question is what grazing does.
 *
 *   /pave-compare/            one letter, 'R'
 *   /pave-compare/#S          any letter
 */
import * as THREE from 'three';
import { buildEnvironment } from '../../../packages/core/src/render/environment.js';
import { specOf } from '../../../packages/core/src/render/looks.js';
import { Word } from '../../../packages/core/src/render/word.js';
import { loadFont } from '../../../packages/core/src/text/font.js';
import { fromEuler } from '../../../packages/core/src/transform.js';
import { paintPave } from './fake.js';

const LETTER = decodeURIComponent(location.hash.slice(1)) || 'R';
const ANGLES = [0, 25, 50, 70, 84];
const TILE = 520;
const DEG = Math.PI / 180;

/** The real look's own numbers, so the two rows differ in method and nothing else. */
const REAL = specOf('pave');
const decoration = REAL.decoration as { pitch: number; wall?: number; stone?: object };
const FAKE_BODY = {
  ...(decoration.stone ?? {}),
  thickness: 0.4,
};
const FAKE = {
  pitch: decoration.pitch,
  wall: (decoration.wall ?? 0.008) / decoration.pitch,
  metal: REAL.color ?? 0xffc44d,
  metalRoughness: REAL.roughness ?? 0.16,
  facets: 8,
};

async function main(): Promise<void> {
  const status = document.getElementById('status') as HTMLElement;
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(TILE, TILE, false);
  renderer.setClearColor(0x0a0a0a);
  const env = buildEnvironment(renderer);

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

  status.textContent = `building '${LETTER}' as real geometry…`;
  await new Promise((r) => setTimeout(r, 0));
  const t0 = performance.now();
  const real = new Word(LETTER, loaded, 'pave', budget, false, undefined, undefined, env.texture);
  const realMs = performance.now() - t0;

  const t1 = performance.now();
  const fake = new Word(
    LETTER,
    loaded,
    FAKE_BODY,
    budget,
    false,
    undefined,
    undefined,
    env.texture,
  );
  fake.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) paintPave(mesh.material as THREE.MeshPhysicalMaterial, FAKE);
  });
  const fakeMs = performance.now() - t1;

  const rows: [string, Word, number][] = [
    ['real geometry', real, realMs],
    ['shader', fake, fakeMs],
  ];
  const grid = document.getElementById('grid') as HTMLElement;
  for (const [label, word, ms] of rows) {
    const scene = new THREE.Scene();
    scene.environment = env.texture;
    scene.add(word.group);
    word.setEnvRotation(0.35, 0.6);

    const head = document.createElement('div');
    head.className = 'label';
    head.textContent = `${label} — built in ${ms.toFixed(0)}ms`;
    grid.appendChild(head);
    for (const angle of ANGLES) {
      word.transform = fromEuler(0, angle * DEG, 0);
      // Twice: transmission reads the frame before, so the first render of a pose is the one
      // before it, not this one.
      renderer.render(scene, camera);
      renderer.render(scene, camera);
      const img = document.createElement('img');
      img.src = canvas.toDataURL('image/png');
      img.title = `${label}, ${angle}°`;
      grid.appendChild(img);
    }
    scene.remove(word.group);
  }

  const foot = document.createElement('div');
  foot.className = 'angles';
  foot.innerHTML = `${ANGLES.map((a) => `<span>${a}°</span>`).join('')}`;
  grid.appendChild(foot);
  status.textContent = `'${LETTER}' at pitch ${FAKE.pitch}, turned about its vertical axis`;
  (globalThis as unknown as { DONE: boolean }).DONE = true;
}

void main();
