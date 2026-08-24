import type { Font } from 'opentype.js';
import type * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Clock, ManualClock, type Tick } from '../src/clock.js';
import {
  ACTIVE_NAMES,
  createKlieg,
  ENTER_NAMES,
  EXIT_NAMES,
  type KliegOptions,
  LIGHTING_NAMES,
  LOOK_NAMES,
  POLICY_NAMES,
  wantsBloom,
} from '../src/index.js';
import type { Vec3 } from '../src/pose.js';
import { BloomPath } from '../src/render/bloom.js';
import { Stage } from '../src/render/stage.js';
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
    charToGlyph: () => ({
      advanceWidth: ADVANCE,
      getPath: (_x: number, _y: number, size: number) => ({ commands: BOX(size) }),
    }),
    getKerningValue: () => 0,
  } as unknown as Font;
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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
  return createKlieg({ fontUrl: '/f.ttf', clock, target: {} as HTMLElement, ...opts });
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

function firstMesh(): THREE.Mesh {
  return firstCell().children[0] as THREE.Mesh;
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
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Enter, active and exit all zero-length, so the effect finishes on its first tick. */
const INSTANT = { enter: 'none', active: 'none', exit: 'none', hold: 0 } as const;

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
    const bk = createKlieg({ fontUrl: '/f.ttf', clock });

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
});

describe('holding until dismissed', () => {
  type Listener = (e: unknown) => void;
  let listeners: Map<string, Listener[]>;

  /** node has no window event target, so the dismissal listeners need one to attach to. */
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
  const attached = () =>
    (listeners.get('pointerdown')?.length ?? 0) + (listeners.get('keydown')?.length ?? 0);

  const HELD = { enter: 'none', active: 'none', exit: 'none', hold: 'click' } as const;

  beforeEach(stubListeners);

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
});

describe('published name lists', () => {
  // Literal rather than derived: the arrays are already exhaustive by construction, so what is
  // left to pin is the order a picker shows and the fact that dropping one is a breaking change.
  it('lists every name a consumer can fire with, motion-first', () => {
    expect(ENTER_NAMES).toEqual(['slam', 'spin', 'flip', 'assemble', 'rise', 'none']);
    expect(ACTIVE_NAMES).toEqual(['float', 'pulse', 'shimmer', 'none']);
    expect(LIGHTING_NAMES).toEqual(['sweep', 'static']);
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

  it('lets a caller-supplied active piece rake the highlight', async () => {
    const raker = { duration: 1000, offset: () => ({}), envRotation: true };

    const bk = create();
    void bk.fire('HI', { enter: 'none', active: raker, exit: 'none', hold: 1000 });
    await flush();
    clock.advance(500);

    expect(stage().scene.environmentRotation.y).toBeGreaterThan(0);
  });

  it('falls back to the lighting mode for a piece that does not drive the environment', async () => {
    const plain = { duration: 1000, offset: () => ({}) };

    const bk = create();
    void bk.fire('HI', {
      enter: 'none',
      active: plain,
      exit: 'none',
      hold: 1000,
      lighting: 'static',
    });
    await flush();
    clock.advance(500);

    expect(stage().scene.environmentRotation.y).toBe(0);
  });

  it('lets a driving piece override the lighting mode, being the more specific choice', async () => {
    const raker = { duration: 1000, offset: () => ({}), envRotation: true };

    const bk = create();
    void bk.fire('HI', {
      enter: 'none',
      active: raker,
      exit: 'none',
      hold: 1000,
      lighting: 'static',
    });
    await flush();
    clock.advance(500);

    expect(stage().scene.environmentRotation.y).toBeGreaterThan(0);
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
