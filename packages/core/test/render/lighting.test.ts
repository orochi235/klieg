import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ENV_PIECES,
  envRotationAt,
  LIGHTING,
  type LightingName,
  mergeEnv,
  PointerLight,
  still,
  sweep,
  track,
} from '../../src/render/lighting.js';

const CTX = { pointer: null, pointerInWord: null, dt: 16 };

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

describe('sweep', () => {
  it('turns a full rotation over its own period', () => {
    const piece = sweep({ periodMs: 1000 });
    expect(piece.duration).toBe(1000);
    expect(piece.env(0, CTX).yaw).toBeCloseTo(0);
    expect(piece.env(0.5, CTX).yaw).toBeCloseTo(Math.PI);
  });

  it('falls back to the sweep preset period', () => {
    const piece = sweep();
    expect(piece.duration).toBe(LIGHTING.sweep.periodMs);
    expect(piece.env(0.25, CTX).yaw).toBeCloseTo(TAU / 4);
    expect(piece.env(1, CTX).yaw).toBeCloseTo(TAU);
  });

  it('turns yaw only, leaving pitch to other layers', () => {
    expect(mergeEnv([sweep().env(0.375, CTX)])).toEqual({ yaw: TAU * 0.375, pitch: 0 });
  });
});

describe('still', () => {
  it('holds flat forever and everywhere', () => {
    const piece = still();
    expect(piece.duration).toBe(0);
    expect(mergeEnv([piece.env(0, CTX)])).toEqual({ yaw: 0, pitch: 0 });
    expect(mergeEnv([piece.env(0.7, CTX)])).toEqual({ yaw: 0, pitch: 0 });
  });
});

describe('mergeEnv', () => {
  it('rests flat', () => {
    expect(mergeEnv([])).toEqual({ yaw: 0, pitch: 0 });
  });

  // Additive, like the pose compositor: two layers must both be visible in the result.
  it('sums yaw and pitch across layers', () => {
    const merged = mergeEnv([{ yaw: 1, pitch: 0.2 }, { yaw: 0.5 }, { pitch: -0.1 }]);
    expect(merged.yaw).toBeCloseTo(1.5);
    expect(merged.pitch).toBeCloseTo(0.1);
  });

  it('keeps each axis out of the other', () => {
    expect(mergeEnv([{ yaw: 3 }])).toEqual({ yaw: 3, pitch: 0 });
    expect(mergeEnv([{ pitch: 3 }])).toEqual({ yaw: 0, pitch: 3 });
  });
});

describe('track', () => {
  it('holds the static pose until a pointer has been seen', () => {
    const piece = track();
    piece.env(0, CTX);
    expect(piece.env(0, CTX)).toEqual({ yaw: 0, pitch: 0 });
  });

  it('leaves the static pose once a pointer arrives', () => {
    const piece = track();
    piece.env(0, CTX);
    expect(piece.env(0, CTX)).toEqual({ yaw: 0, pitch: 0 });

    const ctx = { pointer: { x: 1, y: 1 }, pointerInWord: null, dt: 16 };
    const out = piece.env(0, ctx);
    expect(out.yaw as number).toBeGreaterThan(0);
    expect(out.pitch as number).toBeGreaterThan(0);
  });

  it('swings less on pitch than on yaw', () => {
    const piece = track();
    const ctx = { pointer: { x: -1, y: -1 }, pointerInWord: null, dt: 100_000 };
    piece.env(0, ctx);
    const out = piece.env(0, ctx);
    expect(Math.abs(out.pitch as number)).toBeLessThan(Math.abs(out.yaw as number));
  });

  it('takes its ranges from the caller', () => {
    const piece = track({ yawRange: 1, pitchRange: 0.5, followMs: 1 });
    const ctx = { pointer: { x: 1, y: 1 }, pointerInWord: null, dt: 100_000 };
    piece.env(0, ctx);
    const out = piece.env(0, ctx);
    expect(out.yaw).toBeCloseTo(1);
    expect(out.pitch).toBeCloseTo(0.5);
  });

  // A symmetric pointer cannot tell yaw-from-x apart from yaw-from-y.
  it('drives yaw from x and pitch from y', () => {
    const piece = track({ yawRange: 1, pitchRange: 0.5, followMs: 1 });
    const ctx = { pointer: { x: 1, y: -1 }, pointerInWord: null, dt: 100_000 };
    piece.env(0, ctx);
    const out = piece.env(0, ctx);
    expect(out.yaw).toBeCloseTo(1);
    expect(out.pitch).toBeCloseTo(-0.5);
  });

  it('follows the pointer partway in a single short frame', () => {
    const piece = track({ yawRange: 1, pitchRange: 1, followMs: 100 });
    const ctx = { pointer: { x: 1, y: 1 }, pointerInWord: null, dt: 100 };
    const out = piece.env(0, ctx);
    expect(out.yaw).toBeCloseTo(1 - Math.exp(-1), 6);
  });

  it('never turns on the clock', () => {
    const piece = track();
    expect(piece.duration).toBe(0);
    const ctx = { pointer: { x: 1, y: 0 }, pointerInWord: null, dt: 100_000 };
    piece.env(0, ctx);
    const settled = piece.env(0.6, ctx).yaw;
    expect(piece.env(0.9, ctx).yaw).toBeCloseTo(settled as number, 10);
  });
});

describe('ENV_PIECES', () => {
  it('has an entry for every lighting name', () => {
    expect(Object.keys(ENV_PIECES).sort()).toEqual([...NAMES].sort());
  });

  it('maps each name to the piece that mode describes', () => {
    expect(ENV_PIECES.sweep().duration).toBe(LIGHTING.sweep.periodMs);
    expect(ENV_PIECES.sweep().env(0.5, CTX).yaw).toBeCloseTo(Math.PI);

    expect(mergeEnv([ENV_PIECES.static().env(0.5, CTX)])).toEqual({ yaw: 0, pitch: 0 });

    const pointer = ENV_PIECES.pointer();
    const ctx = { pointer: { x: 1, y: 0 }, pointerInWord: null, dt: 100_000 };
    pointer.env(0, ctx);
    expect(pointer.env(0, ctx).yaw as number).toBeGreaterThan(0);
  });
});
