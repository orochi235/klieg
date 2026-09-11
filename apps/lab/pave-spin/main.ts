/**
 * A whole phrase spinning in pavé two ways, frame by frame: the carved wells `pave` used to be
 * above, the baked sheet it is now below. `spikes/pave-spin.mjs` pulls the frames.
 *
 *   /pave-spin/                    'FUCK YOU' over 'TRAVIS'
 *   /pave-spin/#ANY%20TEXT
 */
import * as THREE from 'three';
import { WordCaches } from '../../../packages/core/src/render/caches.js';
import type { SheetSpec } from '../../../packages/core/src/render/decoration.js';
import { buildEnvironment } from '../../../packages/core/src/render/environment.js';
import { type Look, type LookSpec, specOf } from '../../../packages/core/src/render/looks.js';
import { Word } from '../../../packages/core/src/render/word.js';
import { loadFont } from '../../../packages/core/src/text/font.js';
import { fromEuler } from '../../../packages/core/src/transform.js';

const TEXT = decodeURIComponent(location.hash.slice(1)) || 'FUCK YOU\nTRAVIS';
const W = 1280;
const H = 720;
const ENV: [number, number] = [0.35, 0.6];

const PAVE = specOf('pave');
/** The carved wells `pave` shipped as before the sheet: the same numbers, cut into each letter. */
const WELLS: LookSpec = {
  ...PAVE,
  decoration: { ...(PAVE.decoration as SheetSpec), kind: 'well', insets: 'proportional' },
};

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

  const build = (look: Look, caches?: WordCaches) => {
    const t = performance.now();
    const word = new Word(TEXT, loaded, look, budget, false, undefined, undefined, env, caches);
    const ms = performance.now() - t;
    word.setEnvRotation(...ENV);
    return { word, ms };
  };
  const wells = build(WELLS);
  // Twice on one set of caches: the first fire bakes the sheet, the second should not.
  const caches = new WordCaches();
  const cold = build('pave', caches);
  cold.word.dispose();
  const sheet = build('pave', caches);

  const scenes = [wells.word, sheet.word].map((word) => {
    const scene = new THREE.Scene();
    scene.environment = env;
    scene.add(word.group);
    return scene;
  });

  const out = document.createElement('canvas');
  out.width = W;
  out.height = H * 2;
  document.body.appendChild(out);
  const g = out.getContext('2d') as CanvasRenderingContext2D;
  const labels = [
    `carved wells — ${wells.ms.toFixed(0)}ms`,
    `sheet — ${cold.ms.toFixed(0)}ms first fire, ${sheet.ms.toFixed(0)}ms the next`,
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
      wells.word.transform = turn;
      sheet.word.transform = turn;
      draw(scenes[0] as THREE.Scene, 0, labels[0] as string);
      draw(scenes[1] as THREE.Scene, H, labels[1] as string);
      return out.toDataURL('image/jpeg', 0.92);
    },
    READY: { wellsMs: wells.ms, sheetColdMs: cold.ms, sheetWarmMs: sheet.ms },
  });
}

void main();
