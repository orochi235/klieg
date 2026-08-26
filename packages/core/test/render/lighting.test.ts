import { describe, expect, it } from 'vitest';
import {
  ENV_PIECES,
  type EnvPiece,
  type LightingName,
  mergeEnv,
  type ResolvedEnv,
  resolveLighting,
  still,
  sweep,
  track,
} from '../../src/render/lighting.js';

const CTX = { pointer: null, pointerInWord: null, dt: 16 };

const NAMES: LightingName[] = ['sweep', 'static', 'pointer'];
const TAU = Math.PI * 2;

describe('sweep', () => {
  it('turns a full rotation over its own period', () => {
    const piece = sweep({ periodMs: 1000 });
    expect(piece.duration).toBe(1000);
    expect(piece.env(0, CTX).yaw).toBeCloseTo(0);
    expect(piece.env(0.5, CTX).yaw).toBeCloseTo(Math.PI);
  });

  it('falls back to its own preset period', () => {
    const piece = sweep();
    expect(piece.duration).toBe(3400);
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

  // The value FrameCtx.dt carries under reduced motion, where one frame stands for the whole run.
  it('snaps rather than diverging on the infinite frame reduced motion renders', () => {
    const piece = track({ yawRange: 1, pitchRange: 0.5 });
    const ctx = { pointer: { x: 1, y: -1 }, pointerInWord: null, dt: Number.POSITIVE_INFINITY };
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

  // A fixed fraction per frame would travel twice as far per second at 120Hz as at 60Hz.
  it('eases by elapsed time rather than by frame, so refresh rate does not set the speed', () => {
    const slow = track({ yawRange: 1, followMs: 100 });
    const fast = track({ yawRange: 1, followMs: 100 });
    const at = (dt: number) => ({ pointer: { x: 1, y: 0 }, pointerInWord: null, dt });

    for (let i = 0; i < 30; i++) slow.env(0, at(16.7));
    for (let i = 0; i < 60; i++) fast.env(0, at(8.35));

    expect(fast.env(0, at(0)).yaw).toBeCloseTo(slow.env(0, at(0)).yaw as number, 4);
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
    expect(ENV_PIECES[name]().duration).toBe(sweep().duration);
    expect(ENV_PIECES.sweep({ periodMs: 200 }).duration).toBe(200);
    expect(ENV_PIECES.pointer({ yawRange: 2, followMs: 0 }).duration).toBe(0);
  });

  it('maps each name to the piece that mode describes', () => {
    expect(ENV_PIECES.sweep().duration).toBe(sweep().duration);
    expect(ENV_PIECES.sweep().env(0.5, CTX).yaw).toBeCloseTo(Math.PI);

    expect(mergeEnv([ENV_PIECES.static().env(0.5, CTX)])).toEqual({ yaw: 0, pitch: 0 });

    const pointer = ENV_PIECES.pointer();
    const ctx = { pointer: { x: 1, y: 0 }, pointerInWord: null, dt: 100_000 };
    pointer.env(0, ctx);
    expect(mergeEnv([pointer.env(0, ctx)]).yaw).toBeGreaterThan(0);
  });
});

describe('resolveLighting', () => {
  const mine: EnvPiece = { duration: 0, env: () => ({ pitch: 0.5 }) };

  it('resolves a bare name through the piece its factory builds', () => {
    const [piece] = resolveLighting('sweep');

    expect(piece?.duration).toBe(sweep().duration);
    expect(piece?.env(0.25, CTX)).toEqual(sweep().env(0.25, CTX));
  });

  it('hands back a bare piece untouched rather than rebuilding it', () => {
    expect(resolveLighting(mine)).toEqual([mine]);
    expect(resolveLighting(mine)[0]).toBe(mine);
  });

  it('keeps an array of names and pieces in the order it was given', () => {
    const resolved = resolveLighting(['static', mine, 'sweep']);

    expect(resolved).toHaveLength(3);
    expect(resolved[0]?.duration).toBe(still().duration);
    expect(resolved[1]).toBe(mine);
    expect(resolved[2]?.duration).toBe(sweep().duration);
  });

  it('resolves every name in the union', () => {
    for (const name of NAMES) expect(resolveLighting(name)).toHaveLength(1);
  });

  it('gives each resolution its own piece, so two runs cannot share tracked state', () => {
    const [first] = resolveLighting('pointer');
    const [second] = resolveLighting('pointer');

    expect(first).not.toBe(second);
  });
});
