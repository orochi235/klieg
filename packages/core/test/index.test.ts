import type { Font } from 'opentype.js';
import type * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Clock, ManualClock, type Tick } from '../src/clock.js';
import type { FrameCtx, PartInfo } from '../src/effects/types.js';
import {
  ACTIVE_NAMES,
  createKlieg,
  type EffectSpec,
  ENTER_NAMES,
  EXIT_NAMES,
  type FireOptions,
  type KliegOptions,
  LIGHTING_NAMES,
  LOOK_NAMES,
  type PhaseEvent,
  POLICY_NAMES,
  wantsBloom,
} from '../src/index.js';
import type { Vec3 } from '../src/pose.js';
import { BloomPath } from '../src/render/bloom.js';
import { type EnvPiece, sweep, track } from '../src/render/lighting.js';
import { BASE_Z, Stage } from '../src/render/stage.js';
import { Word } from '../src/render/word.js';
import { DEFAULT_GLYPH_OPTIONS } from '../src/text/glyphs.js';
import { fromEuler } from '../src/transform.js';

const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('opentype.js', () => ({ parse }));

const UPEM = 1000;
const ADVANCE = 600;
const TAU = Math.PI * 2;
/** Every letter is a 0.5 em box, so each one gets a real mesh. */
const BOX = (size: number) => [
  { type: 'M', x: 0, y: 0 },
  { type: 'L', x: 0.5 * size, y: 0 },
  { type: 'L', x: 0.5 * size, y: -0.7 * size },
  { type: 'Z' },
];

function stubFont(): Font {
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

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type Listener = (e: unknown) => void;
let listeners: Map<string, Listener[]>;

let idleCallbacks: (() => void)[];

/** The warm rides a real requestIdleCallback in a browser; here it only runs when driven. */
function stubIdle(): void {
  idleCallbacks = [];
  vi.stubGlobal('requestIdleCallback', (fn: () => void) => idleCallbacks.push(fn));
  vi.stubGlobal('cancelIdleCallback', () => {});
}

async function runIdle(): Promise<void> {
  for (const fn of idleCallbacks.splice(0)) fn();
  await flush();
  await flush();
}

/** node has no window event target, and every effect attaches a pointermove listener. */
function stubListeners(): void {
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

const dispatch = (type: string, e: unknown = {}) => {
  for (const fn of [...(listeners.get(type) ?? [])]) fn(e);
};

/** Ignores unsubscribe, so a tick still reaches an effect that has already settled. */
class LeakyClock implements Clock {
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

let clock: ManualClock;
let calls: string[];
let mounted: Stage | null;
let renderer: THREE.WebGLRenderer;
let renders: number;
let peakWords: number;
/** Hook for the one test that needs a tick to blow up the way a lost context does. */
let onRender: () => void;

function stubStage(): void {
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
function stubWebgl(available: boolean): void {
  vi.stubGlobal('document', {
    createElement: () => ({ getContext: () => (available ? { getExtension: () => null } : null) }),
  });
}

function stubFetch(
  res: Partial<Response> = { ok: true, arrayBuffer: async () => new ArrayBuffer(8) },
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => res as Response),
  );
}

function create(opts: Partial<KliegOptions> = {}) {
  // `target` is never read: Stage.mount is the only thing that appends to it.
  return createKlieg({ fonts: { display: '/f.ttf' }, clock, target: {} as HTMLElement, ...opts });
}

function stage(): Stage {
  if (!mounted) throw new Error('the stage was never mounted');
  return mounted;
}

function words(): THREE.Object3D[] {
  return stage().scene.children;
}

/** The first letter's cell — the group a pose is written onto, under the fit and inner groups. */
function firstCell(): THREE.Group {
  const inner = (words()[0] as THREE.Group).children[0] as THREE.Group;
  return inner.children[0] as THREE.Group;
}

/** Stage.mount is stubbed, so the canvas the pointer is measured against has to stand in. */
function stubCanvas(box: { left: number; top: number; width: number; height: number }): void {
  stage().canvas = {
    getBoundingClientRect: () => ({
      ...box,
      right: box.left + box.width,
      bottom: box.top + box.height,
    }),
  } as unknown as HTMLCanvasElement;
}

function firstMesh(): THREE.Mesh {
  // A letter's meshes hang off the cell's scale node, which carries the run's size.
  return (firstCell().children[0] as THREE.Group).children[0] as THREE.Mesh;
}

/** Every material hanging off the fired word, a decoration's own included. */
function wordMaterials(): THREE.MeshStandardMaterial[] {
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

beforeEach(() => {
  clock = new ManualClock();
  calls = [];
  mounted = null;
  renders = 0;
  peakWords = 0;
  onRender = () => {};
  renderer = {
    getDrawingBufferSize: (out: THREE.Vector2) => out.set(320, 240),
    getSize: (out: THREE.Vector2) => out.set(320, 240),
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

  parse.mockReturnValue(stubFont());
  stubFetch();
  stubWebgl(true);
  stubStage();
  stubListeners();
  stubIdle();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Enter, active and exit all zero-length, so the effect finishes on its first tick. */
const INSTANT = { enter: 'none', active: 'none', exit: 'none', hold: 0 } as const;
/** The same, but held long enough to tick under a pointer. */
const LIT = { ...INSTANT, hold: 5000 } as const;

describe('createKlieg', () => {
  it('mounts, renders and tears the word down when the timeline finishes', async () => {
    const bk = create();
    expect(bk.supported).toBe(true);

    const done = bk.fire('HI', INSTANT);
    await flush();
    clock.advance(16);
    await done;

    expect(calls).toEqual(['mount', 'idle']);
    expect(renders).toBe(1);
    expect(words()).toHaveLength(0);
  });

  it('gives two fires of the same text one geometry rather than two', async () => {
    const bk = create();
    const first = bk.fire('AA', INSTANT);
    await flush();
    const geo = firstMesh().geometry;
    clock.advance(16);
    await first;

    bk.fire('AA', INSTANT);
    await flush();

    expect(firstMesh().geometry).toBe(geo);
  });

  it('holds that geometry until the instance is destroyed', async () => {
    const bk = create();
    const done = bk.fire('AA', INSTANT);
    await flush();
    const spy = vi.spyOn(firstMesh().geometry, 'dispose');
    clock.advance(16);
    await done;
    expect(spy).not.toHaveBeenCalled();

    bk.destroy();
    await flush();

    expect(spy).toHaveBeenCalled();
  });

  it('reports unsupported and touches neither the stage nor the font', async () => {
    stubWebgl(false);
    const bk = create();

    expect(bk.supported).toBe(false);
    await bk.fire('HELLO');

    expect(calls).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('constructs and degrades with no document at all', async () => {
    // Not stubWebgl(false): that leaves a document in place, which is the one thing an SSR
    // render does not have, and `supported` exists to survive.
    vi.unstubAllGlobals();
    const bk = createKlieg({ fonts: { display: '/f.ttf' }, clock });

    expect(bk.supported).toBe(false);
    await bk.fire('HELLO');

    expect(calls).toEqual([]);
  });

  it('ignores fire after destroy', async () => {
    const bk = create();
    bk.destroy();

    await bk.fire('HELLO');
    await flush();

    expect(calls).toEqual(['unmount']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('tears the running effect down on abort rather than on the next tick', async () => {
    const bk = create();
    const done = bk.fire('HELLO', { hold: 5000 });
    await flush();
    clock.advance(16);
    expect(calls).toEqual(['mount']);

    bk.destroy();
    await done;
    await flush();

    // No further advance: a hidden tab stops ticking, and destroy() cannot wait for one.
    expect(calls).toEqual(['mount', 'idle', 'unmount']);
    expect(words()).toHaveLength(0);
  });

  it('ignores a tick that arrives after the effect has settled', async () => {
    const leaky = new LeakyClock();
    const bk = create({ clock: leaky });
    const done = bk.fire('HELLO', { hold: 5000 });
    await flush();
    leaky.advance(16);

    bk.destroy();
    await done;
    await flush();
    expect(calls).toEqual(['mount', 'idle', 'unmount']);

    leaky.advance(16);
    expect(calls).toEqual(['mount', 'idle', 'unmount']);
    expect(renders).toBe(1);
  });

  it('unmounts only once a cancelled effect has settled', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await gate;
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response;
      }),
    );

    const bk = create();
    const done = bk.fire('HELLO', INSTANT).then(() => calls.push('settled'));
    await flush();
    bk.destroy();
    await flush();
    expect(calls).toEqual([]);

    release();
    await done;
    await flush();
    expect(calls).toEqual(['settled', 'unmount']);
  });

  it('rejects the effect and comes down when a tick throws', async () => {
    const bk = create();
    onRender = () => {
      throw new Error('context lost');
    };
    const done = bk.fire('HI', INSTANT);
    await flush();
    clock.advance(16);

    await expect(done).rejects.toThrow('context lost');
    expect(calls).toEqual(['mount', 'idle']);
    expect(words()).toHaveLength(0);

    // The subscriber is gone, so the throw does not repeat every frame.
    clock.advance(16);
    expect(renders).toBe(1);

    bk.destroy();
    await flush();
    expect(calls).toEqual(['mount', 'idle', 'unmount']);
  });

  it('passes the queue policy through', async () => {
    const bk = create({ policy: 'replace' });
    const first = bk.fire('A', INSTANT);
    const second = bk.fire('B', INSTANT);

    await flush();
    clock.advance(16);
    await first;
    await flush();
    clock.advance(16);
    await second;

    // Under the default `queue` policy both words would play, in turn.
    expect(calls).toEqual(['mount', 'idle']);
    expect(renders).toBe(1);
  });

  it('runs queued effects one at a time', async () => {
    const bk = create();
    const a = bk.fire('A', { ...INSTANT, hold: 32 });
    const b = bk.fire('B', INSTANT);

    await flush();
    clock.advance(32);
    await a;
    await flush();
    clock.advance(16);
    await b;

    expect(calls).toEqual(['mount', 'idle', 'mount', 'idle']);
    expect(peakWords).toBe(1);
  });

  it('surfaces a font failure and still loads the font on the next fire', async () => {
    stubFetch({ ok: false, status: 404 });
    const bk = create();

    await expect(bk.fire('HI', INSTANT)).rejects.toThrow('klieg: failed to load font');

    stubFetch();
    const done = bk.fire('HI', INSTANT);
    await flush();
    clock.advance(16);
    await done;

    expect(calls).toEqual(['mount', 'idle']);
  });

  it('holds the pose the enter settles into under reduced motion', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const bk = create();
    const done = bk.fire('HI', { enter: 'slam', active: 'none', exit: 'fade', hold: 100 });

    await flush();
    clock.advance(16);
    const cell = firstCell();
    const material = firstMesh().material as THREE.MeshPhysicalMaterial;

    // The end of the exit would leave a faded-out word on screen for the whole hold.
    expect(material.opacity).toBeCloseTo(1, 6);
    expect(cell.position.z).toBeCloseTo(0, 6);
    expect(cell.scale.x).toBeCloseTo(1, 6);

    clock.advance(100);
    await done;
    expect(calls).toEqual(['mount', 'idle']);
  });

  it('turns the environment once per sweep pass, on its own period', async () => {
    const bk = create();
    const done = bk.fire('HI', { ...INSTANT, hold: 3400 });

    await flush();
    clock.advance(850);
    expect(stage().scene.environmentRotation.y).toBeCloseTo(TAU / 4, 6);

    clock.advance(2550);
    await done;
  });

  it('keeps the sweep period off the active slot, which used to stretch it', async () => {
    const bk = create();
    // float runs 5200ms. Under the old wiring its duration became the sweep's period.
    const done = bk.fire('HI', { ...INSTANT, active: 'float', hold: 850 });

    await flush();
    clock.advance(850);
    expect(stage().scene.environmentRotation.y).toBeCloseTo(TAU / 4, 6);

    await done;
  });

  it('restarts the sweep per effect and holds the environment still for static', async () => {
    const bk = create();
    const first = bk.fire('HI', { ...INSTANT, hold: 1700 });
    await flush();
    clock.advance(1700);
    await first;

    const second = bk.fire('HI', { ...INSTANT, hold: 16 });
    await flush();
    clock.advance(16);
    // Absolute clock time would land near TAU / 2 here, wherever the last effect left off.
    expect(stage().scene.environmentRotation.y).toBeCloseTo((16 / 3400) * TAU, 6);
    await second;

    const third = bk.fire('HI', { ...INSTANT, lighting: 'static' });
    await flush();
    clock.advance(16);
    await third;
    expect(stage().scene.environmentRotation.y).toBe(0);
  });

  describe('bloom', () => {
    /** Real disposal, stubbed drawing: the constructor allocates the targets either way. */
    function stubBloom(render = true) {
      const spies = {
        render: vi.spyOn(BloomPath.prototype, 'render'),
        dispose: vi.spyOn(BloomPath.prototype, 'dispose'),
      };
      if (render) spies.render.mockImplementation(() => {});
      return spies;
    }

    it('renders through the bloom path instead of straight to the canvas', async () => {
      const bloom = stubBloom();
      const bk = create();
      const done = bk.fire('HI', { ...INSTANT, bloom: true });

      await flush();
      clock.advance(16);
      await done;

      expect(bloom.render).toHaveBeenCalledTimes(1);
      expect(bloom.render).toHaveBeenCalledWith(stage().scene, stage().camera);
      expect(renders).toBe(0);
      expect(bloom.dispose).toHaveBeenCalledTimes(1);
    });

    it('builds nothing when bloom is off', async () => {
      const bloom = stubBloom();
      const bk = create();
      const done = bk.fire('HI', INSTANT);

      await flush();
      clock.advance(16);
      await done;

      expect(bloom.render).not.toHaveBeenCalled();
      expect(bloom.dispose).not.toHaveBeenCalled();
      expect(renders).toBe(1);
    });

    it('disposes the bloom path when the effect is aborted', async () => {
      const bloom = stubBloom();
      const bk = create();
      const done = bk.fire('HI', { bloom: true, hold: 5000 });

      await flush();
      clock.advance(16);
      bk.destroy();
      await done;

      expect(bloom.render).toHaveBeenCalledTimes(1);
      expect(bloom.dispose).toHaveBeenCalledTimes(1);
    });

    it('disposes the bloom path when the word fails to build', async () => {
      const bloom = stubBloom();
      parse.mockReturnValue({
        ...stubFont(),
        charToGlyph: () => {
          throw new Error('bad glyph');
        },
      } as unknown as Font);
      const bk = create();

      // The rejection comes out before the promise that owns settle() exists.
      await expect(bk.fire('HI', { ...INSTANT, bloom: true })).rejects.toThrow('bad glyph');
      expect(bloom.dispose).toHaveBeenCalledTimes(1);
    });

    it('disposes the bloom path when a tick throws', async () => {
      const bloom = stubBloom(false);
      onRender = () => {
        throw new Error('context lost');
      };
      const bk = create();
      const done = bk.fire('HI', { ...INSTANT, bloom: true });

      await flush();
      clock.advance(16);

      await expect(done).rejects.toThrow('context lost');
      // The throw came out of the scene pass, so the composite never ran and the targets are live.
      expect(bloom.dispose).toHaveBeenCalledTimes(1);
    });
  });

  describe('stages', () => {
    it('plays a stage list and resolves once the whole thing has played', async () => {
      const bk = create();
      const done = bk.fire('NA\nEB', {
        enter: 'none',
        exit: 'none',
        hold: 10,
        stages: [{ keep: (l) => l.column === 0, exit: 'fade', as: 'line', hold: 10 }],
      });
      await flush();
      clock.advance(16);

      // The stage has regrouped, but the letters it dropped are still playing their exit.
      const cells = firstCell().parent?.children ?? [];
      expect(cells.filter((c) => c.visible)).toHaveLength(4);

      for (let t = 0; t < 60; t++) clock.advance(50);

      expect(cells.filter((c) => c.visible)).toHaveLength(2);
      expect(words()).toHaveLength(0);
      await expect(done).resolves.toBeUndefined();
    });

    it('lays the survivors out in the arrangement the stage asks for', async () => {
      const bk = create();
      const done = bk.fire('NA\nEB', {
        enter: 'none',
        active: 'none',
        exit: 'none',
        hold: 0,
        stages: [{ keep: (l) => l.column === 0, exit: 'none', as: 'stack', hold: 1000 }],
      });
      await flush();
      // Past the move, so the survivors have landed in the layout the stage asked for.
      for (let t = 0; t < 10; t++) clock.advance(100);

      const [n, , e] = (firstCell().parent?.children ?? []) as THREE.Group[];
      expect(n?.position.x).toBeCloseTo(e?.position.x as number, 6);
      expect((n?.position.y as number) - (e?.position.y as number)).toBeCloseTo(1.1, 6);

      bk.destroy();
      await done;
    });

    it('drops the letters that leave on the exit the stage names', async () => {
      const bk = create();
      const done = bk.fire('NA\nEB', {
        enter: 'none',
        active: 'none',
        exit: 'none',
        hold: 0,
        stages: [{ keep: (l) => l.column === 0, exit: 'drop', hold: 1000 }],
      });
      await flush();
      clock.advance(16);
      // Halfway through `drop`, which falls 22 em under a squared curve.
      clock.advance(334);

      const cells = (firstCell().parent?.children ?? []) as THREE.Group[];
      expect(cells[1]?.position.y).toBeLessThan(-4);
      expect(cells[0]?.position.y).toBeCloseTo(0, 6);

      bk.destroy();
      await done;
    });

    it('regroups the survivors into the word they spell', async () => {
      const bk = create();
      const done = bk.fire('NA\nEB', {
        enter: 'none',
        exit: 'none',
        hold: 10,
        stages: [{ keep: (l) => l.column === 0, exit: 'fade', as: 'line', hold: 1000 }],
      });
      await flush();
      // Past the stage boundary and its move, so the dropped letters have been retired.
      for (let t = 0; t < 20; t++) clock.advance(50);

      const cells = firstCell().parent?.children ?? [];
      expect(cells.filter((c) => c.visible)).toHaveLength(2);

      for (let t = 0; t < 60; t++) clock.advance(50);
      await done;
    });

    it('skips the stages under reduced motion, which never travels', async () => {
      vi.stubGlobal('matchMedia', () => ({ matches: true }));
      const bk = create();
      const done = bk.fire('NA\nEB', {
        enter: 'none',
        exit: 'none',
        hold: 100,
        // A stage held on 'click' would never advance from a pose that does not move.
        stages: [{ keep: (l) => l.column === 0, hold: 'click' }],
      });
      await flush();
      clock.advance(16);

      const cells = firstCell().parent?.children ?? [];
      expect(cells.filter((c) => c.visible)).toHaveLength(4);

      clock.advance(100);
      await expect(done).resolves.toBeUndefined();
    });

    it('plays the top-level active while the opening phase holds', async () => {
      const lift = { duration: 1000, offset: () => ({ position: [0, 1, 0] as Vec3 }) };

      const bk = create();
      void bk.fire('AB', {
        enter: 'none',
        active: lift,
        exit: 'none',
        hold: 1000,
        blendMs: 0,
        stages: [{ keep: (l) => l.index === 0, exit: 'none', hold: 10 }],
      });
      await flush();
      clock.advance(500);

      expect(firstCell().position.y).toBeCloseTo(1, 6);
    });

    it('leaves an effect with no stages behaving exactly as before', async () => {
      const bk = create();
      const done = bk.fire('NA\nEB', { enter: 'none', active: 'none', exit: 'none', hold: 100 });
      await flush();
      clock.advance(16);
      const cells = (firstCell().parent?.children ?? []) as THREE.Group[];
      const laidOut = cells.map((c) => [c.position.x, c.position.y]);

      clock.advance(50);
      // Nothing regroups, so every letter is still where the two-line block put it.
      expect(cells.map((c) => [c.position.x, c.position.y])).toEqual(laidOut);
      expect(cells.filter((c) => c.visible)).toHaveLength(4);

      clock.advance(50);
      expect(words()).toHaveLength(0);
      await expect(done).resolves.toBeUndefined();
    });
  });

  it('never settles a forever hold, and settles it on destroy', async () => {
    const bk = create();
    let done = false;
    const fired = bk.fire('HI', { ...INSTANT, exit: 'fade', hold: 'forever' }).then(() => {
      done = true;
    });
    await flush();

    clock.advance(60 * 60 * 1000);
    await flush();
    expect(done).toBe(false);
    expect(words()).toHaveLength(1);
    // A `forever` hold that reached `Timeline` as a string poses every letter at NaN, which
    // reads as "never finished" for entirely the wrong reason.
    const cell = firstCell();
    expect(Number.isFinite(cell.position.y)).toBe(true);
    expect(Number.isFinite(cell.scale.x)).toBe(true);

    bk.destroy();
    await fired;
    expect(done).toBe(true);
    expect(words()).toHaveLength(0);
  });

  it('holds forever under reduced motion too', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const bk = create();
    let done = false;
    // Under `still`, `elapsed` is pinned to the enter's own duration — INSTANT's zero-length
    // enter would never let a corrupt `hold` reach the pose math at all.
    const fired = bk.fire('HI', { ...INSTANT, enter: 'slam', hold: 'forever' }).then(() => {
      done = true;
    });
    await flush();

    clock.advance(60 * 60 * 1000);
    await flush();
    expect(done).toBe(false);
    expect(words()).toHaveLength(1);
    const cell = firstCell();
    expect(Number.isFinite(cell.position.y)).toBe(true);
    expect(Number.isFinite(cell.scale.x)).toBe(true);

    bk.destroy();
    await fired;
    expect(done).toBe(true);
    expect(words()).toHaveLength(0);
  });
});

describe('holding until dismissed', () => {
  const attached = () =>
    (listeners.get('pointerdown')?.length ?? 0) + (listeners.get('keydown')?.length ?? 0);

  const HELD = { enter: 'none', active: 'none', exit: 'none', hold: 'click' } as const;

  it('stays on screen while a numeric hold would long since have ended', async () => {
    const bk = create();
    const done = bk.fire('HI', HELD);
    await flush();

    clock.advance(60_000);
    await flush();

    expect(words()).toHaveLength(1);
    expect(calls).toEqual(['mount']);

    dispatch('pointerdown');
    clock.advance(16);
    await done;

    expect(words()).toHaveLength(0);
  });

  it('dismisses on Escape as well, so a modal hold is not a keyboard trap', async () => {
    const bk = create();
    const done = bk.fire('HI', { ...HELD, modal: true });
    await flush();
    clock.advance(1000);

    dispatch('keydown', { key: 'Escape' });
    clock.advance(16);
    await done;

    expect(words()).toHaveLength(0);
  });

  it('ignores keys that are not Escape', async () => {
    const bk = create();
    void bk.fire('HI', HELD);
    await flush();
    clock.advance(1000);

    dispatch('keydown', { key: 'a' });
    clock.advance(16);
    await flush();

    expect(words()).toHaveLength(1);
  });

  it('makes the overlay swallow the click only when modal', async () => {
    const interactive = vi.spyOn(Stage.prototype, 'setInteractive').mockImplementation(() => {});

    const bk = create();
    const done = bk.fire('HI', { ...HELD, modal: true });
    await flush();

    expect(interactive).toHaveBeenCalledWith(true);

    dispatch('pointerdown');
    clock.advance(16);
    await done;

    expect(interactive).toHaveBeenLastCalledWith(false);
  });

  it('leaves the overlay click-through when not modal', async () => {
    const interactive = vi.spyOn(Stage.prototype, 'setInteractive').mockImplementation(() => {});

    const bk = create();
    const done = bk.fire('HI', HELD);
    await flush();

    expect(interactive).not.toHaveBeenCalledWith(true);

    dispatch('pointerdown');
    clock.advance(16);
    await done;
  });

  it('detaches its listeners once dismissed', async () => {
    const bk = create();
    const done = bk.fire('HI', HELD);
    await flush();

    expect(attached()).toBe(2);

    dispatch('pointerdown');
    clock.advance(16);
    await done;

    expect(attached()).toBe(0);
  });

  it('detaches its listeners when destroyed while still held', async () => {
    const bk = create();
    const done = bk.fire('HI', HELD);
    await flush();
    expect(attached()).toBe(2);

    bk.destroy();
    await done;

    expect(attached()).toBe(0);
  });

  it('advances one stage per press, ending the effect only on the last', async () => {
    const bk = create();
    const done = bk.fire('NA\nEB', {
      ...HELD,
      stages: [{ keep: (l) => l.column === 0, exit: 'none', hold: 'click' }],
    });
    await flush();
    clock.advance(1000);

    dispatch('pointerdown');
    clock.advance(16);
    // Past the stage's move, so the survivors are in place and it is holding on its own.
    clock.advance(1000);
    await flush();

    // The first press only ended the opening hold, and must not have detached the listeners.
    expect(words()).toHaveLength(1);
    expect(attached()).toBe(2);

    dispatch('pointerdown');
    clock.advance(16);
    await done;

    expect(words()).toHaveLength(0);
    expect(attached()).toBe(0);
  });

  it('waits for the press a stage holds on, under a numeric top-level hold', async () => {
    const bk = create();
    const done = bk.fire('NA\nEB', {
      enter: 'none',
      active: 'none',
      exit: 'none',
      hold: 10,
      stages: [{ keep: (l) => l.column === 0, exit: 'none', hold: 'click' }],
    });
    await flush();
    clock.advance(60_000);
    await flush();

    // Nothing but a press ends that stage, so without listeners the effect never leaves the screen.
    expect(attached()).toBe(2);
    expect(words()).toHaveLength(1);

    dispatch('pointerdown');
    clock.advance(16);
    await done;

    expect(words()).toHaveLength(0);
  });

  it('a second press cannot cut the exit short', async () => {
    const bk = create();
    const done = bk.fire('HI', { enter: 'none', active: 'none', exit: 'fade', hold: 'click' });
    await flush();
    clock.advance(1000);

    dispatch('pointerdown');
    clock.advance(100);
    // The exit is underway; pressing again must not re-release at a later elapsed.
    dispatch('pointerdown');
    clock.advance(16);
    await flush();

    expect(words()).toHaveLength(1);

    clock.advance(500);
    await done;

    expect(words()).toHaveLength(0);
  });

  it('attaches no dismiss listener for a forever hold, and ignores a press regardless', async () => {
    const bk = create();
    const fired = bk.fire('HI', { ...INSTANT, hold: 'forever' });
    await flush();

    expect(attached()).toBe(0);

    dispatch('pointerdown');
    dispatch('keydown', { key: 'Escape' });
    clock.advance(16);
    await flush();

    expect(words()).toHaveLength(1);

    bk.destroy();
    await fired;
  });

  it('refuses stages under a forever hold, which would never advance past the opening phase', () => {
    const bk = create();

    expect(() => bk.fire('HI', { hold: 'forever', stages: [{ hold: 'click' }] })).toThrow(
      /never advances a stage/,
    );
  });
});

describe('driving an effect from the host', () => {
  const HELD = { enter: 'none', active: 'none', exit: 'none', hold: 'click' } as const;

  it('advances a hold from the handle, whoever owns the listeners', async () => {
    const bk = create();
    const done = bk.fire('HI', HELD);
    await flush();
    clock.advance(1000);
    expect(words()).toHaveLength(1);

    done.advance();
    clock.advance(16);
    await done;

    expect(words()).toHaveLength(0);
  });

  it('spends an advance that arrived before the effect did on its first hold', async () => {
    const bk = create();
    const first = bk.fire('ONE', HELD);
    const second = bk.fire('TWO', HELD);
    await flush();

    // Queued behind a held effect: there is no hold yet for this press to release.
    second.advance();

    dispatch('pointerdown');
    clock.advance(16);
    await first;
    await flush();

    clock.advance(16);
    await second;
    expect(words()).toHaveLength(0);
  });

  it('leaves the handle inert rather than absent on an unsupported instance', async () => {
    stubWebgl(false);
    const bk = create();

    const done = bk.fire('HI', HELD);
    expect(() => done.advance()).not.toThrow();
    await expect(done).resolves.toBeUndefined();
  });

  it('reports active when the enter has run its length, and exit when the hold is over', async () => {
    const seen: PhaseEvent[] = [];
    const bk = create();
    const done = bk.fire('HI', {
      enter: { duration: 100, offset: () => ({}) },
      active: 'none',
      exit: 'none',
      hold: 50,
      blendMs: 0,
      onPhase: (e) => seen.push(e),
    });
    await flush();

    clock.advance(50);
    expect(seen).toEqual([]);

    clock.advance(60);
    expect(seen).toEqual([{ phase: 'active' }]);

    clock.advance(100);
    await done;
    expect(seen).toEqual([{ phase: 'active' }, { phase: 'exit' }]);
  });

  it('reports exit only once a click hold is released, which no fire-time schedule can know', async () => {
    const seen: PhaseEvent[] = [];
    const bk = create();
    const done = bk.fire('HI', { ...HELD, onPhase: (e) => seen.push(e) });
    await flush();

    clock.advance(60_000);
    expect(seen).toEqual([{ phase: 'active' }]);

    dispatch('pointerdown');
    clock.advance(16);
    await done;

    expect(seen).toEqual([{ phase: 'active' }, { phase: 'exit' }]);
  });

  it('reports every stage a long frame crosses, not just the last', async () => {
    const seen: PhaseEvent[] = [];
    const bk = create();
    const done = bk.fire('ABCD', {
      enter: 'none',
      active: 'none',
      exit: 'none',
      hold: 0,
      blendMs: 0,
      stages: [
        { keep: (l) => l.index < 3, exit: 'none', hold: 0, tween: { duration: 10 } },
        { keep: (l) => l.index < 2, exit: 'none', hold: 0, tween: { duration: 10 } },
        { keep: (l) => l.index < 1, exit: 'none', hold: 0, tween: { duration: 10 } },
      ],
      onPhase: (e) => seen.push(e),
    });
    await flush();

    // One frame, long enough to cross all three boundaries at once.
    clock.advance(10_000);
    await done;

    // Filtered because a single frame this long collapses the timed boundaries against the stage
    // ones; their relative order is not what this test is about.
    expect(seen.filter((e) => e.phase === 'stage')).toEqual([
      { phase: 'stage', index: 0 },
      { phase: 'stage', index: 1 },
      { phase: 'stage', index: 2 },
    ]);
  });

  it('reports both phases under reduced motion, which holds the pose without travelling', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const seen: PhaseEvent[] = [];
    const bk = create();
    const done = bk.fire('HI', {
      enter: { duration: 400, offset: () => ({}) },
      active: 'none',
      exit: { duration: 300, offset: () => ({}) },
      hold: 100,
      onPhase: (e) => seen.push(e),
    });
    await flush();

    clock.advance(16);
    expect(seen).toEqual([{ phase: 'active' }]);

    clock.advance(100);
    await done;
    expect(seen).toEqual([{ phase: 'active' }, { phase: 'exit' }]);
  });

  it('fires no phase event on an unsupported instance, which renders nothing', async () => {
    stubWebgl(false);
    const seen: PhaseEvent[] = [];
    const bk = create();

    await bk.fire('HI', { onPhase: (e) => seen.push(e) });

    expect(seen).toEqual([]);
  });

  it("attaches no window listeners under dismiss: 'host'", async () => {
    const bk = create();
    const done = bk.fire('HI', { ...HELD, dismiss: 'host' });
    await flush();
    clock.advance(1000);

    expect(listeners.get('pointerdown') ?? []).toHaveLength(0);
    expect(listeners.get('keydown') ?? []).toHaveLength(0);

    // The presses klieg would have caught reach nothing at all.
    dispatch('pointerdown');
    dispatch('keydown', { key: 'Escape' });
    clock.advance(16);
    await flush();
    expect(words()).toHaveLength(1);

    done.advance();
    clock.advance(16);
    await done;
    expect(words()).toHaveLength(0);
  });

  it('still lets a modal hold swallow presses when the host owns the dismissal', async () => {
    const interactive = vi.spyOn(Stage.prototype, 'setInteractive').mockImplementation(() => {});

    const bk = create();
    const done = bk.fire('HI', { ...HELD, dismiss: 'host', modal: true });
    await flush();
    clock.advance(16);

    expect(interactive).toHaveBeenCalledWith(true);

    done.advance();
    clock.advance(16);
    await done;
    expect(interactive).toHaveBeenLastCalledWith(false);
  });

  it('aborts one running effect on its own signal and leaves the instance alive', async () => {
    const ctrl = new AbortController();
    const bk = create();
    const done = bk.fire('HI', {
      enter: 'none',
      active: 'none',
      exit: { duration: 500, offset: () => ({ opacity: 0 }) },
      hold: 5000,
      signal: ctrl.signal,
    });
    await flush();
    clock.advance(16);
    expect(words()).toHaveLength(1);

    // No exit plays: the abort resolves the fire rather than rejecting it.
    ctrl.abort();
    await expect(done).resolves.toBeUndefined();
    expect(words()).toHaveLength(0);

    const next = bk.fire('AGAIN', INSTANT);
    await flush();
    clock.advance(16);
    await expect(next).resolves.toBeUndefined();
  });

  it('drops a queued effect on its own signal, so it never mounts a word', async () => {
    const ctrl = new AbortController();
    const bk = create();
    const first = bk.fire('ONE', HELD);
    const second = bk.fire('TWO', { ...INSTANT, signal: ctrl.signal });
    await flush();
    clock.advance(16);
    expect(peakWords).toBe(1);

    ctrl.abort();
    await expect(second).resolves.toBeUndefined();

    dispatch('pointerdown');
    clock.advance(16);
    await first;

    expect(peakWords).toBe(1);
  });

  it('keeps rendering when onPhase throws, and hands the error to the microtask queue', async () => {
    const queued: (() => void)[] = [];
    vi.stubGlobal('queueMicrotask', (fn: () => void) => queued.push(fn));

    const bk = create();
    const done = bk.fire('HI', {
      enter: 'none',
      active: 'none',
      exit: 'none',
      hold: 50,
      onPhase: () => {
        throw new Error('host');
      },
    });
    await flush();

    clock.advance(16);
    clock.advance(100);
    await expect(done).resolves.toBeUndefined();

    expect(queued).toHaveLength(2);
    expect(queued[0]).toThrow('host');
    expect(words()).toHaveLength(0);
  });
});

describe('published name lists', () => {
  // Literal rather than derived: the arrays are already exhaustive by construction, so what is
  // left to pin is the order a picker shows and the fact that dropping one is a breaking change.
  it('lists every name a consumer can fire with, motion-first', () => {
    expect(ENTER_NAMES).toEqual(['slam', 'spin', 'flip', 'assemble', 'rise', 'none']);
    expect(ACTIVE_NAMES).toEqual(['float', 'pulse', 'shimmer', 'none']);
    expect(LIGHTING_NAMES).toEqual(['sweep', 'static', 'pointer']);
    expect(EXIT_NAMES).toEqual(['shatter', 'drop', 'recede', 'fade', 'none']);
    expect(LOOK_NAMES).toEqual([
      'gold',
      'chrome',
      'oil',
      'gem',
      'velvet',
      'neon',
      'flake',
      'glitter',
      'leather',
      'tubing',
      'piping',
      'sequin',
    ]);
    expect(POLICY_NAMES).toEqual(['queue', 'replace', 'concurrent']);
  });
});

describe('wantsBloom', () => {
  it('turns bloom on for a look that asks for it', () => {
    expect(wantsBloom(undefined, 'neon')).toBe(true);
  });

  it('lets an explicit false override the look', () => {
    expect(wantsBloom(false, 'neon')).toBe(false);
  });

  it('lets an explicit true override a look that never asked', () => {
    expect(wantsBloom(true, 'gold')).toBe(true);
  });

  it('stays off by default', () => {
    expect(wantsBloom(undefined, 'gold')).toBe(false);
  });
});

describe('caller-supplied looks', () => {
  it('fires with a spec in place of a name', async () => {
    const bk = create();
    const done = bk.fire('HI', {
      look: { metalness: 1, roughness: 0.3, color: 0x00e5ff },
      enter: 'none',
      active: 'none',
      exit: 'none',
      hold: 0,
    });
    await flush();
    clock.advance(10);
    await expect(done).resolves.toBeUndefined();
  });
});

describe('caller-supplied effects', () => {
  /** A body-wide gain, so the emissive the frame lands on says which list was used. */
  const gain = (g: number) =>
    ({
      piece: { duration: 1000, at: () => ({ gain: g }) },
      target: { kind: 'body', by: 'index', amount: 1 },
    }) as const;

  it('replaces the look own list rather than adding to it', async () => {
    const bk = create();
    void bk.fire('HI', {
      ...INSTANT,
      hold: 4000,
      look: { emissive: 0xff2d95, emissiveIntensity: 4, effects: [gain(0.5)] },
      effects: [gain(0.25)],
    });
    await flush();
    clock.advance(16);

    // 4 x 0.25. The look's own 0.5 layered on top would read 0.5, and ignoring the caller 2.
    expect((firstMesh().material as THREE.MeshPhysicalMaterial).emissiveIntensity).toBeCloseTo(
      1,
      6,
    );
    bk.destroy();
  });
});

describe('caller-supplied transform', () => {
  it('turns the word as one rigid object, never the camera', async () => {
    const bk = create();
    const done = bk.fire('HI', { ...INSTANT, transform: fromEuler(0, Math.PI / 6, 0) });
    await flush();

    const inner = (words()[0] as THREE.Group).children[0] as THREE.Group;
    expect(inner.rotation.y).toBeCloseTo(Math.PI / 6, 6);
    expect(stage().camera.rotation.y).toBe(0);

    clock.advance(16);
    await done;
  });

  it('defaults to no turn when transform is not given', async () => {
    const bk = create();
    const done = bk.fire('HI', INSTANT);
    await flush();

    const inner = (words()[0] as THREE.Group).children[0] as THREE.Group;
    expect(inner.rotation.y).toBe(0);

    clock.advance(16);
    await done;
  });
});

describe('framing', () => {
  /** The fit lives on the word group's scale, so a wider budget reads straight off it. */
  async function fitScaleOf(text: string, framing?: { width?: number; height?: number }) {
    const bk = create(framing ? { framing } : {});
    const done = bk.fire(text, INSTANT);
    await flush();
    const scale = (words()[0] as THREE.Group).scale.x;
    clock.advance(16);
    await done;
    return scale;
  }

  it('fits exactly as the built-in framing does when the caller says nothing', async () => {
    const omitted = await fitScaleOf('HELLOTHERE');

    expect(await fitScaleOf('HELLOTHERE', { width: 0.62, height: 0.3 })).toBe(omitted);
    expect(await fitScaleOf('HELLOTHERE', {})).toBe(omitted);
  });

  it('grows the word in proportion to the width it is given', async () => {
    const wide = await fitScaleOf('HELLOTHERE', { width: 1 });

    expect(wide).toBeCloseTo((await fitScaleOf('HELLOTHERE')) / 0.62, 6);
  });

  it('leaves the other axis on its default', async () => {
    // Four lines make height the binding axis, so a width the caller widened cannot move the fit.
    const tall = 'HI\nHI\nHI\nHI';

    expect(await fitScaleOf(tall, { width: 1 })).toBe(await fitScaleOf(tall));
    expect(await fitScaleOf(tall, { height: 0.6 })).toBeCloseTo((await fitScaleOf(tall)) * 2, 6);
  });

  /** Leftmost and rightmost painted world x over every letter, bevel and all. */
  function paintedSpan(group: THREE.Group): { left: number; right: number } {
    group.updateMatrixWorld(true);
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    group.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.computeBoundingBox();
      const box = (mesh.geometry.boundingBox as THREE.Box3).clone().applyMatrix4(mesh.matrixWorld);
      left = Math.min(left, box.min.x);
      right = Math.max(right, box.max.x);
    });
    return { left, right };
  }

  /** Where the word ended up, and how big, after one instant fire. */
  async function placeOf(
    text: string,
    framing?: KliegOptions['framing'],
    over: Partial<KliegOptions> = {},
  ) {
    const bk = create({ ...(framing ? { framing } : {}), ...over });
    const done = bk.fire(text, INSTANT);
    await flush();
    const group = words()[0] as THREE.Group;
    const at = { x: group.position.x, scale: group.scale.x, ...paintedSpan(group) };
    clock.advance(16);
    await done;
    return at;
  }

  /** Half the frustum width at the word's depth; the stage is stubbed, so the aspect is 1. */
  const HALF_BOX = (2 * Math.tan((38 * Math.PI) / 360) * BASE_Z) / 2;
  /** The box's own edge, as the angle it subtends — the same at every depth. */
  const BOX_EDGE = HALF_BOX / BASE_Z;

  /**
   * Where a painted edge lands on the box's, as the angle it subtends. Measured at the near cap,
   * which is the silhouette the viewer sees and the first thing an anchored canvas would clip.
   */
  const edgeOf = (at: { scale: number; left?: number; right?: number }, x: number) =>
    x / (BASE_Z - DEFAULT_GLYPH_OPTIONS.depth * at.scale);

  it('centres the word when the caller says nothing', async () => {
    expect((await placeOf('HELLOTHERE')).x).toBe(0);
    expect((await placeOf('HELLOTHERE', { width: 0.62, height: 0.3 })).x).toBe(0);
  });

  it('puts the painted edge on the box edge without changing the size', async () => {
    const centred = await placeOf('HELLOTHERE');
    const started = await placeOf('HELLOTHERE', { align: 'start' });

    expect(started.scale).toBe(centred.scale);
    expect(edgeOf(started, started.left)).toBeCloseTo(-BOX_EDGE, 6);
  });

  it('aligns at the size the fractions chose, not at the width of the box', async () => {
    // The masthead case: width binds, so there is no slack, and alignment must work anyway.
    const narrow = await placeOf('HELLOTHERE', { width: 0.4, align: 'start' });
    const wide = await placeOf('HELLOTHERE', { width: 0.62, align: 'start' });

    expect(narrow.scale).toBeLessThan(wide.scale);
    expect(edgeOf(narrow, narrow.left)).toBeCloseTo(-BOX_EDGE, 6);
    expect(edgeOf(wide, wide.left)).toBeCloseTo(-BOX_EDGE, 6);
  });

  it('meets the anchor edge by default, where an overlay stays centred', async () => {
    const el = { clientWidth: 800, clientHeight: 120 } as HTMLElement;
    // `target` is refused alongside an element placement, which is its own parent.
    const anchored = await placeOf('HELLOTHERE', undefined, {
      placement: { kind: 'element', el },
      target: undefined,
    });

    expect(anchored.x).not.toBe(0);
    expect(edgeOf(anchored, anchored.left)).toBeCloseTo(-BOX_EDGE, 6);
    expect((await placeOf('HELLOTHERE')).x).toBe(0);
  });

  it('meets the right edge with the paint, not with the advance', async () => {
    const ended = await placeOf('HELLOTHERE', { align: 'end' });

    expect(edgeOf(ended, ended.right)).toBeCloseTo(BOX_EDGE, 6);
    // The last advance reaches 3 em past the word's centre; that edge overshoots the box.
    expect(edgeOf(ended, ended.x + 3 * ended.scale)).toBeGreaterThan(BOX_EDGE);
  });
});

describe('caller-supplied motion', () => {
  it('accepts a piece in place of a name', async () => {
    const seen: number[] = [];
    const mine = {
      duration: 100,
      offset: (t: number) => {
        seen.push(t);
        return { position: [0, 0, 0] as [number, number, number] };
      },
    };

    const bk = create();
    const done = bk.fire('HI', { enter: mine, active: 'none', exit: 'none', hold: 0 });
    await flush();
    clock.advance(50);
    clock.advance(60);
    await done;

    expect(seen.length).toBeGreaterThan(0);
  });

  it('layers several pieces in one slot', async () => {
    const lift = { duration: 100, offset: () => ({ position: [0, 1, 0] as Vec3 }) };
    const shift = { duration: 100, offset: () => ({ position: [2, 0, 0] as Vec3 }) };

    const bk = create();
    // blendMs 0: at the default the enter is already crossfading at t=50 and carries <1 weight.
    void bk.fire('HI', {
      enter: [lift, shift],
      active: 'none',
      exit: 'none',
      hold: 1000,
      blendMs: 0,
    });
    await flush();
    clock.advance(50);

    const cell = firstCell();
    expect(cell.position.y).toBeCloseTo(1, 6);
    // Layout x is baked into the cell, so the layer's contribution is the delta from rest.
    expect(cell.position.x).toBeGreaterThan(0);
  });
});

describe('the lighting slot', () => {
  const envY = () => stage().scene.environmentRotation.y;

  it('drives the environment from a caller-supplied piece', async () => {
    const tip: EnvPiece = { duration: 0, env: () => ({ yaw: 0.4, pitch: 0.2 }) };

    const bk = create();
    void bk.fire('HI', { ...LIT, lighting: tip });
    await flush();
    clock.advance(16);

    expect(envY()).toBeCloseTo(0.4, 6);
    expect(stage().scene.environmentRotation.x).toBeCloseTo(0.2, 6);
    bk.destroy();
  });

  it('turns the studio on the materials, which each carry their own copy of it', async () => {
    const tip: EnvPiece = { duration: 0, env: () => ({ yaw: 0.4, pitch: 0.2 }) };

    const bk = create();
    void bk.fire('HI', { ...LIT, look: 'tubing', lighting: tip });
    await flush();
    clock.advance(16);

    const materials = wordMaterials();
    expect(materials.length).toBeGreaterThan(0);
    for (const material of materials) {
      // `scene.environmentRotation` reaches only a material that falls back to `scene.environment`.
      expect(material.envMapRotation.y).toBeCloseTo(0.4, 6);
      expect(material.envMapRotation.x).toBeCloseTo(0.2, 6);
    }
    bk.destroy();
  });

  it('layers an array of names and pieces onto both axes at once', async () => {
    const tip: EnvPiece = { duration: 0, env: () => ({ pitch: 0.25 }) };

    const bk = create();
    void bk.fire('HI', { ...LIT, lighting: ['sweep', tip] });
    await flush();
    clock.advance(850);

    expect(envY()).toBeCloseTo(TAU / 4, 6);
    expect(stage().scene.environmentRotation.x).toBeCloseTo(0.25, 6);
    bk.destroy();
  });

  it('wraps a sweep that outlives its own period rather than winding on forever', async () => {
    const bk = create();
    void bk.fire('HI', { ...LIT, lighting: sweep({ periodMs: 1000 }) });
    await flush();
    clock.advance(2250);

    expect(envY()).toBeCloseTo(TAU / 4, 6);
    bk.destroy();
  });

  it('hands a piece that holds still a finite t rather than dividing by its zero duration', async () => {
    const seen: number[] = [];
    const held: EnvPiece = {
      duration: 0,
      env: (t) => {
        seen.push(t);
        return { yaw: t };
      },
    };

    const bk = create();
    void bk.fire('HI', { ...LIT, lighting: held });
    await flush();
    clock.advance(16);

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Number.isFinite)).toBe(true);
    expect(envY()).toBe(0);
    bk.destroy();
  });

  it('measures the pointer against the canvas box, not the viewport', async () => {
    const bk = create();
    void bk.fire('HI', { ...LIT, lighting: track({ yawRange: 1, followMs: 0 }) });
    await flush();
    stubCanvas({ left: 0, top: 0, width: 100, height: 100 });
    dispatch('pointermove', { clientX: 75, clientY: 50 });
    clock.advance(16);

    expect(envY()).toBeCloseTo(0.5, 6);

    // The same client position against a box that has moved must read somewhere else entirely.
    stubCanvas({ left: 50, top: 0, width: 100, height: 100 });
    clock.advance(16);

    expect(envY()).toBeCloseTo(-0.5, 6);
    bk.destroy();
  });

  it('clamps a pointer outside the canvas box into the range it promises', async () => {
    const bk = create();
    void bk.fire('HI', { ...LIT, lighting: track({ yawRange: 1, pitchRange: 1, followMs: 0 }) });
    await flush();
    stubCanvas({ left: 0, top: 0, width: 100, height: 100 });
    dispatch('pointermove', { clientX: 900, clientY: -400 });
    clock.advance(16);

    expect(envY()).toBeCloseTo(1, 6);
    expect(stage().scene.environmentRotation.x).toBeCloseTo(-1, 6);
    bk.destroy();
  });

  it('resolves a name once per run, so the follow keeps closing on the pointer', async () => {
    const bk = create();
    void bk.fire('HI', { ...LIT, lighting: 'pointer' });
    await flush();
    stubCanvas({ left: 0, top: 0, width: 100, height: 100 });
    dispatch('pointermove', { clientX: 100, clientY: 50 });
    clock.advance(16);
    const afterOne = envY();
    for (let i = 0; i < 40; i++) clock.advance(16);

    expect(afterOne).toBeGreaterThan(0);
    // Rebuilding the slot per frame would hand back a fresh piece easing from rest every time, so
    // the yaw would sit at exactly what one frame reached and never move again.
    expect(envY()).toBeGreaterThan(afterOne * 5);
    bk.destroy();
  });

  it('rests at the static pose until the pointer has been inside the box', async () => {
    const bk = create();
    void bk.fire('HI', { ...LIT, lighting: 'pointer' });
    await flush();
    stubCanvas({ left: 0, top: 0, width: 100, height: 100 });
    clock.advance(16);

    expect(envY()).toBe(0);
    expect(stage().scene.environmentRotation.x).toBe(0);
    bk.destroy();
  });

  it('attaches no listener until something has been fired', () => {
    create();

    expect(listeners.get('pointermove') ?? []).toHaveLength(0);
  });

  it('keeps the listener past a settled effect and drops it on destroy', async () => {
    const bk = create();
    const done = bk.fire('HI', INSTANT);
    await flush();
    expect(listeners.get('pointermove')).toHaveLength(1);

    clock.advance(16);
    await done;

    expect(listeners.get('pointermove')).toHaveLength(1);

    bk.destroy();

    expect(listeners.get('pointermove') ?? []).toHaveLength(0);
  });

  it('adds no second listener for a second fire', async () => {
    const bk = create();
    const done = bk.fire('HI', INSTANT);
    await flush();
    clock.advance(16);
    await done;

    void bk.fire('HI', LIT);
    await flush();

    expect(listeners.get('pointermove')).toHaveLength(1);
    bk.destroy();
  });

  it('drops it on a destroy that aborts an effect mid-flight', async () => {
    const bk = create();
    const done = bk.fire('HI', LIT);
    await flush();
    expect(listeners.get('pointermove')).toHaveLength(1);

    bk.destroy();
    await done;

    expect(listeners.get('pointermove') ?? []).toHaveLength(0);
  });
});

describe('the pointer in the frame context', () => {
  const BOX = { left: 0, top: 0, width: 100, height: 100 };

  /** A body-wide effect piece is the only thing handed the ctx the render loop builds. */
  function capture() {
    const frames: FrameCtx[] = [];
    const parts: PartInfo[] = [];
    return {
      frames,
      parts,
      spec: {
        piece: {
          duration: 1000,
          at: (_t: number, part: PartInfo, ctx: FrameCtx) => {
            parts.push(part);
            frames.push(ctx);
            return {};
          },
        },
        target: { kind: 'body', by: 'index', amount: 1 },
      } as const,
    };
  }

  const last = <T>(xs: T[]): T => xs[xs.length - 1] as T;
  const LOOKING = (spec: EffectSpec): FireOptions => ({
    enter: 'none',
    active: 'none',
    exit: 'none',
    hold: 5000,
    effects: [spec],
  });

  it('leaves both pointers null until one has moved', async () => {
    const seen = capture();
    const bk = create();
    void bk.fire('HI', LOOKING(seen.spec));
    await flush();
    stubCanvas(BOX);
    clock.advance(16);

    expect(seen.frames.length).toBeGreaterThan(0);
    expect(last(seen.frames).pointer).toBeNull();
    expect(last(seen.frames).pointerInWord).toBeNull();
    bk.destroy();
  });

  it('carries a canvas pointer that sweeps the whole word in layout space', async () => {
    const seen = capture();
    const bk = create();
    // Two lines, and wide enough that the word's extent reaches past the -1..1 the box is in:
    // a single line has no vertical extent to speak of and cannot tell the y axes apart.
    void bk.fire('HELLO\nTHERE', LOOKING(seen.spec));
    await flush();
    stubCanvas(BOX);

    dispatch('pointermove', { clientX: 0, clientY: 0 });
    clock.advance(16);
    const topLeft = last(seen.frames).pointerInWord;

    dispatch('pointermove', { clientX: 100, clientY: 100 });
    clock.advance(16);
    const bottomRight = last(seen.frames).pointerInWord;

    const xs = seen.parts.map((p) => p.x);
    const ys = seen.parts.map((p) => p.y);
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0);
    // The far corners of the canvas must reach past every part, or a lamp can never light the ends.
    expect(topLeft?.x).toBeLessThanOrEqual(Math.min(...xs));
    expect(bottomRight?.x).toBeGreaterThanOrEqual(Math.max(...xs));
    // clientY grows downward and layout y grows upward, so the top of the canvas is the top line.
    expect(topLeft?.y).toBeGreaterThanOrEqual(Math.max(...ys));
    expect(bottomRight?.y).toBeLessThanOrEqual(Math.min(...ys));
    bk.destroy();
  });

  it('remembers where the pointer was for an effect that opens under a still cursor', async () => {
    const bk = create();
    const first = bk.fire('HI', INSTANT);
    await flush();
    stubCanvas(BOX);
    dispatch('pointermove', { clientX: 100, clientY: 50 });
    clock.advance(16);
    await first;

    // The cursor never moves again: a hover- or click-triggered sign opens under a still pointer.
    const seen = capture();
    void bk.fire('HI', LOOKING(seen.spec));
    await flush();
    clock.advance(16);

    expect(last(seen.frames).pointer).not.toBeNull();
    expect(last(seen.frames).pointer?.x).toBeCloseTo(1, 6);
    bk.destroy();
  });

  it('sees a pointer that moved between two fires, not the one from before', async () => {
    const bk = create();
    const first = bk.fire('HI', INSTANT);
    await flush();
    stubCanvas(BOX);
    dispatch('pointermove', { clientX: 0, clientY: 50 });
    clock.advance(16);
    await first;

    // Nothing is on screen, but the cursor keeps moving. A listener that comes and goes with the
    // effect would miss this and reopen the next one aimed where the pointer used to be.
    dispatch('pointermove', { clientX: 100, clientY: 50 });

    const seen = capture();
    void bk.fire('HI', LOOKING(seen.spec));
    await flush();
    clock.advance(16);

    expect(last(seen.frames).pointer?.x).toBeCloseTo(1, 6);
    bk.destroy();
  });

  it('shares one listener across concurrent effects and drops it exactly once', async () => {
    const bk = create({ policy: 'concurrent' });
    const a = bk.fire('HI', { ...LIT });
    const b = bk.fire('HI', { ...LIT });
    await flush();

    expect(listeners.get('pointermove')).toHaveLength(1);

    bk.destroy();
    await Promise.all([a, b]);

    expect(listeners.get('pointermove') ?? []).toHaveLength(0);
  });

  it('never measures the canvas for a page whose pointer has not moved', async () => {
    let reads = 0;
    const bk = create();
    void bk.fire('HI', LIT);
    await flush();
    stage().canvas = {
      getBoundingClientRect: () => {
        reads++;
        return { ...BOX, right: 100, bottom: 100 };
      },
    } as unknown as HTMLCanvasElement;
    clock.advance(16);
    clock.advance(16);

    // A forced layout read every frame, for a box nothing is going to be measured against.
    expect(reads).toBe(0);

    // Still nothing: this sign runs no piece that asks where the cursor is.
    dispatch('pointermove', { clientX: 40, clientY: 40 });
    clock.advance(16);

    expect(reads).toBe(0);
    bk.destroy();
  });

  it('measures the canvas once a frame for a sign whose piece does read the pointer', async () => {
    let reads = 0;
    const bk = create();
    void bk.fire('HI', { ...LIT, lighting: track({ followMs: 0 }) });
    await flush();
    stage().canvas = {
      getBoundingClientRect: () => {
        reads++;
        return { ...BOX, right: 100, bottom: 100 };
      },
    } as unknown as HTMLCanvasElement;
    dispatch('pointermove', { clientX: 40, clientY: 40 });
    clock.advance(16);

    expect(reads).toBe(1);

    // Once per frame however many pieces ask, and never cached across frames: the box can move
    // without a resize or a scroll.
    clock.advance(16);

    expect(reads).toBe(2);
    bk.destroy();
  });

  it('reports the frame delta the clock advanced by', async () => {
    const seen = capture();
    const bk = create();
    void bk.fire('HI', LOOKING(seen.spec));
    await flush();
    clock.advance(16);
    clock.advance(32);

    expect(last(seen.frames).dt).toBe(32);
    bk.destroy();
  });

  it('reports an infinite delta under reduced motion, which snaps rather than eases', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const seen = capture();
    const bk = create();
    void bk.fire('HI', LOOKING(seen.spec));
    await flush();
    clock.advance(16);

    expect(last(seen.frames).dt).toBe(Number.POSITIVE_INFINITY);
    bk.destroy();
  });
});

describe('mixed name and piece slots', () => {
  it('resolves a built-in name sitting alongside a caller piece', async () => {
    const lift = { duration: 1000, offset: () => ({ position: [0, 1, 0] as Vec3 }) };

    const bk = create();
    void bk.fire('HI', {
      enter: 'none',
      active: ['pulse', lift],
      exit: 'none',
      hold: 1000,
      blendMs: 0,
    });
    await flush();
    clock.advance(500);

    // A bare string left unresolved makes duration NaN, which collapses the pose to rest.
    expect(firstCell().position.y).toBeCloseTo(1, 6);
  });

  it('keeps a layered slot of names alone working', async () => {
    const bk = create();
    void bk.fire('HI', {
      enter: 'none',
      active: ['pulse', 'float'],
      exit: 'none',
      hold: 1000,
      blendMs: 0,
    });
    await flush();
    clock.advance(500);

    expect(Number.isNaN(firstCell().position.y)).toBe(false);
  });
});

describe('element placement', () => {
  const el = {} as HTMLElement;

  beforeEach(() => {
    stubWebgl(true);
    stubFetch();
    stubStage();
  });

  it('refuses a target alongside it, rather than silently picking one', () => {
    expect(() => create({ placement: { kind: 'element', el } })).toThrow(/`target` cannot apply/);
  });

  it('takes the placement when no target competes with it', () => {
    const klieg = create({ placement: { kind: 'element', el }, target: undefined });

    expect(klieg.supported).toBe(true);
  });

  it("refuses hold: 'click' from an anchor that has not opted in", () => {
    const klieg = create({ placement: { kind: 'element', el }, target: undefined });

    expect(() => klieg.fire('hi', { hold: 'click' })).toThrow(/only with `clickAnywhere`/);
  });

  it("refuses a stage holding on 'click' too, not just the top level", () => {
    const klieg = create({ placement: { kind: 'element', el }, target: undefined });

    expect(() => klieg.fire('hi', { stages: [{ hold: 'click' }] })).toThrow(
      /only with `clickAnywhere`/,
    );
  });

  it("accepts hold: 'forever', where 'click' is refused", async () => {
    const klieg = create({ placement: { kind: 'element', el }, target: undefined });
    const done = klieg.fire('hi', { hold: 'forever' });
    await flush();
    clock.advance(60 * 60 * 1000);

    expect(words()).toHaveLength(1);

    klieg.destroy();
    await done;
  });

  it("takes hold: 'click' from an anchor with no opt-in once the host owns the dismissal", () => {
    const klieg = create({ placement: { kind: 'element', el }, target: undefined });

    // `clickAnywhere` gates a window listener, and `dismiss: 'host'` attaches none.
    expect(() => klieg.fire('hi', { hold: 'click', dismiss: 'host' })).not.toThrow();
    expect(() => klieg.fire('hi', { stages: [{ hold: 'click' }], dismiss: 'host' })).not.toThrow();
    klieg.destroy();
  });

  it("takes hold: 'click' once the anchor says a press anywhere dismisses it", () => {
    const klieg = create({
      placement: { kind: 'element', el, clickAnywhere: true },
      target: undefined,
    });

    expect(() => klieg.fire('hi', { hold: 'click' })).not.toThrow();
    klieg.destroy();
  });

  it('takes a click-held stage under the same opt-in, which is what a routine builds', () => {
    const klieg = create({
      placement: { kind: 'element', el, clickAnywhere: true },
      target: undefined,
    });

    expect(() => klieg.fire('hi', { stages: [{ hold: 'click' }] })).not.toThrow();
    klieg.destroy();
  });

  it("leaves hold: 'click' alone for a fullscreen overlay", () => {
    const klieg = create();

    expect(() => klieg.fire('hi', { hold: 'click' })).not.toThrow();
    klieg.destroy();
  });

  it('hands the placement to the stage it builds', () => {
    const klieg = create({ placement: { kind: 'element', el }, target: undefined });
    void klieg.fire('hi');

    return flush().then(() => {
      expect(stage().placement).toEqual({ kind: 'element', el });
    });
  });
});

describe('selectable', () => {
  it('warns and falls back to hidden when a transform would misalign the layer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bk = create();
    void bk.fire('AB', { selectable: 'layer', transform: fromEuler(0, 0.3, 0) });
    await flush();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('a transform'));
    bk.destroy();
  });

  it('warns and names the piece when the active motion moves the letters', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bk = create();
    void bk.fire('AB', { selectable: 'layer', active: 'float' });
    await flush();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('float'));
    bk.destroy();
  });

  it('says nothing for a still word', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bk = create();
    void bk.fire('AB', { selectable: 'layer', enter: 'none', active: 'none' });
    await flush();

    expect(warn).not.toHaveBeenCalled();
    bk.destroy();
  });

  it('says nothing when the caller did not ask for a layer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bk = create();
    void bk.fire('AB', { active: 'float' });
    await flush();

    expect(warn).not.toHaveBeenCalled();
    bk.destroy();
  });
});

describe('the warm', () => {
  it('mounts, renders once and arms the idle teardown', async () => {
    create();
    await runIdle();

    expect(calls).toEqual(['mount', 'idle']);
    expect(renders).toBe(1);
  });

  it('leaves nothing of its own on the stage', async () => {
    create();
    await runIdle();

    expect(words()).toHaveLength(0);
  });

  it('does not warm an unsupported instance', async () => {
    stubWebgl(false);
    create();
    await runIdle();

    expect(calls).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not warm once a fire has already started', async () => {
    const bk = create();
    const done = bk.fire('HI', INSTANT);
    await flush();
    clock.advance(16);
    await done;
    await runIdle();

    expect(calls).toEqual(['mount', 'idle']);
    expect(renders).toBe(1);
  });

  it('does not arm a teardown against a fire that is still running', async () => {
    const bk = create();
    bk.fire('HI', { ...INSTANT, hold: 5000 });
    await flush();
    await runIdle();

    expect(calls).toEqual(['mount']);
  });

  it('links the bloom quads too when the warmed look asks for bloom', async () => {
    create({ warmLook: 'neon' });
    await runIdle();

    // The word, then the threshold, blur and composite quads — each a program of its own.
    expect(renders).toBe(4);
  });

  it('builds no bloom path for a look that does not bloom', async () => {
    create({ warmLook: 'gold' });
    await runIdle();

    expect(renders).toBe(1);
  });

  it('holds its throwaway word until a fire needs the programs it linked', async () => {
    const spy = vi.spyOn(Word.prototype, 'dispose');
    const bk = create();
    await runIdle();
    // three refcounts a program per material: disposing here would hand back what was just linked.
    expect(spy).not.toHaveBeenCalled();

    const done = bk.fire('HI', INSTANT);
    await flush();

    expect(spy).toHaveBeenCalled();
    clock.advance(16);
    await done;
  });

  it('frees the throwaway on destroy when no fire ever came', async () => {
    const spy = vi.spyOn(Word.prototype, 'dispose');
    const bk = create();
    await runIdle();
    bk.destroy();

    expect(spy).toHaveBeenCalled();
  });

  it('links on demand when the host names the instant', async () => {
    const bk = create();
    await bk.warm('neon');

    // The word, then the threshold, blur and composite quads.
    expect(calls).toEqual(['mount', 'idle']);
    expect(renders).toBe(4);
  });

  it('warms on demand after a fire, where the automatic one would decline', async () => {
    const bk = create();
    const done = bk.fire('HI', INSTANT);
    await flush();
    clock.advance(16);
    await done;
    const before = renders;

    await bk.warm('gold');

    expect(renders).toBe(before + 1);
  });

  it('warms the configured look when the host names none', async () => {
    const bk = create({ warmLook: 'neon' });
    await bk.warm();

    expect(renders).toBe(4);
  });

  it('resolves without touching the stage when unsupported', async () => {
    stubWebgl(false);
    const bk = create();
    await bk.warm('neon');

    expect(calls).toEqual([]);
  });

  it('resolves without touching the stage after destroy', async () => {
    const bk = create();
    bk.destroy();
    await bk.warm('neon');

    // The unmount destroy() schedules has not landed yet; the point is that the warm added nothing.
    expect(calls).toEqual([]);
  });

  it('destroys cleanly when the warm never ran', () => {
    const bk = create();

    expect(() => bk.destroy()).not.toThrow();
  });
});

describe('fonts', () => {
  it('sets a fire in the font it names', async () => {
    const bk = create({ fonts: { display: '/d.ttf', body: '/b.ttf' } });
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetched.push(url);
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response;
      }),
    );

    const done = bk.fire('X', { ...INSTANT, font: 'body' });
    await flush();
    clock.advance(16);
    await done;

    expect(fetched).toEqual(['/b.ttf']);
  });

  it('falls to the first entry when a fire names no font', async () => {
    const bk = create({ fonts: { display: '/d.ttf', body: '/b.ttf' } });
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetched.push(url);
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response;
      }),
    );

    const done = bk.fire('X', INSTANT);
    await flush();
    clock.advance(16);
    await done;

    expect(fetched).toEqual(['/d.ttf']);
  });

  it('throws at the call site on a font it has not got', () => {
    const bk = create({ fonts: { display: '/d.ttf' } });

    expect(() => bk.fire('X', { font: 'nope' })).toThrow(
      "klieg: no font named 'nope' — registered: display",
    );
  });

  it('throws on an unknown font even where WebGL is missing, so the typo is not machine-specific', () => {
    stubWebgl(false);
    const bk = create({ fonts: { display: '/d.ttf' } });

    expect(() => bk.fire('X', { font: 'nope' })).toThrow("klieg: no font named 'nope'");
  });

  it('refuses fontUrl and fonts together, which disagree about which font is which', () => {
    expect(() => create({ fontUrl: '/a.ttf', fonts: { a: '/a.ttf' } })).toThrow(
      'klieg: pass fonts or fontUrl, not both',
    );
  });

  it('refuses neither', () => {
    expect(() => createKlieg({ clock } as KliegOptions)).toThrow('klieg: fonts is required');
  });

  it('takes the deprecated fontUrl, warning once for the instance rather than once per fire', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bk = createKlieg({ fontUrl: '/f.ttf', clock });

    const first = bk.fire('X', INSTANT);
    await flush();
    clock.advance(16);
    await first;
    const second = bk.fire('Y', INSTANT);
    await flush();
    clock.advance(16);
    await second;

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'klieg: fontUrl is deprecated — pass fonts: { display: url } instead',
    );
    warn.mockRestore();
  });
});

describe('firing styled runs', () => {
  const stubFetch = () =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }) as Response),
    );

  it('fires a list of runs', async () => {
    stubFetch();
    const bk = create({ fonts: { display: '/d.ttf', body: '/b.ttf' } });

    const done = bk.fire([{ text: 'A' }, { text: 'B', font: 'body', size: 0.5 }], INSTANT);
    await flush();

    expect(words()).toHaveLength(1);
    clock.advance(16);
    await done;
  });

  it('preheats a named face, fetching it before any fire asks for it', async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetched.push(url);
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response;
      }),
    );
    const bk = create({ fonts: { display: '/d.ttf', body: '/b.ttf' } });

    await bk.preheat('AB', 'body');

    expect(fetched).toEqual(['/b.ttf']);
  });

  // Same stance as `fire`: a name the instance does not hold is a typo in the host's own code, and
  // it belongs at the call site rather than in a rejection handler.
  it('throws where preheat was called for a font it does not hold', () => {
    stubFetch();
    const bk = create({ fonts: { display: '/d.ttf' } });
    expect(() => bk.preheat('AB', 'nope')).toThrow("klieg: no font named 'nope'");
  });

  it('loads every font its runs name, not just the fire-wide one', async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetched.push(url);
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response;
      }),
    );
    const bk = create({ fonts: { display: '/d.ttf', body: '/b.ttf' } });

    const done = bk.fire([{ text: 'A' }, { text: 'B', font: 'body' }], INSTANT);
    await flush();
    clock.advance(16);
    await done;

    expect(fetched.sort()).toEqual(['/b.ttf', '/d.ttf']);
  });

  it('lays a string and one run of the same text out identically', async () => {
    stubFetch();
    const bk = create();

    bk.fire('AB', INSTANT);
    await flush();
    const fromString = firstCell().position.x;
    clock.advance(16);
    await flush();

    bk.fire([{ text: 'AB' }], INSTANT);
    await flush();

    expect(firstCell().position.x).toBeCloseTo(fromString);
  });

  it("carries a run's size on the node the pose does not write", async () => {
    stubFetch();
    const bk = create();

    const done = bk.fire([{ text: 'A' }, { text: 'B', size: 0.5 }], INSTANT);
    await flush();
    const cells = firstCell().parent?.children ?? [];

    expect((cells[1] as THREE.Group).scale.x).toBe(1);
    expect(((cells[1] as THREE.Group).children[0] as THREE.Group).scale.x).toBeCloseTo(0.5);
    clock.advance(16);
    await done;
  });

  it("lets a run's tint beat the fire's", async () => {
    stubFetch();
    const bk = create();

    const done = bk.fire([{ text: 'A' }, { text: 'B', tint: 0x00ff00 }], {
      ...INSTANT,
      tint: 0xff0000,
    });
    await flush();
    const cells = firstCell().parent?.children ?? [];
    const colorOf = (cell: THREE.Object3D) =>
      (((cell as THREE.Group).children[0] as THREE.Group).children[0] as THREE.Mesh)
        .material as THREE.MeshPhysicalMaterial;

    expect(colorOf(cells[0] as THREE.Object3D).color.getHex()).not.toBe(
      colorOf(cells[1] as THREE.Object3D).color.getHex(),
    );
    clock.advance(16);
    await done;
  });
});
