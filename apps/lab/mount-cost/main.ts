/**
 * Where the main thread actually goes between fire() and the first painted frame.
 *
 * The node spike (spikes/fire-build-cost.mjs) covers the CPU-side geometry build. This covers what
 * node cannot: GL context creation, the PMREM environment prefilter, and shader program compile —
 * the three costs paid per *mount*, which the 8s idle timeout makes a per-fire cost for any page
 * that fires less often than that.
 */
import * as THREE from 'three';
import { buildEnvironment } from '../../../packages/core/src/render/environment.js';
import { Word } from '../../../packages/core/src/render/word.js';
import { loadFont } from '../../../packages/core/src/text/font.js';
import {
  buildGlyphGeometry,
  DEFAULT_GLYPH_OPTIONS,
} from '../../../packages/core/src/text/glyphs.js';

const rows: [string, number][] = [];
const time = <T>(label: string, fn: () => T): T => {
  const t = performance.now();
  const out = fn();
  const ms = performance.now() - t;
  rows.push([label, ms]);
  console.log(`${label}: ${ms.toFixed(1)}ms`);
  return out;
};

const budget = { width: 8, height: 3, cameraZ: 12, extent: 12 };
const camera = new THREE.PerspectiveCamera(45, 2, 0.1, 100);
camera.position.set(0, 0, 12);

async function main(): Promise<void> {
  const t0 = performance.now();
  const loaded = await loadFont('/font.ttf');
  rows.push(['font fetch + parse', performance.now() - t0]);

  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  document.body.appendChild(canvas);
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:-1;opacity:0.25';

  const renderer = time(
    'new WebGLRenderer (GL context)',
    () =>
      new THREE.WebGLRenderer({ canvas, alpha: true, premultipliedAlpha: false, antialias: true }),
  );
  renderer.setSize(1280, 720, false);

  const env = time('buildEnvironment (PMREM prefilter)', () => buildEnvironment(renderer));

  // 'gold' twice: the second models a repeat fire while the renderer is still mounted, which is
  // the only path a cache can help. Everything before it is per-mount and a cache cannot touch it.
  const seen: Record<string, number> = { gold: 0, tubing: 0 };
  for (const look of ['gold', 'gold', 'tubing', 'tubing'] as const) {
    const scene = new THREE.Scene();
    scene.environment = env.texture;
    const word = time(
      `new Word('JACKPOT!', '${look}') #${++seen[look]}`,
      () => new Word('JACKPOT!', loaded, look, budget, false, undefined, undefined, env.texture),
    );
    scene.add(word.group);
    time(`  compile shaders ('${look}') #${seen[look]}`, () => renderer.compile(scene, camera));
    time(`  first render ('${look}') #${seen[look]}`, () => renderer.render(scene, camera));
    time(`  second render ('${look}') #${seen[look]}`, () => renderer.render(scene, camera));
    word.dispose();
  }

  // Why the warm holds its throwaway instead of disposing it. three refcounts a program per
  // material, so the last reference going away deletes the linked program: the `programs` row
  // below reads 0 after the disposing variant and 2 after the keeping one. Three looks never drawn
  // above, so none has been linked yet — one warmed and dropped, one warmed and held, one not.
  (globalThis as unknown as { RENDERER: THREE.WebGLRenderer }).RENDERER = renderer;
  const programCount = () => renderer.info.programs?.length ?? -1;
  const programsBeforeWarm = programCount();
  const warmScene = new THREE.Scene();
  warmScene.environment = env.texture;
  const throwaway = new Word(
    'A',
    loaded,
    'velvet',
    budget,
    false,
    undefined,
    undefined,
    env.texture,
  );
  warmScene.add(throwaway.group);
  const pixel = new THREE.WebGLRenderTarget(1, 1);
  const pixelHeld = new THREE.WebGLRenderTarget(1, 1);
  renderer.setRenderTarget(pixel);
  time("warm ('velvet'), throwaway DISPOSED — what klieg used to do", () =>
    renderer.render(warmScene, camera),
  );
  renderer.setRenderTarget(null);
  warmScene.remove(throwaway.group);
  throwaway.dispose();
  pixel.dispose();
  const programsAfterWarm = programCount();

  // The same warm again, but the throwaway is kept alive — if the disposed run re-links and this
  // one does not, three's refcount is what decides whether a warm survives, not the driver.
  const heldScene = new THREE.Scene();
  heldScene.environment = env.texture;
  const held = new Word('A', loaded, 'sequin', budget, false, undefined, undefined, env.texture);
  heldScene.add(held.group);
  renderer.setRenderTarget(pixelHeld);
  time("warm ('sequin'), throwaway HELD — what klieg does", () =>
    renderer.render(heldScene, camera),
  );
  renderer.setRenderTarget(null);

  rows.push([
    `programs: ${programsBeforeWarm} before warm, ${programsAfterWarm} after the disposing warm, ${programCount()} after the keeping one`,
    Number.NaN,
  ]);

  const fire = (look: 'velvet' | 'sequin' | 'leather', label: string) => {
    const scene = new THREE.Scene();
    scene.environment = env.texture;
    const word = new Word(
      'JACKPOT!',
      loaded,
      look,
      budget,
      false,
      undefined,
      undefined,
      env.texture,
    );
    scene.add(word.group);
    time(`  first render ('${look}', ${label})`, () => renderer.render(scene, camera));
    word.dispose();
  };
  fire('velvet', 'warmed, throwaway disposed');
  fire('sequin', 'warmed, throwaway kept');
  fire('leather', 'never warmed');
  held.dispose();
  pixelHeld.dispose();

  // The persistent half of a warm rests on this: geometry built under one context has to draw
  // under the next one, or an instance-level cache is a use-after-free rather than a saving.
  const survivor = buildGlyphGeometry(loaded.font, 'K', 1, DEFAULT_GLYPH_OPTIONS);
  // No env map and no texture on the probe: the PMREM target dies with its renderer, and a
  // failure there would answer a different question than the one being asked.
  const probe = new THREE.Scene();
  probe.add(new THREE.Mesh(survivor, new THREE.MeshNormalMaterial()));
  renderer.render(probe, camera);
  const before = renderer.info.render.triangles;

  renderer.dispose();
  renderer.forceContextLoss();

  const canvas2 = document.createElement('canvas');
  const renderer2 = new THREE.WebGLRenderer({ canvas: canvas2, alpha: true, antialias: true });
  renderer2.setSize(1280, 720, false);
  let reuse: string;
  try {
    time('re-render cached geometry on a NEW context', () => renderer2.render(probe, camera));
    const after = renderer2.info.render.triangles;
    reuse =
      after === before && after > 0
        ? `ok — ${after} triangles both times`
        : `MISMATCH ${before} then ${after}`;
  } catch (err) {
    reuse = `THREW: ${(err as Error).message}`;
  }
  rows.push([`geometry survives context swap: ${reuse}`, Number.NaN]);
  console.log(`geometry survives context swap: ${reuse}`);

  const table = document.getElementById('out') as HTMLElement;
  table.innerHTML = rows
    .map(
      ([label, ms]) =>
        `<tr><td>${label}</td><td>${Number.isNaN(ms) ? '' : `${ms.toFixed(1)}ms`}</td></tr>`,
    )
    .join('');
  (document.getElementById('note') as HTMLElement).textContent =
    'Everything above the first Word is paid again on every mount — which the 8s idle timeout makes every fire, for a page that fires less often than that. The programs row is why the warm holds its throwaway: dropping it returns the programs it just linked.';
  (globalThis as unknown as { RESULT: [string, number][] }).RESULT = rows;
}

void main();
