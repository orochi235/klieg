import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Stage } from '../../src/render/stage.js';
import {
  calls,
  clock,
  create,
  dispatch,
  flush,
  INSTANT,
  listeners,
  renders,
  setup,
  stubWebgl,
  teardown,
  words,
} from './harness.js';

const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('opentype.js', () => ({ parse }));

beforeEach(setup);
afterEach(teardown);

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

describe('attach', () => {
  const HELD = { ...INSTANT, hold: 5000 } as const;

  /** A layer whose liveness a test sets, recording every step and where its object was then. */
  function layer(live = true) {
    const steps: number[] = [];
    const parents: (THREE.Object3D | null)[] = [];
    const object = new THREE.Group();
    const made = {
      object,
      live,
      update(dt: number) {
        steps.push(dt);
        parents.push(object.parent);
      },
    };
    return { layer: made, steps, parents };
  }

  it('puts the object in the scene before its first update, and steps it in seconds', () => {
    const bk = create();
    const { layer: l, steps, parents } = layer();
    bk.attach(l);
    clock.advance(16);
    clock.advance(16);

    expect(parents[0]).not.toBeNull();
    expect(steps).toEqual([0, 0.016]);
    bk.destroy();
  });

  it('draws frames between fires only while a layer is live, then clears and idles', () => {
    const bk = create();
    const { layer: l } = layer(false);
    bk.attach(l);
    clock.advance(16);
    expect(renders).toBe(0);

    l.live = true;
    clock.advance(16);
    clock.advance(16);
    expect(renders).toBe(2);
    expect(calls).toContain('mount');
    expect(calls).not.toContain('idle');

    l.live = false;
    clock.advance(16);
    expect(renders).toBe(3);
    expect(calls.at(-1)).toBe('idle');
    clock.advance(16);
    expect(renders).toBe(3);
    bk.destroy();
  });

  it('holds idle teardown past the fire that set it off, and keeps drawing after it', async () => {
    const bk = create();
    const { layer: l } = layer();
    bk.attach(l);
    const done = bk.fire('HI', INSTANT);
    await flush();
    clock.advance(16);
    await done;
    expect(calls).not.toContain('idle');

    const before = renders;
    clock.advance(16);
    expect(renders).toBe(before + 1);

    l.live = false;
    clock.advance(16);
    expect(calls.at(-1)).toBe('idle');
    bk.destroy();
  });

  it('draws once and steps once a frame while a fire is drawing too', async () => {
    const bk = create();
    const { layer: l, steps } = layer();
    bk.attach(l);
    void bk.fire('HI', HELD);
    await flush();
    clock.advance(16);

    const renders0 = renders;
    const steps0 = steps.length;
    clock.advance(16);
    expect(renders - renders0).toBe(1);
    expect(steps.length - steps0).toBe(1);
    bk.destroy();
  });

  it('takes the object out on detach and stops stepping it', () => {
    const bk = create();
    const { layer: l, steps } = layer();
    const detach = bk.attach(l);
    clock.advance(16);
    detach();
    const seen = steps.length;
    clock.advance(16);

    expect(l.object.parent).toBeNull();
    expect(steps).toHaveLength(seen);
    bk.destroy();
  });

  it('detaches every layer on destroy', () => {
    const bk = create();
    const { layer: l } = layer();
    bk.attach(l);
    bk.destroy();
    expect(l.object.parent).toBeNull();
  });

  it('does nothing where WebGL is unsupported', () => {
    stubWebgl(false);
    const bk = create();
    const { layer: l, steps } = layer();
    bk.attach(l);
    clock.advance(16);

    expect(steps).toEqual([]);
    expect(l.object.parent).toBeNull();
  });

  it('drops a layer whose update throws, reports it, and keeps stepping the rest', () => {
    const reported: unknown[] = [];
    vi.stubGlobal('queueMicrotask', (fn: () => void) => {
      try {
        fn();
      } catch (err) {
        reported.push(err);
      }
    });
    const bk = create();
    const bad = {
      object: new THREE.Group(),
      live: true,
      update() {
        throw new Error('boom');
      },
    };
    const { layer: good, steps } = layer();
    bk.attach(bad);
    bk.attach(good);
    clock.advance(16);
    clock.advance(16);

    expect(reported).toHaveLength(1);
    expect(bad.object.parent).toBeNull();
    expect(steps).toHaveLength(2);
    bk.destroy();
  });
});
