import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BloomPath, DEFAULT_BLOOM } from '../../src/render/bloom.js';

type Rect4 = [number, number, number, number];

/** What a single draw saw: uniforms are reused across passes, so textures are snapshotted. */
interface Pass {
  scene: THREE.Scene;
  target: THREE.WebGLRenderTarget | null;
  material: THREE.ShaderMaterial | null;
  source: THREE.Texture | null;
  bloom: THREE.Texture | null;
  dir: THREE.Vector2 | null;
  viewport: Rect4 | null;
  scissor: Rect4 | null;
  scissorTest: boolean;
}

/** One clear or render, in call order - the only way an ordering claim (X before Y) means anything. */
interface Op {
  kind: 'clear' | 'render';
  target: THREE.WebGLRenderTarget | null;
  scissorTest: boolean;
}

function harness(width = 640, height = 480, ratio = 1) {
  let target: THREE.WebGLRenderTarget | null = null;
  const size = new THREE.Vector2(width, height);
  // three 0.187 scales a viewport or scissor by the pixel ratio only on the canvas; on a target
  // it takes them as device pixels. Recorded rects are device pixels, as the GPU sees them.
  const device = (r: Rect4): Rect4 => (target ? r : (r.map((v) => v * ratio) as Rect4));
  const passes: Pass[] = [];
  const ops: Op[] = [];

  // Applied is what's live for the current target; own is what the caller last asked for
  // directly. setRenderTarget(rt) overwrites applied from rt's own size; setRenderTarget(null)
  // restores applied from own - three's real behaviour, not a passthrough.
  let viewport: Rect4 = [0, 0, width, height];
  let scissor: Rect4 | null = null;
  let scissorTest = false;
  let ownViewport: Rect4 = [0, 0, width, height];
  let ownScissor: Rect4 | null = null;
  let ownScissorTest = false;

  const renderer = {
    getDrawingBufferSize: (out: THREE.Vector2) => out.copy(size).multiplyScalar(ratio),
    getSize: (out: THREE.Vector2) => out.copy(size),
    getPixelRatio: () => ratio,
    setViewport: vi.fn((x: number, y: number, w: number, h: number) => {
      ownViewport = [x, y, w, h];
      viewport = device(ownViewport);
    }),
    setScissor: vi.fn((x: number, y: number, w: number, h: number) => {
      ownScissor = [x, y, w, h];
      scissor = device(ownScissor);
    }),
    setScissorTest: vi.fn((on: boolean) => {
      ownScissorTest = on;
      scissorTest = on;
    }),
    setRenderTarget: vi.fn((next: THREE.WebGLRenderTarget | null) => {
      target = next;
      if (next) {
        viewport = [0, 0, next.width, next.height];
        scissor = null;
        scissorTest = false;
      } else {
        viewport = device(ownViewport);
        scissor = ownScissor && device(ownScissor);
        scissorTest = ownScissorTest;
      }
    }),
    clear: vi.fn(() => {
      ops.push({ kind: 'clear', target, scissorTest });
    }),
    render: vi.fn((scene: THREE.Scene) => {
      const mesh = scene.children[0] as THREE.Mesh | undefined;
      const material = (mesh?.material as THREE.ShaderMaterial | undefined) ?? null;
      const uniforms = material?.uniforms;
      const dir = uniforms?.dir?.value as THREE.Vector2 | undefined;
      ops.push({ kind: 'render', target, scissorTest });
      passes.push({
        scene,
        target,
        material,
        source: ((uniforms?.tDiffuse ?? uniforms?.tBase)?.value ?? null) as THREE.Texture | null,
        bloom: (uniforms?.tBloom?.value ?? null) as THREE.Texture | null,
        dir: dir ? dir.clone() : null,
        viewport,
        scissor,
        scissorTest,
      });
    }),
  } as unknown as THREE.WebGLRenderer;

  return { renderer, passes, ops, size };
}

function pass(passes: Pass[], index: number): Pass {
  const found = passes[index];
  if (!found) throw new Error(`no pass ${index} of ${passes.length}`);
  return found;
}

function renderOnce(path: BloomPath): THREE.Scene {
  const scene = new THREE.Scene();
  path.render(scene, new THREE.PerspectiveCamera());
  return scene;
}

interface Freeable {
  addEventListener(type: 'dispose', listener: () => void): void;
}

/** Counts dispose events, which is the only externally visible signal that GPU memory came back. */
function watchDisposal(...targets: Freeable[]): () => number {
  let count = 0;
  for (const t of targets) t.addEventListener('dispose', () => count++);
  return () => count;
}

describe('BloomPath.render', () => {
  it('draws the scene at full resolution and the glow at half', () => {
    const { renderer, passes } = harness(640, 480);
    const scene = renderOnce(new BloomPath(renderer));

    expect(passes).toHaveLength(7);
    const scenePass = pass(passes, 0);
    expect(scenePass.scene).toBe(scene);
    expect([scenePass.target?.width, scenePass.target?.height]).toEqual([640, 480]);
    for (const i of [1, 2, 3, 4, 5]) {
      expect([pass(passes, i).target?.width, pass(passes, i).target?.height]).toEqual([320, 240]);
    }
  });

  it('thresholds the scene, then ping-pongs a separable blur at two radii', () => {
    const { renderer, passes } = harness(640, 480);
    new BloomPath(renderer).render(new THREE.Scene(), new THREE.PerspectiveCamera());

    const sceneRT = pass(passes, 0).target;
    const brightRT = pass(passes, 1).target;
    const blurRT = pass(passes, 2).target;
    expect(pass(passes, 1).source).toBe(sceneRT?.texture);
    expect(pass(passes, 1).material?.uniforms.threshold?.value).toBe(DEFAULT_BLOOM.threshold);

    // Each pass reads what the previous one wrote; a stale read would blur the same texture twice.
    const blur = [2, 3, 4, 5].map((i) => pass(passes, i));
    expect(blur.map((p) => p.target)).toEqual([blurRT, brightRT, blurRT, brightRT]);
    expect(blur.map((p) => p.source)).toEqual([
      brightRT?.texture,
      blurRT?.texture,
      brightRT?.texture,
      blurRT?.texture,
    ]);
    expect(blur.map((p) => p.dir?.toArray())).toEqual([
      [1 / 320, 0],
      [0, 1 / 240],
      [2.5 / 320, 0],
      [0, 2.5 / 240],
    ]);
  });

  it('composites the scene and the blurred glow to the canvas last', () => {
    const { renderer, passes } = harness(640, 480);
    new BloomPath(renderer).render(new THREE.Scene(), new THREE.PerspectiveCamera());

    const composite = pass(passes, 6);
    expect(composite.target).toBeNull();
    expect(composite.viewport).toEqual([0, 0, 640, 480]);
    expect(composite.source).toBe(pass(passes, 0).target?.texture);
    expect(composite.bloom).toBe(pass(passes, 5).target?.texture);
    expect(composite.material?.uniforms.strength?.value).toBe(DEFAULT_BLOOM.strength);
    expect(composite.material?.uniforms.alphaBoost?.value).toBe(DEFAULT_BLOOM.alphaBoost);
  });

  it('encodes the composite for the canvas, which only a direct render gets for free', () => {
    const { renderer, passes } = harness();
    new BloomPath(renderer).render(new THREE.Scene(), new THREE.PerspectiveCamera());

    expect(pass(passes, 6).material?.fragmentShader).toContain('#include <colorspace_fragment>');
    expect(pass(passes, 1).material?.fragmentShader).not.toContain('colorspace_fragment');
  });

  it('carries custom options into the uniforms', () => {
    const { renderer, passes } = harness();
    const path = new BloomPath(renderer, { strength: 2, threshold: 0.1, alphaBoost: 0.25 });
    renderOnce(path);

    expect(pass(passes, 1).material?.uniforms.threshold?.value).toBe(0.1);
    expect(pass(passes, 6).material?.uniforms.strength?.value).toBe(2);
    expect(pass(passes, 6).material?.uniforms.alphaBoost?.value).toBe(0.25);
  });
});

describe('BloomPath target allocation', () => {
  it('follows a drawing buffer that changed under it, and frees what it replaced', () => {
    const { renderer, passes, size } = harness(640, 480);
    const path = new BloomPath(renderer);
    renderOnce(path);

    const disposed = watchDisposal(
      pass(passes, 0).target as THREE.WebGLRenderTarget,
      pass(passes, 1).target as THREE.WebGLRenderTarget,
      pass(passes, 2).target as THREE.WebGLRenderTarget,
    );

    size.set(1000, 800);
    renderOnce(path);

    expect(disposed()).toBe(3);
    expect([pass(passes, 7).target?.width, pass(passes, 7).target?.height]).toEqual([1000, 800]);
    expect([pass(passes, 8).target?.width, pass(passes, 8).target?.height]).toEqual([500, 400]);
  });

  it('reuses the targets while the drawing buffer holds still', () => {
    const { renderer, passes } = harness(640, 480);
    const path = new BloomPath(renderer);
    renderOnce(path);
    const disposed = watchDisposal(pass(passes, 0).target as THREE.WebGLRenderTarget);
    renderOnce(path);

    expect(disposed()).toBe(0);
    expect(pass(passes, 7).target).toBe(pass(passes, 0).target);
  });

  it('clamps a zero-sized drawing buffer to something allocatable', () => {
    const { renderer, passes } = harness(0, 0);
    renderOnce(new BloomPath(renderer));

    expect([pass(passes, 0).target?.width, pass(passes, 0).target?.height]).toEqual([2, 2]);
    expect([pass(passes, 1).target?.width, pass(passes, 1).target?.height]).toEqual([1, 1]);
  });
});

describe('BloomPath.dispose', () => {
  it('frees every render target and material', () => {
    const { renderer, passes } = harness();
    const path = new BloomPath(renderer);
    renderOnce(path);

    const materials = [1, 2, 6].map((i) => pass(passes, i).material as THREE.ShaderMaterial);
    const targets = [0, 1, 2].map((i) => pass(passes, i).target as THREE.WebGLRenderTarget);
    const quad = pass(passes, 1).scene.children[0] as THREE.Mesh;
    const disposed = watchDisposal(...targets, ...materials, quad.geometry);

    path.dispose();
    expect(disposed()).toBe(7);
  });
});

describe('BloomPath.render into a rect', () => {
  const RECT = { x: 100, y: 60, w: 200, h: 150 };

  it('turns off a scissor and normalises a viewport the caller left behind', () => {
    const { renderer, passes } = harness(640, 480);
    // Both armed first: agreeing with the harness's initial state would make this unable to fail.
    renderer.setScissorTest(true);
    renderer.setViewport(7, 7, 33, 33);
    new BloomPath(renderer).render(new THREE.Scene(), new THREE.PerspectiveCamera());

    for (const p of passes) expect(p.scissorTest).toBe(false);
    expect(pass(passes, 6).viewport).toEqual([0, 0, 640, 480]);
  });

  it('renders the scene inside the rect viewport, unscissored, and blurs the whole target', () => {
    const { renderer, passes, ops } = harness(640, 480);
    new BloomPath(renderer).render(new THREE.Scene(), new THREE.PerspectiveCamera(), RECT);

    const scenePass = pass(passes, 0);
    // A scissor here would clip the MSAA resolve blit and strand a neighbour in the margins.
    expect(scenePass.scissorTest).toBe(false);
    expect(scenePass.scissor).toBeNull();
    expect(scenePass.viewport).toEqual([100, 60, 200, 150]);
    // The scene target's clear must precede its render, or the resolved margins go unclean.
    expect(ops[0]).toEqual({ kind: 'clear', target: scenePass.target, scissorTest: false });
    expect(ops[1]).toMatchObject({ kind: 'render', target: scenePass.target });
    // A scissored blur would clip the halo mid-pass and read the wrong texels back.
    for (const i of [1, 2, 3, 4, 5]) expect(pass(passes, i).scissorTest).toBe(false);
  });

  it('composites over the whole canvas but writes only inside the rect', () => {
    const { renderer, passes } = harness(640, 480);
    new BloomPath(renderer).render(new THREE.Scene(), new THREE.PerspectiveCamera(), RECT);

    const composite = pass(passes, 6);
    expect(composite.target).toBeNull();
    // The full-size quad is what keeps vUv aligned with the full-size targets it samples.
    expect(composite.viewport).toEqual([0, 0, 640, 480]);
    expect(composite.scissor).toEqual([100, 60, 200, 150]);
    expect(composite.scissorTest).toBe(true);
    expect(renderer.setScissorTest).toHaveBeenLastCalledWith(false);
  });
  it('places the rect in device pixels on a high-density screen', () => {
    const { renderer, passes } = harness(640, 480, 2);
    new BloomPath(renderer).render(new THREE.Scene(), new THREE.PerspectiveCamera(), RECT);

    const scenePass = pass(passes, 0);
    expect([scenePass.target?.width, scenePass.target?.height]).toEqual([1280, 960]);
    expect(scenePass.viewport).toEqual([200, 120, 400, 300]);
    const composite = pass(passes, 6);
    expect(composite.viewport).toEqual([0, 0, 1280, 960]);
    expect(composite.scissor).toEqual([200, 120, 400, 300]);
  });
});
