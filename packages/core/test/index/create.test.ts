import type * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKlieg } from '../../src/index.js';
import {
  calls,
  clock,
  create,
  firstCell,
  firstMesh,
  flush,
  INSTANT,
  LeakyClock,
  LIT,
  peakWords,
  renders,
  setOnRender,
  setup,
  stage,
  stubFetch,
  stubWebgl,
  TAU,
  teardown,
  words,
} from './harness.js';

const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('opentype.js', () => ({ parse }));

beforeEach(setup);
afterEach(teardown);

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

  it('resolves destroy once the stage is down, returning one promise to every caller', async () => {
    const bk = create();
    const done = bk.fire('HELLO', { hold: 5000 });
    await flush();
    clock.advance(16);

    const first = bk.destroy();
    const second = bk.destroy();
    expect(second).toBe(first);
    expect(calls).not.toContain('unmount');

    await first;
    await done;
    expect(calls).toEqual(['mount', 'idle', 'unmount']);
    expect(bk.destroy()).toBe(first);
    await flush();
    expect(calls.filter((c) => c === 'unmount')).toHaveLength(1);
  });

  it('rejects the effect and comes down when a tick throws', async () => {
    const bk = create();
    setOnRender(() => {
      throw new Error('context lost');
    });
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

  it('arms no teardown while a concurrent effect is still running', async () => {
    const bk = create({ policy: 'concurrent' });
    const short = bk.fire('A', INSTANT);
    const long = bk.fire('B', LIT);
    await flush();
    clock.advance(16);
    await short;

    expect(calls).not.toContain('idle');

    clock.advance(5000);
    await long;
    expect(calls.at(-1)).toBe('idle');
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
