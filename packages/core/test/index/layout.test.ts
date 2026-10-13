import type * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type KliegOptions, MAX_BACKDROP_ROWS } from '../../src/index.js';
import { BASE_Z } from '../../src/render/stage.js';
import { Word } from '../../src/render/word.js';
import { DEFAULT_GLYPH_OPTIONS } from '../../src/text/glyphs.js';
import { fromEuler } from '../../src/transform.js';
import {
  clock,
  create,
  flush,
  INSTANT,
  setup,
  stage,
  stubFetch,
  stubStage,
  stubWebgl,
  teardown,
  words,
} from './harness.js';

const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('opentype.js', () => ({ parse }));

beforeEach(setup);
afterEach(teardown);

describe('backdrop', () => {
  /** The hero is added first, so the backdrop is the scene's second word. */
  function backdrop(): THREE.Group {
    const back = words()[1];
    if (!back) throw new Error('the scene has no backdrop');
    return back as THREE.Group;
  }

  /** Every letter cell of a word, under the transform group the fit group holds. */
  function cellsOf(word: THREE.Object3D): THREE.Object3D[] {
    return (word.children[0] as THREE.Group).children;
  }

  it('adds no second word when no backdrop is asked for', async () => {
    const bk = create();
    const done = bk.fire('HI', INSTANT);
    await flush();

    expect(words()).toHaveLength(1);

    clock.advance(16);
    await done;
  });

  it('repeats the hero text on one line per row', async () => {
    const bk = create();
    const done = bk.fire('AB', { ...INSTANT, backdrop: { rows: 3 } });
    await flush();

    expect(cellsOf(backdrop())).toHaveLength(6);

    clock.advance(16);
    await done;
  });

  it('repeats what text names instead of the hero, on the same rows', async () => {
    const bk = create();
    const done = bk.fire('HELLO', { ...INSTANT, backdrop: { rows: 2, text: 'AB' } });
    await flush();

    expect(cellsOf(backdrop())).toHaveLength(4);

    clock.advance(16);
    await done;
  });

  it('builds no new geometry, because it shares the hero cache', async () => {
    const bk = create();
    const plain = bk.fire('AB', INSTANT);
    await flush();
    const built = new Set(
      cellsOf(words()[0] as THREE.Object3D).map(
        (cell) => ((cell.children[0] as THREE.Group).children[0] as THREE.Mesh).geometry,
      ),
    );
    clock.advance(16);
    await plain;

    const done = bk.fire('AB', { ...INSTANT, backdrop: { rows: 4 } });
    await flush();
    const rows = cellsOf(backdrop()).map(
      (cell) => ((cell.children[0] as THREE.Group).children[0] as THREE.Mesh).geometry,
    );

    expect(rows).not.toHaveLength(0);
    for (const geometry of rows) expect(built.has(geometry)).toBe(true);

    clock.advance(16);
    await done;
  });

  it('sits behind the hero, clear of its extrusion', async () => {
    const bk = create();
    const done = bk.fire('AB', { ...INSTANT, backdrop: { rows: 2 } });
    await flush();

    expect(backdrop().position.z).toBeLessThan(-DEFAULT_GLYPH_OPTIONS.depth * backdrop().scale.x);

    clock.advance(16);
    await done;
  });

  it('takes the hero fitted scale times its own, so the rows can overfill the frame', async () => {
    const bk = create();
    const done = bk.fire('AB', { ...INSTANT, backdrop: { rows: 3, scale: 1.6 } });
    await flush();
    const hero = (words()[0] as THREE.Group).scale.x;

    expect(backdrop().scale.x).toBeCloseTo(hero * 1.6, 10);

    clock.advance(16);
    await done;
  });

  it('dims the rows without touching the hero', async () => {
    const bk = create();
    const done = bk.fire('AB', { ...INSTANT, look: 'neon', backdrop: { rows: 2, dim: 0.25 } });
    await flush();
    const emissiveOf = (word: THREE.Object3D) =>
      (((cellsOf(word)[0] as THREE.Group).children[0] as THREE.Group).children[0] as THREE.Mesh)
        .material as THREE.MeshPhysicalMaterial;

    expect(emissiveOf(backdrop()).emissiveIntensity).toBeCloseTo(
      emissiveOf(words()[0] as THREE.Object3D).emissiveIntensity * 0.25,
      10,
    );

    clock.advance(16);
    await done;
  });

  it('takes no pose from the motion slots, so it is at full presence before the hero lands', async () => {
    const bk = create();
    // `slam` drives the hero in from off screen; the backdrop is placed and left alone.
    const done = bk.fire('AB', { ...INSTANT, enter: 'slam', backdrop: { rows: 2 } });
    await flush();
    clock.advance(16);
    const back = cellsOf(backdrop())[0] as THREE.Group;
    const hero = cellsOf(words()[0] as THREE.Object3D)[0] as THREE.Group;

    expect(back.position.z).toBe(0);
    expect(back.scale.x).toBe(1);
    expect(hero.position.z).not.toBe(0);

    clock.advance(2000);
    await done;
  });

  it('takes its own transform, leaving the hero square', async () => {
    const bk = create();
    const tilt = fromEuler(0, 0, -0.2);
    const done = bk.fire('AB', { ...INSTANT, backdrop: { rows: 2, transform: tilt } });
    await flush();

    expect((backdrop().children[0] as THREE.Group).rotation.z).toBeCloseTo(-0.2, 10);
    expect(((words()[0] as THREE.Group).children[0] as THREE.Group).rotation.z).toBeCloseTo(0, 10);

    clock.advance(16);
    await done;
  });

  it('caps the rows, and says so, rather than laying out whatever it was handed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bk = create();
    const done = bk.fire('A', { ...INSTANT, backdrop: { rows: 500 } });
    await flush();

    expect(cellsOf(backdrop())).toHaveLength(MAX_BACKDROP_ROWS);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(String(MAX_BACKDROP_ROWS)));

    clock.advance(16);
    await done;
  });

  it('is an ordinary second sign at rows 1', async () => {
    const bk = create();
    const done = bk.fire('AB', { ...INSTANT, backdrop: { rows: 1 } });
    await flush();

    expect(cellsOf(backdrop())).toHaveLength(2);

    clock.advance(16);
    await done;
  });

  it('comes down and is disposed with the hero when the effect settles', async () => {
    const bk = create();
    const spy = vi.spyOn(Word.prototype, 'dispose');
    const done = bk.fire('AB', { ...INSTANT, backdrop: { rows: 2 } });
    await flush();
    clock.advance(16);
    await done;

    expect(words()).toHaveLength(0);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('is still placed under reduced motion, which stops the crawl and not the rows', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const bk = create();
    const done = bk.fire('AB', { ...INSTANT, hold: 100, backdrop: { rows: 3 } });
    await flush();

    expect(cellsOf(backdrop())).toHaveLength(6);

    clock.advance(200);
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

  it('falls back to hidden when a running word is turned', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bk = create();
    const done = bk.fire('AB', { selectable: 'layer', enter: 'none', active: 'none', hold: 5000 });
    await flush();
    done.turn(fromEuler(0, 0, 0));
    expect(warn).not.toHaveBeenCalled();

    done.turn(fromEuler(0, 0.3, 0));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('a turn'));
    bk.destroy();
  });

  it('warns and names the patch when the active motion moves the letters', async () => {
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
