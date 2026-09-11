/**
 * A whole phrase spinning in pavé two ways, frame by frame: the real wells above, one baked sheet
 * shown through each letter under a raised rim below. `spikes/pave-spin.mjs` pulls the frames.
 *
 *   /pave-spin/                    'FUCK YOU' over 'TRAVIS'
 *   /pave-spin/#ANY%20TEXT
 */
import * as THREE from 'three';
import { buildEnvironment } from '../../../packages/core/src/render/environment.js';
import { type Look, specOf } from '../../../packages/core/src/render/looks.js';
import { Word } from '../../../packages/core/src/render/word.js';
import { loadFont } from '../../../packages/core/src/text/font.js';
import { DEFAULT_GLYPH_OPTIONS } from '../../../packages/core/src/text/glyphs.js';
import { fromEuler } from '../../../packages/core/src/transform.js';
import {
  bakeSheet,
  type Mask,
  maskMaterial,
  maskOf,
  metalOf,
  rimOf,
  stoneMaterialOf,
} from '../pave-compare/sheet.js';

const TEXT = decodeURIComponent(location.hash.slice(1)) || 'FUCK YOU\nTRAVIS';
const W = 1280;
const H = 720;
const ENV: [number, number] = [0.35, 0.6];
/** How far a letter's own patch of the sheet may sit from any other's, in em. Six cells or so. */
const SLACK = 0.3;
const DEPTH = DEFAULT_GLYPH_OPTIONS.depth;

const REAL = specOf('pave');
const decoration = REAL.decoration as unknown as Record<string, unknown> & { stone?: Look };

/** Deterministic, so two runs slide each letter's patch the same way. */
const frac = (n: number) => n - Math.floor(n);

async function main(): Promise<void> {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x0a0a0a);
  const env = buildEnvironment(renderer).texture;

  const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 100);
  camera.position.set(0, 0, 11);
  const vh = 2 * Math.tan((19 * Math.PI) / 180) * 11;
  const vw = (vh * W) / H;
  const budget = {
    width: vw * 0.84,
    height: vh * 0.8,
    cameraZ: 11,
    extent: vw,
    cap: Number.POSITIVE_INFINITY,
  };
  const loaded = await loadFont('/font.ttf');

  let t = performance.now();
  const real = new Word(TEXT, loaded, 'pave', budget, false, undefined, undefined, env);
  const realMs = performance.now() - t;
  real.setEnvRotation(...ENV);

  // Every letter that draws ink, where the real word put it.
  const read = real.readout();
  const letters = read.chars
    .map((ch, k) => ({ ch, x: read.x[k] as number, y: read.y[k] as number }))
    .filter(({ ch }) => real.glyph(ch, DEPTH).attributes.position?.count);
  const distinct = [...new Set(letters.map((l) => l.ch))];

  const box = new THREE.Box2();
  for (const ch of distinct) {
    for (const s of real.shapes(ch)) for (const p of s.getPoints(24)) box.expandByPoint(p);
  }
  box.expandByScalar(0.08);
  box.max.addScalar(SLACK);

  t = performance.now();
  const sheet = bakeSheet(box, decoration, env);
  const sheetMs = performance.now() - t;

  t = performance.now();
  const masks = new Map<string, Mask>();
  const rims = new Map<string, THREE.BufferGeometry>();
  for (const ch of distinct) {
    const mask = maskOf(real.shapes(ch));
    masks.set(ch, mask);
    rims.set(ch, rimOf(mask));
  }
  const letterMs = performance.now() - t;

  const rimMetal = metalOf(REAL, env);
  const materials: THREE.MeshPhysicalMaterial[] = [rimMetal];
  const fit = new THREE.Group();
  fit.scale.copy(real.group.scale);
  fit.position.copy(real.group.position);
  const inner = new THREE.Group();
  fit.add(inner);

  letters.forEach(({ ch, x, y }, k) => {
    const mask = masks.get(ch) as Mask;
    const shift = new THREE.Vector2(-SLACK * frac(k * 0.618034), -SLACK * frac(k * 0.381966 + 0.1));
    const body = metalOf(REAL, env);
    const shell = metalOf(REAL, env);
    const stones = stoneMaterialOf(sheet, decoration.stone ?? 'gem', env);
    maskMaterial(body, mask, 'cap');
    maskMaterial(shell, mask, 'inside', shift);
    maskMaterial(stones, mask, 'inside', shift);
    materials.push(body, shell, stones);

    const cell = new THREE.Group();
    cell.position.set(x, y, 0);
    const shellMesh = new THREE.Mesh(sheet.shell, shell);
    const stoneMesh = new THREE.Mesh(sheet.stones, stones);
    shellMesh.position.set(shift.x, shift.y, 0);
    stoneMesh.position.set(shift.x, shift.y, 0);
    cell.add(
      new THREE.Mesh(real.glyph(ch, DEPTH), body),
      shellMesh,
      stoneMesh,
      new THREE.Mesh(rims.get(ch), rimMetal),
    );
    inner.add(cell);
  });
  for (const m of materials) m.envMapRotation.set(...ENV, 0);

  const realScene = new THREE.Scene();
  realScene.environment = env;
  realScene.add(real.group);
  const sheetScene = new THREE.Scene();
  sheetScene.environment = env;
  sheetScene.add(fit);

  const out = document.createElement('canvas');
  out.width = W;
  out.height = H * 2;
  document.body.appendChild(out);
  const g = out.getContext('2d') as CanvasRenderingContext2D;
  const labels = [
    `real wells — ${realMs.toFixed(0)}ms`,
    `sheet + rim — sheet ${sheetMs.toFixed(0)}ms once, ${distinct.length} letters ${letterMs.toFixed(0)}ms`,
  ];

  const draw = (scene: THREE.Scene, top: number, label: string) => {
    // Twice: transmission reads the frame before, so the first render of a pose shows the last.
    renderer.render(scene, camera);
    renderer.render(scene, camera);
    g.drawImage(canvas, 0, top);
    g.fillStyle = '#ffd479';
    g.font = '20px ui-monospace, monospace';
    g.fillText(label, 20, top + 34);
  };

  Object.assign(globalThis, {
    frame(k: number, n: number): string {
      const turn = fromEuler(0, (2 * Math.PI * k) / n, 0);
      real.transform = turn;
      new THREE.Matrix4()
        .fromArray(turn as number[])
        .decompose(inner.position, inner.quaternion, inner.scale);
      draw(realScene, 0, labels[0] as string);
      draw(sheetScene, H, labels[1] as string);
      return out.toDataURL('image/jpeg', 0.92);
    },
    READY: { realMs, sheetMs, letterMs, letters: letters.length, distinct: distinct.length },
  });
}

void main();
