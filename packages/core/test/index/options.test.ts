import type * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_NAMES,
  ENTER_NAMES,
  EXIT_NAMES,
  LIGHTING_NAMES,
  LOOK_NAMES,
  POLICY_NAMES,
  wantsBloom,
} from '../../src/index.js';
import type { Vec3 } from '../../src/pose.js';
import { type EnvPatch, sweep, track } from '../../src/render/lighting.js';
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
  TAU,
  teardown,
  wordMaterials,
  words,
} from './harness.js';

const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('opentype.js', () => ({ parse }));

beforeEach(setup);
afterEach(teardown);

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
      'ice',
      'sequin',
      'pave',
      'bezel',
      'carved',
      'tiara',
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
      patch: { period: 1000, at: () => ({ gain: g }) },
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

  it('turns a running word to whatever turn() hands it', async () => {
    const bk = create();
    const done = bk.fire('HI', { ...INSTANT, hold: 5000, transform: fromEuler(0, 0.2, 0) });
    await flush();
    clock.advance(16);

    done.turn(fromEuler(0.1, 0.5, 0));
    const inner = (words()[0] as THREE.Group).children[0] as THREE.Group;
    expect(inner.rotation.x).toBeCloseTo(0.1, 6);
    expect(inner.rotation.y).toBeCloseTo(0.5, 6);
    expect(stage().camera.rotation.y).toBe(0);
    bk.destroy();
  });

  it('opens on a turn that arrived before the word was built', async () => {
    const bk = create();
    const done = bk.fire('HI', { ...INSTANT, hold: 5000, transform: fromEuler(0, 0.2, 0) });
    done.turn(fromEuler(0, 0.7, 0));
    await flush();

    const inner = (words()[0] as THREE.Group).children[0] as THREE.Group;
    expect(inner.rotation.y).toBeCloseTo(0.7, 6);
    bk.destroy();
  });

  it('takes a turn after the fire has settled without complaint', async () => {
    const bk = create();
    const done = bk.fire('HI', INSTANT);
    await flush();
    clock.advance(16);
    await done;

    expect(() => done.turn(fromEuler(0, 1, 0))).not.toThrow();
    bk.destroy();
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

describe('caller-supplied motion', () => {
  it('accepts a patch in place of a name', async () => {
    const seen: number[] = [];
    const mine = {
      duration: 100,
      at: (t: number) => {
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

  it('layers several patches in one slot', async () => {
    const lift = { duration: 100, at: () => ({ position: [0, 1, 0] as Vec3 }) };
    const shift = { duration: 100, at: () => ({ position: [2, 0, 0] as Vec3 }) };

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

  it('drives the environment from a caller-supplied patch', async () => {
    const tip: EnvPatch = { period: 0, at: () => ({ yaw: 0.4, pitch: 0.2 }) };

    const bk = create();
    void bk.fire('HI', { ...LIT, lighting: tip });
    await flush();
    clock.advance(16);

    expect(envY()).toBeCloseTo(0.4, 6);
    expect(stage().scene.environmentRotation.x).toBeCloseTo(0.2, 6);
    bk.destroy();
  });

  it('turns the studio on the materials, which each carry their own copy of it', async () => {
    const tip: EnvPatch = { period: 0, at: () => ({ yaw: 0.4, pitch: 0.2 }) };

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

  it('layers an array of names and patches onto both axes at once', async () => {
    const tip: EnvPatch = { period: 0, at: () => ({ pitch: 0.25 }) };

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

  it('hands a patch that holds still a finite phase rather than dividing by its zero period', async () => {
    const seen: number[] = [];
    const held: EnvPatch = {
      period: 0,
      at: (phase) => {
        seen.push(phase);
        return { yaw: phase };
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
    // The first frame is the run's rest; the follow starts closing on the second.
    clock.advance(16);
    clock.advance(16);
    const afterOne = envY();
    for (let i = 0; i < 40; i++) clock.advance(16);

    expect(afterOne).toBeGreaterThan(0);
    // Rebuilding the slot per frame would hand back a fresh patch easing from rest every time, so
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

describe('mixed name and patch slots', () => {
  it('resolves a built-in name sitting alongside a caller patch', async () => {
    const lift = { duration: 1000, at: () => ({ position: [0, 1, 0] as Vec3 }) };

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
