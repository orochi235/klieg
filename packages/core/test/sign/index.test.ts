// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FireOptions, KliegOptions } from '../../src/index.js';

const { createKlieg, fire, destroy, prefersReducedMotion } = vi.hoisted(() => ({
  createKlieg: vi.fn(),
  fire: vi.fn(),
  destroy: vi.fn(),
  prefersReducedMotion: vi.fn(() => false),
}));

vi.mock('../../src/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/index.js')>()),
  createKlieg,
}));
vi.mock('../../src/render/stage.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/render/stage.js')>()),
  prefersReducedMotion,
}));

const { sign } = await import('../../src/sign/index.js');

let anchor: HTMLElement;
let settle: () => void;

/** The options the last `createKlieg` was built with. */
const built = (): KliegOptions => createKlieg.mock.calls.at(-1)?.[0] as KliegOptions;
/** The options the last `fire` was called with. */
const fired = (): FireOptions => fire.mock.calls.at(-1)?.[1] as FireOptions;

beforeEach(() => {
  vi.clearAllMocks();
  prefersReducedMotion.mockReturnValue(false);
  document.body.innerHTML = '';
  anchor = document.createElement('h1');
  anchor.textContent = 'A Name';
  document.body.appendChild(anchor);

  // A forever hold: the promise stays pending until the test settles it.
  fire.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
  );
  createKlieg.mockReturnValue({ supported: true, fire, destroy });
});

describe('sign', () => {
  it('anchors an element placement to the anchor and fires its text', () => {
    sign(anchor, { font: '/f.ttf' });

    expect(built().fontUrl).toBe('/f.ttf');
    expect(built().placement).toEqual({ kind: 'element', el: anchor });
    expect(fire).toHaveBeenCalledWith('A Name', expect.anything());
  });

  it('holds forever and never enters, because an anchored canvas clips a traveling enter', () => {
    sign(anchor, { font: '/f.ttf' });

    expect(fired().hold).toBe('forever');
    expect(fired().enter).toBe('none');
  });

  it('leaves the anchor untouched with no webgl, and never reports itself lit', () => {
    createKlieg.mockReturnValue({ supported: false, fire, destroy });
    const onLit = vi.fn();

    const it_ = sign(anchor, { font: '/f.ttf', onLit });

    expect(fire).not.toHaveBeenCalled();
    expect(onLit).not.toHaveBeenCalled();
    expect(it_.lit).toBe(false);
    expect(anchor.textContent).toBe('A Name');
  });

  it('does not fire an empty anchor', () => {
    anchor.textContent = '   ';
    sign(anchor, { font: '/f.ttf' });

    expect(createKlieg).not.toHaveBeenCalled();
  });

  it('prefers an explicit text over the anchor content', () => {
    sign(anchor, { font: '/f.ttf', text: 'Something Else' });

    expect(fire).toHaveBeenCalledWith('Something Else', expect.anything());
  });

  it('adds no DOM copy of a word the anchor already carries', () => {
    sign(anchor, { font: '/f.ttf' });

    expect(fired().selectable).toBe('none');
  });

  it('adds a hidden DOM copy of a word nothing else carries', () => {
    sign(anchor, { font: '/f.ttf', text: 'Something Else' });

    expect(fired().selectable).toBe('hidden');
  });

  it('resolves a CSS tint against the anchor', () => {
    sign(anchor, { font: '/f.ttf', tint: '#22d3ee' });

    expect(fired().tint).toBe(0x22d3ee);
  });

  it('merges the fire escape hatch over everything it built', () => {
    sign(anchor, { font: '/f.ttf', bloom: true, fire: { bloom: false, blendMs: 40 } });

    expect(fired().bloom).toBe(false);
    expect(fired().blendMs).toBe(40);
  });

  it('stills what moves under reduced motion, and still shows the sign', () => {
    prefersReducedMotion.mockReturnValue(true);
    sign(anchor, {
      font: '/f.ttf',
      lighting: 'sweep',
      effects: [{ piece: 'flicker', target: { kind: 'body', by: 'index' } }],
    });

    expect(fire).toHaveBeenCalledWith('A Name', expect.anything());
    expect(fired().lighting).toBe('static');
    expect(fired().effects).toEqual([]);
  });

  it('reports lit before the build blocks, and unlit when the fire settles', async () => {
    const onLit = vi.fn();
    const it_ = sign(anchor, { font: '/f.ttf', onLit });

    // Synchronously, with no await: the word build blocks the main thread and nothing paints
    // during it, so a caller told afterwards is told seconds late.
    expect(onLit).toHaveBeenCalledExactlyOnceWith(true);
    expect(it_.lit).toBe(true);

    settle();
    await Promise.resolve();
    expect(onLit).toHaveBeenLastCalledWith(false);
    expect(it_.lit).toBe(false);
  });

  it('takes the sign down and back up across an update, and ignores the superseded fire', async () => {
    const onLit = vi.fn();
    const it_ = sign(anchor, { font: '/f.ttf', onLit });
    const superseded = settle;

    it_.update({ text: 'A New Name' });

    expect(destroy).toHaveBeenCalledOnce();
    expect(fire).toHaveBeenLastCalledWith('A New Name', expect.anything());
    // The patch carried `text` alone; everything it did not name survives the rebuild.
    expect(built().fontUrl).toBe('/f.ttf');
    // Down while the replacement blocks the main thread building its word, then up again.
    expect(onLit.mock.calls).toEqual([[true], [false], [true]]);

    superseded();
    await Promise.resolve();
    expect(it_.lit).toBe(true);
    expect(onLit).toHaveBeenLastCalledWith(true);
  });

  it('reports unlit once when destroyed, not again when its fire settles', async () => {
    const onLit = vi.fn();
    const it_ = sign(anchor, { font: '/f.ttf', onLit });

    it_.destroy();
    expect(destroy).toHaveBeenCalledOnce();
    expect(it_.lit).toBe(false);
    // The sign borrows the anchor; taking it down leaves the page's own markup as it found it.
    expect(anchor.textContent).toBe('A Name');

    settle();
    await Promise.resolve();
    expect(onLit.mock.calls).toEqual([[true], [false]]);
  });

  it('warns rather than crashing the page when the fire rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failure = new Error('no such font');
    fire.mockRejectedValueOnce(failure);
    const onLit = vi.fn();

    const it_ = sign(anchor, { font: '/missing.ttf', onLit });
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());

    // Nothing holds the promise `sign()` made, so an escaped rejection lands in the host page.
    expect(warn).toHaveBeenCalledWith('klieg: a sign failed to light', failure);
    expect(onLit.mock.calls).toEqual([[true], [false]]);
    expect(it_.lit).toBe(false);
    warn.mockRestore();
  });

  it('owes the replaced callback its own unlit, not the one that replaced it', () => {
    const before = vi.fn();
    const after = vi.fn();
    const it_ = sign(anchor, { font: '/f.ttf', onLit: before });

    it_.update({ onLit: after });

    expect(before.mock.calls).toEqual([[true], [false]]);
    expect(after.mock.calls).toEqual([[true]]);
  });

  it('stays destroyed when updated', () => {
    const it_ = sign(anchor, { font: '/f.ttf' });
    it_.destroy();
    createKlieg.mockClear();

    it_.update({ text: 'A New Name' });

    expect(createKlieg).not.toHaveBeenCalled();
    expect(it_.lit).toBe(false);
  });
});
