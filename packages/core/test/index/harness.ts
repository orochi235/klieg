import { type Font, parse } from 'opentype.js';
import type * as THREE from 'three';
import { vi } from 'vitest';
import { type Clock, ManualClock, type Tick } from '../../src/clock.js';
import { createKlieg, type KliegOptions } from '../../src/index.js';
import { Stage } from '../../src/render/stage.js';

/**
 * The shared fixtures for the createKlieg tests. Each test file mocks opentype.js itself, since
 * `vi.mock` only hoists within a test file, and registers `setup`/`teardown` as its own hooks.
 */
export const UPEM = 1000;
export const ADVANCE = 600;
export const TAU = Math.PI * 2;
/** Every letter is a 0.5 em box, so each one gets a real mesh. */
export const BOX = (size: number) => [
  { type: 'M', x: 0, y: 0 },
  { type: 'L', x: 0.5 * size, y: 0 },
  { type: 'L', x: 0.5 * size, y: -0.7 * size },
  { type: 'Z' },
];

export function stubFont(): Font {
  return {
    unitsPerEm: UPEM,
    // A space advances and draws nothing, as a real face does: it is how a word gets no parts.
    charToGlyph: (char: string) => ({
      advanceWidth: ADVANCE,
      getPath: (_x: number, _y: number, size: number) => ({
        commands: char === ' ' ? [] : BOX(size),
        // The layout engine serializes an outline once per glyph; a real opentype Path has this.
        toPathData: () => 'M0 0Z',
      }),
    }),
    getKerningValue: () => 0,
  } as unknown as Font;
}

export const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type Listener = (e: unknown) => void;
export let listeners: Map<string, Listener[]>;

export let idleCallbacks: (() => void)[];

/** The warm rides a real requestIdleCallback in a browser; here it only runs when driven. */
export function stubIdle(): void {
  idleCallbacks = [];
  vi.stubGlobal('requestIdleCallback', (fn: () => void) => idleCallbacks.push(fn));
  vi.stubGlobal('cancelIdleCallback', () => {});
}

export async function runIdle(): Promise<void> {
  for (const fn of idleCallbacks.splice(0)) fn();
  await flush();
  await flush();
}

/** node has no window event target, and every effect attaches a pointermove listener. */
export function stubListeners(): void {
  listeners = new Map();
  vi.stubGlobal('addEventListener', (type: string, fn: Listener) => {
    listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  });
  vi.stubGlobal('removeEventListener', (type: string, fn: Listener) => {
    listeners.set(
      type,
      (listeners.get(type) ?? []).filter((f) => f !== fn),
    );
  });
}

export const dispatch = (type: string, e: unknown = {}) => {
  for (const fn of [...(listeners.get(type) ?? [])]) fn(e);
};

/** Ignores unsubscribe, so a tick still reaches an effect that has already settled. */
export class LeakyClock implements Clock {
  private t = 0;
  private readonly subs = new Set<Tick>();

  now(): number {
    return this.t;
  }

  subscribe(fn: Tick): () => void {
    this.subs.add(fn);
    return () => {};
  }

  advance(deltaMs: number): void {
    this.t += deltaMs;
    for (const fn of [...this.subs]) fn(this.t);
  }
}

export let clock: ManualClock;
export let calls: string[];
export let mounted: Stage | null;
export let renderer: THREE.WebGLRenderer;
export let renders: number;
export let peakWords: number;
/** Hook for the one test that needs a tick to blow up the way a lost context does. */
let onRender: () => void;

export function setOnRender(fn: () => void): void {
  onRender = fn;
}

export function stubStage(): void {
  vi.spyOn(Stage.prototype, 'mount').mockImplementation(function (this: Stage) {
    mounted = this;
    calls.push('mount');
    return renderer;
  });
  vi.spyOn(Stage.prototype, 'scheduleIdleTeardown').mockImplementation(() => {
    calls.push('idle');
  });
  vi.spyOn(Stage.prototype, 'unmount').mockImplementation(() => {
    calls.push('unmount');
  });
}

/** All webglSupported() probes for; every other GL path is stubbed at Stage.mount. */
export function stubWebgl(available: boolean): void {
  vi.stubGlobal('document', {
    createElement: () => ({ getContext: () => (available ? { getExtension: () => null } : null) }),
  });
}

export function stubFetch(
  res: Partial<Response> = { ok: true, arrayBuffer: async () => new ArrayBuffer(8) },
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => res as Response),
  );
}

export function create(opts: Partial<KliegOptions> = {}) {
  // `target` is never read: Stage.mount is the only thing that appends to it.
  return createKlieg({ fonts: { display: '/f.ttf' }, clock, target: {} as HTMLElement, ...opts });
}

export function stage(): Stage {
  if (!mounted) throw new Error('the stage was never mounted');
  return mounted;
}

export function words(): THREE.Object3D[] {
  return stage().scene.children;
}

/** The first letter's cell — the group a pose is written onto, under the fit and inner groups. */
export function firstCell(): THREE.Group {
  const inner = (words()[0] as THREE.Group).children[0] as THREE.Group;
  return inner.children[0] as THREE.Group;
}

/** Stage.mount is stubbed, so the canvas the pointer is measured against has to stand in. */
export function stubCanvas(box: {
  left: number;
  top: number;
  width: number;
  height: number;
}): void {
  stage().canvas = {
    getBoundingClientRect: () => ({
      ...box,
      right: box.left + box.width,
      bottom: box.top + box.height,
    }),
  } as unknown as HTMLCanvasElement;
}

export function firstMesh(): THREE.Mesh {
  // A letter's meshes hang off the cell's scale node, which carries the run's size.
  return (firstCell().children[0] as THREE.Group).children[0] as THREE.Mesh;
}

/** Every material hanging off the fired word, a decoration's own included. */
export function wordMaterials(): THREE.MeshStandardMaterial[] {
  const out: THREE.MeshStandardMaterial[] = [];
  words()[0]?.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    if (!material) return;
    out.push(
      ...((Array.isArray(material) ? material : [material]) as THREE.MeshStandardMaterial[]),
    );
  });
  return out;
}

export function setup(): void {
  clock = new ManualClock();
  calls = [];
  mounted = null;
  renders = 0;
  peakWords = 0;
  onRender = () => {};
  renderer = {
    getDrawingBufferSize: (out: THREE.Vector2) => out.set(320, 240),
    getSize: (out: THREE.Vector2) => out.set(320, 240),
    getPixelRatio: () => 1,
    setRenderTarget: vi.fn(),
    setViewport: vi.fn(),
    setScissorTest: vi.fn(),
    clear: vi.fn(),
    render: vi.fn(() => {
      renders++;
      peakWords = Math.max(peakWords, words().length);
      onRender();
    }),
  } as unknown as THREE.WebGLRenderer;

  vi.mocked(parse).mockReturnValue(stubFont());
  stubFetch();
  stubWebgl(true);
  stubStage();
  stubListeners();
  stubIdle();
}

export function teardown(): void {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
}

/** Enter, active and exit all zero-length, so the effect finishes on its first tick. */
export const INSTANT = { enter: 'none', active: 'none', exit: 'none', hold: 0 } as const;
/** The same, but held long enough to tick under a pointer. */
export const LIT = { ...INSTANT, hold: 5000 } as const;
