import type { Font } from 'opentype.js';
import type * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Vec3 } from '../../src/pose.js';
import { BloomPath } from '../../src/render/bloom.js';
import {
  clock,
  create,
  firstCell,
  flush,
  INSTANT,
  renders,
  setOnRender,
  setup,
  stage,
  stubFont,
  teardown,
  words,
} from './harness.js';

const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('opentype.js', () => ({ parse }));

beforeEach(setup);
afterEach(teardown);

describe('createKlieg', () => {
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
      setOnRender(() => {
        throw new Error('context lost');
      });
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
      const lift = { duration: 1000, at: () => ({ position: [0, 1, 0] as Vec3 }) };

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
