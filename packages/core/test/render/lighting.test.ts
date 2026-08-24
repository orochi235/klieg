import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  envRotationAt,
  LIGHTING,
  type LightingName,
  PointerLight,
} from '../../src/render/lighting.js';

const NAMES: LightingName[] = ['sweep', 'static', 'pointer'];
const TAU = Math.PI * 2;

describe('LIGHTING', () => {
  it('has an entry for every name in the union', () => {
    expect(Object.keys(LIGHTING).sort()).toEqual([...NAMES].sort());
  });
});

describe('envRotationAt', () => {
  it('turns sweep a full rotation over its own period, not the active slot duration', () => {
    expect(envRotationAt('sweep', 0)).toBeCloseTo(0);
    expect(envRotationAt('sweep', LIGHTING.sweep.periodMs)).toBeCloseTo(TAU);
    expect(envRotationAt('sweep', LIGHTING.sweep.periodMs / 2)).toBeCloseTo(TAU / 2);
  });

  it('holds static still at every elapsed time', () => {
    expect(envRotationAt('static', 0)).toBe(0);
    expect(envRotationAt('static', 9999)).toBe(0);
  });

  // The clock does not aim this mode; the pointer does, and run() reads PointerLight instead.
  it('gives the clock no say over the pointer mode', () => {
    expect(envRotationAt('pointer', 0)).toBe(0);
    expect(envRotationAt('pointer', 9999)).toBe(0);
    expect(LIGHTING.pointer.tracksPointer).toBe(true);
  });

  it('keeps turning past one period rather than clamping', () => {
    expect(envRotationAt('sweep', LIGHTING.sweep.periodMs * 1.5)).toBeCloseTo(TAU * 1.5);
  });
});

describe('PointerLight', () => {
  // The suite runs headless, where innerWidth is undefined and every position would saturate.
  beforeEach(() => {
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 800);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('holds the static pose until a pointer has been seen', () => {
    const light = new PointerLight();
    light.step(16);
    light.step(16);

    expect(light.yaw).toBe(0);
    expect(light.pitch).toBe(0);
  });

  it('aims to opposite signs from opposite edges, and to centre from the middle', () => {
    const light = new PointerLight();
    const settle = () => {
      // Far past the follow constant, so this reads the target rather than the ease.
      for (let i = 0; i < 200; i++) light.step(16);
    };

    light.aimAt(0, 0);
    settle();
    const left = light.yaw;
    const top = light.pitch;
    expect(left).toBeLessThan(0);
    expect(top).toBeLessThan(0);

    light.aimAt(1000, 800);
    settle();
    expect(light.yaw).toBeCloseTo(-left, 5);
    expect(light.pitch).toBeCloseTo(-top, 5);

    light.aimAt(500, 400);
    settle();
    expect(light.yaw).toBeCloseTo(0, 5);
    expect(light.pitch).toBeCloseTo(0, 5);
  });

  it('swings less on pitch than on yaw', () => {
    const light = new PointerLight();
    light.aimAt(0, 0);
    for (let i = 0; i < 200; i++) light.step(16);

    expect(Math.abs(light.pitch)).toBeLessThan(Math.abs(light.yaw));
  });

  // A fixed fraction per frame would travel twice as far per second at 120Hz as at 60Hz.
  it('eases by elapsed time rather than by frame, so refresh rate does not set the speed', () => {
    const slow = new PointerLight();
    const fast = new PointerLight();
    slow.aimAt(0, 0);
    fast.aimAt(0, 0);

    for (let i = 0; i < 30; i++) slow.step(16.7);
    for (let i = 0; i < 60; i++) fast.step(8.35);

    expect(fast.yaw).toBeCloseTo(slow.yaw, 4);
  });

  it('never overshoots the pointer, however long a frame ran', () => {
    const light = new PointerLight();
    light.aimAt(0, 0);
    light.step(100_000);
    const settled = light.yaw;
    light.step(100_000);

    expect(light.yaw).toBeCloseTo(settled, 10);
  });
});
