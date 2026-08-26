import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ENV_PIECES,
  envRotationAt,
  LIGHTING,
  type LightingName,
  mergeEnv,
  PointerLight,
  type ResolvedEnv,
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
    const merged: ResolvedEnv = mergeEnv([]);
    expect(merged).toEqual({ yaw: 0, pitch: 0 });
  });

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

describe('layered env pieces', () => {
  // The shape the option documents: ['sweep', track({ pitchRange: 0.1 })].
  it('takes yaw from both layers and pitch from the only piece that sets it', () => {
    const rake = sweep({ periodMs: 1000 });
    const aim = track({ yawRange: 1, pitchRange: 0.1, followMs: 0 });
    const ctx = { pointer: { x: 1, y: -1 }, pointerInWord: null, dt: 16 };

    const merged = mergeEnv([rake.env(0.5, ctx), aim.env(0, ctx)]);

    expect(merged.yaw).toBeCloseTo(Math.PI + 1);
    expect(merged.pitch).toBeCloseTo(-0.1);
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
    const out = mergeEnv([piece.env(0, ctx)]);
    expect(out.yaw).toBeGreaterThan(0);
    expect(out.pitch).toBeGreaterThan(0);
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

  // followMs 0 on a dt 0 frame is exp(-0/0) = NaN, and the closure never recovers.
  it('snaps rather than going NaN when the follow period is zero', () => {
    const piece = track({ yawRange: 1, pitchRange: 0.5, followMs: 0 });
    const out = piece.env(0, { pointer: { x: 1, y: -1 }, pointerInWord: null, dt: 0 });
    expect(out.yaw).toBeCloseTo(1);
    expect(out.pitch).toBeCloseTo(-0.5);
  });

  it('snaps rather than diverging when the follow period is negative', () => {
    const piece = track({ yawRange: 1, pitchRange: 0.5, followMs: -100 });
    const ctx = { pointer: { x: 1, y: -1 }, pointerInWord: null, dt: 16 };
    for (let i = 0; i < 5; i++) piece.env(0, ctx);
    const out = piece.env(0, ctx);
    expect(out.yaw).toBeCloseTo(1);
    expect(out.pitch).toBeCloseTo(-0.5);
  });

  it('snaps rather than going NaN when the follow period is NaN', () => {
    const piece = track({ yawRange: 1, pitchRange: 0.5, followMs: Number.NaN });
    const out = piece.env(0, { pointer: { x: 1, y: -1 }, pointerInWord: null, dt: 16 });
    expect(out.yaw).toBeCloseTo(1);
    expect(out.pitch).toBeCloseTo(-0.5);
  });

  it('holds the snapped pose after a hostile frame', () => {
    const pointer = { x: 0.5, y: 0.5 };
    for (const followMs of [0, -100, Number.NaN]) {
      const piece = track({ followMs });
      piece.env(0, { pointer, pointerInWord: null, dt: 0 });
      const out = mergeEnv([piece.env(0, { pointer, pointerInWord: null, dt: 16 })]);
      expect(out.yaw).toBeCloseTo(0.5 * (Math.PI / 2));
      expect(out.pitch).toBeCloseTo(0.5 * (Math.PI / 9));
    }
  });

  it('freezes at its last pose when the pointer leaves rather than easing back to rest', () => {
    const piece = track({ yawRange: 1, pitchRange: 0.5, followMs: 1 });
    const ctx = { pointer: { x: 1, y: -1 }, pointerInWord: null, dt: 100_000 };
    piece.env(0, ctx);
    const aimed = mergeEnv([piece.env(0, ctx)]);
    expect(aimed.yaw).toBeCloseTo(1);

    const gone = { pointer: null, pointerInWord: null, dt: 100_000 };
    piece.env(0, gone);
    expect(mergeEnv([piece.env(0, gone)])).toEqual(aimed);
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
    const settled = mergeEnv([piece.env(0.6, ctx)]);
    expect(mergeEnv([piece.env(0.9, ctx)]).yaw).toBeCloseTo(settled.yaw, 10);
  });
});

describe('ENV_PIECES', () => {
  it('has an entry for every lighting name', () => {
    expect(Object.keys(ENV_PIECES).sort()).toEqual([...NAMES].sort());
  });

  // An annotated Record would erase each factory's own spec parameter.
  it('keeps every factory callable by name and with its own spec', () => {
    const name: LightingName = 'sweep';
    expect(ENV_PIECES[name]().duration).toBe(LIGHTING.sweep.periodMs);
    expect(ENV_PIECES.sweep({ periodMs: 200 }).duration).toBe(200);
    expect(ENV_PIECES.pointer({ yawRange: 2, followMs: 0 }).duration).toBe(0);
  });

  it('maps each name to the piece that mode describes', () => {
    expect(ENV_PIECES.sweep().duration).toBe(LIGHTING.sweep.periodMs);
    expect(ENV_PIECES.sweep().env(0.5, CTX).yaw).toBeCloseTo(Math.PI);

    expect(mergeEnv([ENV_PIECES.static().env(0.5, CTX)])).toEqual({ yaw: 0, pitch: 0 });

    const pointer = ENV_PIECES.pointer();
    const ctx = { pointer: { x: 1, y: 0 }, pointerInWord: null, dt: 100_000 };
    pointer.env(0, ctx);
    expect(mergeEnv([pointer.env(0, ctx)]).yaw).toBeGreaterThan(0);
  });
});
