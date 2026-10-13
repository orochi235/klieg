import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LetterInfo, MarkEvent } from '../../src/index.js';
import { Stage } from '../../src/render/stage.js';
import {
  clock,
  create,
  dispatch,
  flush,
  INSTANT,
  listeners,
  peakWords,
  setup,
  stubWebgl,
  teardown,
  words,
} from './harness.js';

const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('opentype.js', () => ({ parse }));

beforeEach(setup);
afterEach(teardown);

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
    const seen: MarkEvent[] = [];
    const bk = create();
    const done = bk.fire('HI', {
      enter: { duration: 100, at: () => ({}) },
      active: 'none',
      exit: 'none',
      hold: 50,
      blendMs: 0,
      onMark: (e) => seen.push(e),
    });
    await flush();

    clock.advance(50);
    expect(seen).toEqual([]);

    clock.advance(60);
    expect(seen).toEqual([{ mark: 'active' }]);

    clock.advance(100);
    await done;
    expect(seen).toEqual([{ mark: 'active' }, { mark: 'exit' }]);
  });

  it('reports exit only once a click hold is released, which no fire-time schedule can know', async () => {
    const seen: MarkEvent[] = [];
    const bk = create();
    const done = bk.fire('HI', { ...HELD, onMark: (e) => seen.push(e) });
    await flush();

    clock.advance(60_000);
    expect(seen).toEqual([{ mark: 'active' }]);

    dispatch('pointerdown');
    clock.advance(16);
    await done;

    expect(seen).toEqual([{ mark: 'active' }, { mark: 'exit' }]);
  });

  it('reports every stage a long frame crosses, not just the last', async () => {
    const seen: MarkEvent[] = [];
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
      onMark: (e) => seen.push(e),
    });
    await flush();

    // One frame, long enough to cross all three boundaries at once.
    clock.advance(10_000);
    await done;

    // Filtered because a single frame this long collapses the timed boundaries against the stage
    // ones; their relative order is not what this test is about.
    expect(seen.filter((e) => e.mark === 'stage')).toEqual([
      { mark: 'stage', index: 0 },
      { mark: 'stage', index: 1 },
      { mark: 'stage', index: 2 },
    ]);
  });

  it('lands settled in a later hold, reporting nothing it skipped, then plays live', async () => {
    const seen: MarkEvent[] = [];
    const bk = create();
    const click = (keep: (l: LetterInfo) => boolean) =>
      ({ keep, exit: 'none', hold: 'click', tween: { duration: 50 } }) as const;
    const done = bk.fire('ABCD', {
      hold: 'click',
      dismiss: 'host',
      stages: [click((l) => l.index < 3), click((l) => l.index < 2), click((l) => l.index < 1)],
      startAt: { hold: 2 },
      onMark: (e) => seen.push(e),
    });
    await flush();

    clock.advance(16);
    clock.advance(60_000);
    expect(seen).toEqual([]);

    done.advance();
    clock.advance(1000);
    expect(seen).toEqual([{ mark: 'stage', index: 2 }]);

    done.advance();
    clock.advance(5000);
    await done;
    expect(seen).toEqual([{ mark: 'stage', index: 2 }, { mark: 'exit' }]);
  });

  it('lands a fire with no stages in its hold, past the enter and its active mark', async () => {
    const seen: MarkEvent[] = [];
    const bk = create();
    const done = bk.fire('HI', {
      enter: { duration: 400, at: () => ({}) },
      exit: 'none',
      hold: 1000,
      startAt: { hold: 0 },
      onMark: (e) => seen.push(e),
    });
    await flush();

    clock.advance(16);
    expect(seen).toEqual([]);
    // The enter is skipped, so the hold's remainder is all that is left to play.
    clock.advance(1000);
    await done;
    expect(seen).toEqual([{ mark: 'exit' }]);
  });

  it('refuses at the call a hold the fire does not have', () => {
    const bk = create();
    expect(() => bk.fire('HI', { startAt: { hold: 1 } })).toThrow(RangeError);
    expect(() => bk.fire('HI', { stages: [{ hold: 0 }], startAt: { hold: 2 } })).toThrow(
      RangeError,
    );
    const signal = AbortSignal.abort();
    expect(() =>
      bk.fire('HI', { stages: [{ hold: 0 }], startAt: { hold: 1 }, signal }),
    ).not.toThrow();
  });

  it('reports both marks under reduced motion, which holds the pose without travelling', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const seen: MarkEvent[] = [];
    const bk = create();
    const done = bk.fire('HI', {
      enter: { duration: 400, at: () => ({}) },
      active: 'none',
      exit: { duration: 300, at: () => ({}) },
      hold: 100,
      onMark: (e) => seen.push(e),
    });
    await flush();

    clock.advance(16);
    expect(seen).toEqual([{ mark: 'active' }]);

    clock.advance(100);
    await done;
    expect(seen).toEqual([{ mark: 'active' }, { mark: 'exit' }]);
  });

  it('fires no mark event on an unsupported instance, which renders nothing', async () => {
    stubWebgl(false);
    const seen: MarkEvent[] = [];
    const bk = create();

    await bk.fire('HI', { onMark: (e) => seen.push(e) });

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
      exit: { duration: 500, at: () => ({ opacity: 0 }) },
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

  it('keeps rendering when onMark throws, and hands the error to the microtask queue', async () => {
    const queued: (() => void)[] = [];
    vi.stubGlobal('queueMicrotask', (fn: () => void) => queued.push(fn));

    const bk = create();
    const done = bk.fire('HI', {
      enter: 'none',
      active: 'none',
      exit: 'none',
      hold: 50,
      onMark: () => {
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
