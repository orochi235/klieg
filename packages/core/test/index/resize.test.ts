import type * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FireOptions } from '../../src/index.js';
import { Word } from '../../src/render/word.js';
import { fromEuler } from '../../src/transform.js';
import {
  clock,
  create,
  firstCell,
  flush,
  renderer,
  setup,
  stage,
  teardown,
  words,
} from './harness.js';

const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('opentype.js', () => ({ parse }));

beforeEach(setup);
afterEach(teardown);

/**
 * A square anchor, which is the aspect the stubbed mount leaves the stage at. `HELLOTHERE` is wide
 * enough in it that the width budget binds, so the fitted scale is proportional to the box width.
 */
let el: { clientWidth: number; clientHeight: number };

beforeEach(() => {
  el = { clientWidth: 300, clientHeight: 300 };
});

function anchored() {
  return create({
    placement: { kind: 'element', el: el as HTMLElement },
    target: undefined,
    bleed: 0,
  });
}

/** Mount is stubbed, so the renderer `resize` sizes has to be handed over by hand. */
function resizeTo(width: number, height = el.clientHeight): void {
  el.clientWidth = width;
  el.clientHeight = height;
  const s = stage();
  if (!s.renderer) {
    Object.assign(renderer, {
      getPixelRatio: () => 1,
      setPixelRatio: () => {},
      setSize: () => {},
    });
    s.renderer = renderer;
  }
  s.resize();
}

const hero = (): THREE.Group => words()[0] as THREE.Group;
const scaleOf = (word: THREE.Object3D = hero()) => word.scale.x;

/** The first letter's pose, which the fit never touches: it is layout space, under the fit. */
function poseOf(cell: THREE.Object3D) {
  const mesh = (cell.children[0] as THREE.Group).children[0] as THREE.Mesh;
  const material = mesh.material as THREE.MeshPhysicalMaterial;
  return {
    position: cell.position.toArray(),
    rotation: cell.rotation.toArray().slice(0, 3),
    scale: cell.scale.x,
    opacity: material.opacity,
  };
}

/** A fire's first-letter pose at `at` ms, with the anchor halved at `resizeAt` if one is given. */
async function sample(opts: FireOptions, at: number, resizeAt?: number) {
  const bk = anchored();
  const done = bk.fire('HELLOTHERE', opts);
  await flush();
  clock.advance(16);
  const wide = scaleOf();
  let t = 16;
  while (t < at) {
    if (resizeAt !== undefined && t <= resizeAt && t + 16 > resizeAt) resizeTo(150);
    clock.advance(16);
    t += 16;
  }
  const out = { pose: poseOf(firstCell()), scale: scaleOf(), wide };
  bk.destroy();
  await done;
  return out;
}

describe('a running word refits when its anchor resizes', () => {
  it("narrows a sign's word with its anchor, and grows it back", async () => {
    // What `klieg/sign` fires: no entrance, held until destroyed.
    const bk = anchored();
    const done = bk.fire('HELLOTHERE', { enter: 'none', hold: 'forever' });
    await flush();
    clock.advance(16);
    const wide = scaleOf();

    resizeTo(150);
    clock.advance(16);
    expect(scaleOf()).toBeCloseTo(wide / 2, 9);

    resizeTo(300);
    clock.advance(16);
    expect(scaleOf()).toBeCloseTo(wide, 9);

    bk.destroy();
    await done;
  });

  it.each([
    ['the entrance', { enter: 'slam', hold: 1000, exit: 'fade' }, 400],
    ['the hold', { enter: 'slam', hold: 1000, exit: 'fade' }, 1400],
    ['the exit', { enter: 'slam', hold: 1000, exit: 'fade' }, 2100],
  ] as const)(
    'keeps playing from where it was when the resize lands in %s',
    async (_, opts, at) => {
      const still = await sample(opts, at);
      const resized = await sample(opts, at, at - 100);

      // The letters stand exactly where the unresized fire has them: nothing restarted.
      expect(resized.pose.position).toEqual(still.pose.position);
      expect(resized.pose.rotation).toEqual(still.pose.rotation);
      expect(resized.pose.scale).toBe(still.pose.scale);
      expect(resized.pose.opacity).toBe(still.pose.opacity);
      // Only the fit moved.
      expect(resized.scale).toBeCloseTo(still.scale / 2, 9);
    },
  );

  it('finishes on the schedule it started on', async () => {
    const bk = anchored();
    const done = bk.fire('HELLOTHERE', { enter: 'none', exit: 'none', hold: 200 });
    let settled = false;
    void done.then(() => {
      settled = true;
    });
    await flush();
    clock.advance(16);
    resizeTo(150);
    clock.advance(100);
    await flush();
    expect(settled).toBe(false);
    clock.advance(100);
    await flush();
    expect(settled).toBe(true);
  });

  it('keeps the turn the caller gave it', async () => {
    const bk = anchored();
    const done = bk.fire('HELLOTHERE', { enter: 'none', hold: 'forever' });
    await flush();
    done.turn(fromEuler(0.2, 0.5, 0));
    clock.advance(16);
    const inner = hero().children[0] as THREE.Group;
    const turned = inner.quaternion.clone();
    const wide = scaleOf();

    resizeTo(150);
    clock.advance(16);

    expect(inner.quaternion.angleTo(turned)).toBeLessThan(1e-9);
    expect(scaleOf()).toBeCloseTo(wide / 2, 9);
    bk.destroy();
    await done;
  });

  it('refits once a frame however many resizes land in it, and not at all on a quiet one', async () => {
    const refit = vi.spyOn(Word.prototype, 'refit');
    const bk = anchored();
    const done = bk.fire('HELLOTHERE', { enter: 'none', hold: 'forever' });
    await flush();
    clock.advance(16);
    const wide = scaleOf();

    for (let w = 290; w >= 150; w -= 10) resizeTo(w);
    clock.advance(16);
    expect(refit).toHaveBeenCalledTimes(1);
    expect(scaleOf()).toBeCloseTo(wide / 2, 9);

    clock.advance(16);
    resizeTo(150);
    clock.advance(16);
    expect(refit).toHaveBeenCalledTimes(1);

    bk.destroy();
    await done;
  });

  it('holds its last fit while the anchor has no size, and refits once it has one again', async () => {
    const bk = anchored();
    const done = bk.fire('HELLOTHERE', { enter: 'none', hold: 'forever' });
    await flush();
    clock.advance(16);
    const wide = scaleOf();

    resizeTo(0, 0);
    clock.advance(16);
    expect(scaleOf()).toBe(wide);
    resizeTo(0);
    clock.advance(16);
    expect(scaleOf()).toBe(wide);

    resizeTo(150, 300);
    clock.advance(16);
    expect(scaleOf()).toBeCloseTo(wide / 2, 9);

    bk.destroy();
    await done;
  });

  it('carries the backdrop with the hero', async () => {
    const bk = anchored();
    const done = bk.fire('HELLOTHERE', {
      enter: 'none',
      hold: 'forever',
      backdrop: { rows: 3, scale: 0.8 },
    });
    await flush();
    clock.advance(16);
    const back = words()[1] as THREE.Group;
    const ratio = scaleOf(back) / scaleOf();
    const depth = back.position.z / scaleOf();

    const wide = scaleOf();
    resizeTo(150);
    clock.advance(16);

    expect(scaleOf()).toBeCloseTo(wide / 2, 9);
    expect(scaleOf(back) / scaleOf()).toBeCloseTo(ratio, 9);
    expect(back.position.z / scaleOf()).toBeCloseTo(depth, 9);
    bk.destroy();
    await done;
  });

  it('carries a stages regroup on from the same point of its move', async () => {
    const opts: FireOptions = {
      enter: 'none',
      active: 'none',
      exit: 'none',
      hold: 0,
      stages: [{ keep: (l) => l.index < 5, as: 'line', exit: 'none', hold: 60_000 }],
    };
    // One fire resized before its first frame, one partway through the regroup's move.
    const run = async (resizeAt: number) => {
      const bk = anchored();
      const done = bk.fire('HELLOTHERE', opts);
      await flush();
      const scales: number[] = [];
      for (let t = 0; t < 40; t++) {
        if (t === resizeAt) resizeTo(150);
        clock.advance(16);
        scales.push(scaleOf());
      }
      bk.destroy();
      await done;
      return scales;
    };
    const still = await run(-1);
    const early = await run(0);
    const late = await run(10);

    expect(early[39]).toBeCloseTo((still[39] as number) / 2, 9);
    // Mid-move the fit is still moving: the two agree from the frame after the late resize on.
    expect(late[11]).not.toBe(late[39]);
    for (let t = 10; t < 40; t++) expect(late[t]).toBeCloseTo(early[t] as number, 9);
  });
});
