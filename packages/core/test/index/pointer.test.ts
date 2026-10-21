import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Host, PartInfo, Setting } from '../../src/effects/types.js';
import type { EffectSpec, FireOptions, TypePoint } from '../../src/index.js';
import { track } from '../../src/render/lighting.js';
import { fromEuler } from '../../src/transform.js';
import {
  clock,
  create,
  dispatch,
  firstCell,
  firstMesh,
  flush,
  INSTANT,
  LIT,
  listeners,
  setup,
  stage,
  stubCanvas,
  teardown,
  wordMaterials,
  words,
} from './harness.js';

const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('opentype.js', () => ({ parse }));

beforeEach(setup);
afterEach(teardown);

describe('the pointer in the setting', () => {
  const BOX = { left: 0, top: 0, width: 100, height: 100 };

  /** What one frame's setting carried, copied out: a setting is valid only during its call. */
  type Seen = Host & { dt: number };

  /** A body-wide effect patch is the only thing handed the setting the render loop builds. */
  function capture() {
    const frames: Seen[] = [];
    const parts: PartInfo[] = [];
    return {
      frames,
      parts,
      spec: {
        patch: {
          period: 1000,
          at: (_phase: number, part: PartInfo, setting: Setting) => {
            parts.push(part);
            const { pointer, pointerInWord, now } = setting.host;
            frames.push({ pointer, pointerInWord, now, dt: setting.dt });
            return {};
          },
        },
        target: { kind: 'body', by: 'index', amount: 1 },
      } as const,
    };
  }

  const last = <T>(xs: T[]): T => xs[xs.length - 1] as T;
  const looking = (spec: EffectSpec): FireOptions => ({
    enter: 'none',
    active: 'none',
    exit: 'none',
    hold: 5000,
    effects: [spec],
  });

  it('stamps every frame with the clock time it was drawn at', async () => {
    const seen = capture();
    const bk = create();
    void bk.fire('HI', looking(seen.spec));
    await flush();
    clock.advance(16);
    const first = last(seen.frames).now;
    clock.advance(16);

    expect(first).toBe(clock.now() - 16);
    expect(last(seen.frames).now).toBe(clock.now());
    bk.destroy();
  });

  it('leaves both pointers null until one has moved', async () => {
    const seen = capture();
    const bk = create();
    void bk.fire('HI', looking(seen.spec));
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
    void bk.fire('HELLO\nTHERE', looking(seen.spec));
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
    void bk.fire('HI', looking(seen.spec));
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
    void bk.fire('HI', looking(seen.spec));
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

    // Still nothing: this sign runs no patch that asks where the cursor is.
    dispatch('pointermove', { clientX: 40, clientY: 40 });
    clock.advance(16);

    expect(reads).toBe(0);
    bk.destroy();
  });

  it('measures the canvas once a frame for a sign whose patch does read the pointer', async () => {
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

    // Once per frame however many patches ask, and never cached across frames: the box can move
    // without a resize or a scroll.
    clock.advance(16);

    expect(reads).toBe(2);
    bk.destroy();
  });

  it('reports the frame delta the clock advanced by', async () => {
    const seen = capture();
    const bk = create();
    void bk.fire('HI', looking(seen.spec));
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
    void bk.fire('HI', looking(seen.spec));
    await flush();
    clock.advance(16);

    expect(last(seen.frames).dt).toBe(Number.POSITIVE_INFINITY);
    bk.destroy();
  });
});

describe('pointOn', () => {
  const BOX = { left: 0, top: 0, width: 100, height: 100 };
  const HELD = { ...INSTANT, hold: 5000 } as const;

  /** Where a world point is drawn on the stubbed canvas — projected, where `pointOn` unprojects. */
  function clientOf(world: THREE.Vector3): { x: number; y: number } {
    const camera = stage().camera;
    camera.updateMatrixWorld();
    const ndc = world.clone().project(camera);
    return { x: ((ndc.x + 1) / 2) * BOX.width, y: ((1 - ndc.y) / 2) * BOX.height };
  }

  function firstLetterBox(): THREE.Box3 {
    (words()[0] as THREE.Group).updateWorldMatrix(true, true);
    return new THREE.Box3().setFromObject(firstMesh());
  }

  async function onScreen(options: FireOptions = HELD) {
    const bk = create();
    const done = bk.fire('HI', options);
    await flush();
    stubCanvas(BOX);
    clock.advance(16);
    return { bk, done };
  }

  it('is null with nothing on screen', () => {
    expect(create().pointOn(50, 50)).toBeNull();
  });

  it('lands on the front face of the letter drawn under the cursor', async () => {
    const { bk } = await onScreen();
    const box = firstLetterBox();
    const aim = clientOf(box.getCenter(new THREE.Vector3()));
    const at = bk.pointOn(aim.x, aim.y) as TypePoint;

    expect(at).not.toBeNull();
    expect(at.z).toBeCloseTo(box.max.z, 5);
    const back = clientOf(new THREE.Vector3(at.x, at.y, at.z));
    expect(back.x).toBeCloseTo(aim.x, 3);
    expect(back.y).toBeCloseTo(aim.y, 3);
    bk.destroy();
  });

  it('reports how many world units a pixel spans at the depth of the hit', async () => {
    const { bk } = await onScreen();
    const aim = clientOf(firstLetterBox().getCenter(new THREE.Vector3()));
    const at = bk.pointOn(aim.x, aim.y) as TypePoint;

    const a = clientOf(new THREE.Vector3(at.x, at.y, at.z));
    const b = clientOf(new THREE.Vector3(at.x + 10 * at.unitsPerPx, at.y, at.z));
    expect(b.x - a.x).toBeCloseTo(10, 3);
    bk.destroy();
  });

  it('is null off the letters and outside the canvas', async () => {
    const { bk } = await onScreen();
    expect(bk.pointOn(1, 1)).toBeNull();
    expect(bk.pointOn(500, 50)).toBeNull();
    bk.destroy();
  });

  // The layout-space pointer projects onto one plane and ignores a transform; the hit must not.
  it('follows a transform onto a letter turned out of the plane', async () => {
    const { bk } = await onScreen({ ...HELD, transform: fromEuler(0, 0.6, 0) });
    const box = firstLetterBox();
    const aim = clientOf(box.getCenter(new THREE.Vector3()));
    const at = bk.pointOn(aim.x, aim.y) as TypePoint;

    expect(at).not.toBeNull();
    const back = clientOf(new THREE.Vector3(at.x, at.y, at.z));
    expect(back.x).toBeCloseTo(aim.x, 3);
    expect(at.z).toBeLessThan(box.max.z - 1e-3);
    expect(at.z).toBeGreaterThan(box.min.z + 1e-3);
    bk.destroy();
  });

  it('passes through letters that have faded out', async () => {
    const { bk } = await onScreen();
    const aim = clientOf(firstLetterBox().getCenter(new THREE.Vector3()));
    for (const material of wordMaterials()) material.opacity = 0;
    expect(bk.pointOn(aim.x, aim.y)).toBeNull();
    bk.destroy();
  });

  it('answers nothing once the fire has left', async () => {
    const { bk, done } = await onScreen(INSTANT);
    await done;
    expect(bk.pointOn(50, 50)).toBeNull();
    bk.destroy();
  });
});

describe('pointOn inWord', () => {
  const BOX = { left: 0, top: 0, width: 100, height: 100 };

  async function hitFirstLetter(options: FireOptions) {
    const bk = create();
    void bk.fire('HI', options);
    await flush();
    stubCanvas(BOX);
    clock.advance(16);
    const camera = stage().camera;
    camera.updateMatrixWorld();
    (words()[0] as THREE.Group).updateWorldMatrix(true, true);
    const center = new THREE.Box3().setFromObject(firstMesh()).getCenter(new THREE.Vector3());
    const ndc = center.project(camera);
    const at = bk.pointOn(((ndc.x + 1) / 2) * BOX.width, ((1 - ndc.y) / 2) * BOX.height);
    return { bk, at: at as TypePoint };
  }

  // The stub glyph is a 0.5 em box standing on the letter's origin, so the hit's layout point has
  // to land inside that box: in world units, or with the transform left in, it lands far outside.
  for (const [name, transform] of [
    ['front-on', undefined],
    ['turned', fromEuler(0, 0.6, 0)],
  ] as const) {
    it(`reports the hit in the word's layout space, ${name}`, async () => {
      const { bk, at } = await hitFirstLetter({ ...INSTANT, hold: 5000, transform });
      const origin = firstCell().position;
      expect(at.inWord.x).toBeGreaterThanOrEqual(origin.x - 0.05);
      expect(at.inWord.x).toBeLessThanOrEqual(origin.x + 0.55);
      expect(Math.abs(at.inWord.y - origin.y)).toBeLessThanOrEqual(1);
      bk.destroy();
    });
  }
});
