import { describe, expect, it } from 'vitest';
import {
  ENV_PATCHES,
  EnvFrame,
  type EnvPatch,
  type EnvPose,
  type LightingName,
  mergeEnv,
  resolveLighting,
  still,
  sweep,
  track,
} from '../../src/render/lighting.js';
import { NO_CTX, voice } from '../effects/ctx.js';

const NAMES: LightingName[] = ['sweep', 'static', 'pointer'];
const TAU = Math.PI * 2;

describe('sweep', () => {
  it('turns a full rotation over its own period', () => {
    const patch = sweep({ periodMs: 1000 });
    expect(patch.period).toBe(1000);
    expect(patch.at(0, NO_CTX).yaw).toBeCloseTo(0);
    expect(patch.at(0.5, NO_CTX).yaw).toBeCloseTo(Math.PI);
  });

  it('falls back to its own preset period', () => {
    const patch = sweep();
    expect(patch.period).toBe(3400);
    expect(patch.at(0.25, NO_CTX).yaw).toBeCloseTo(TAU / 4);
    expect(patch.at(1, NO_CTX).yaw).toBeCloseTo(TAU);
  });

  it('turns yaw only, leaving pitch to other layers', () => {
    expect(mergeEnv([sweep().at(0.375, NO_CTX)])).toEqual({ yaw: TAU * 0.375, pitch: 0 });
  });
});

describe('still', () => {
  it('holds flat forever and everywhere', () => {
    const patch = still();
    expect(patch.period).toBe(0);
    expect(mergeEnv([patch.at(0, NO_CTX)])).toEqual({ yaw: 0, pitch: 0 });
    expect(mergeEnv([patch.at(0.7, NO_CTX)])).toEqual({ yaw: 0, pitch: 0 });
  });
});

describe('mergeEnv', () => {
  it('rests flat', () => {
    const merged: EnvPose = mergeEnv([]);
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

describe('layered env patches', () => {
  // The shape the option documents: ['sweep', track({ pitchRange: 0.1 })].
  it('takes yaw from both layers and pitch from the only patch that sets it', () => {
    const rake = sweep({ periodMs: 1000 });
    const aim = track({ yawRange: 1, pitchRange: 0.1, followMs: 0 });
    const v = voice();
    const pointer = { x: 1, y: -1 };
    aim.at(0, v({ pointer, now: 0 }));
    const setting = v({ pointer, now: 16 });

    const merged = mergeEnv([rake.at(0.5, setting), aim.at(0, setting)]);

    expect(merged.yaw).toBeCloseTo(Math.PI + 1);
    expect(merged.pitch).toBeCloseTo(-0.1);
  });
});

describe('track', () => {
  it('holds the static pose until a pointer has been seen', () => {
    const patch = track();
    const v = voice();
    patch.at(0, v({ now: 0 }));
    expect(patch.at(0, v({ now: 16 }))).toEqual({ yaw: 0, pitch: 0 });
  });

  it('leaves the static pose once a pointer arrives', () => {
    const patch = track();
    const v = voice();
    patch.at(0, v({ now: 0 }));
    expect(patch.at(0, v({ now: 16 }))).toEqual({ yaw: 0, pitch: 0 });

    const out = mergeEnv([patch.at(0, v({ pointer: { x: 1, y: 1 }, now: 32 }))]);
    expect(out.yaw).toBeGreaterThan(0);
    expect(out.pitch).toBeGreaterThan(0);
  });

  it('starts from rest on its first frame, wherever the pointer is', () => {
    const patch = track({ yawRange: 1, pitchRange: 0.5, followMs: 0 });
    expect(patch.at(0, voice()({ pointer: { x: 1, y: -1 }, now: 0 }))).toEqual({
      yaw: 0,
      pitch: 0,
    });
  });

  it('swings less on pitch than on yaw', () => {
    const patch = track();
    const v = voice();
    const pointer = { x: -1, y: -1 };
    patch.at(0, v({ pointer, now: 0 }));
    const out = patch.at(0, v({ pointer, now: 100_000 }));
    expect(Math.abs(out.pitch as number)).toBeLessThan(Math.abs(out.yaw as number));
  });

  it('takes its ranges from the caller', () => {
    const patch = track({ yawRange: 1, pitchRange: 0.5, followMs: 1 });
    const v = voice();
    const pointer = { x: 1, y: 1 };
    patch.at(0, v({ pointer, now: 0 }));
    const out = patch.at(0, v({ pointer, now: 100_000 }));
    expect(out.yaw).toBeCloseTo(1);
    expect(out.pitch).toBeCloseTo(0.5);
  });

  // A symmetric pointer cannot tell yaw-from-x apart from yaw-from-y.
  it('drives yaw from x and pitch from y', () => {
    const patch = track({ yawRange: 1, pitchRange: 0.5, followMs: 1 });
    const v = voice();
    const pointer = { x: 1, y: -1 };
    patch.at(0, v({ pointer, now: 0 }));
    const out = patch.at(0, v({ pointer, now: 100_000 }));
    expect(out.yaw).toBeCloseTo(1);
    expect(out.pitch).toBeCloseTo(-0.5);
  });

  // followMs 0 on a zero-length gap is exp(-0/0) = NaN, and an eased value never recovers from it.
  it('snaps rather than going NaN when the follow period is zero', () => {
    const patch = track({ yawRange: 1, pitchRange: 0.5, followMs: 0 });
    const v = voice();
    const pointer = { x: 1, y: -1 };
    patch.at(0, v({ pointer, now: 0, dt: 0 }));
    const out = patch.at(0, v({ pointer, now: 16, dt: 0 }));
    expect(out.yaw).toBeCloseTo(1);
    expect(out.pitch).toBeCloseTo(-0.5);
  });

  it('snaps rather than diverging when the follow period is negative', () => {
    const patch = track({ yawRange: 1, pitchRange: 0.5, followMs: -100 });
    const v = voice();
    const pointer = { x: 1, y: -1 };
    for (let i = 0; i < 5; i++) patch.at(0, v({ pointer, now: i * 16 }));
    const out = patch.at(0, v({ pointer, now: 5 * 16 }));
    expect(out.yaw).toBeCloseTo(1);
    expect(out.pitch).toBeCloseTo(-0.5);
  });

  // The dt blits hands a signal under reduced motion, where one frame stands for the whole run.
  it('snaps on the first frame under reduced motion rather than starting from rest', () => {
    const patch = track({ yawRange: 1, pitchRange: 0.5 });
    const out = patch.at(
      0,
      voice()({ pointer: { x: 1, y: -1 }, dt: Number.POSITIVE_INFINITY, now: 0 }),
    );
    expect(out.yaw).toBeCloseTo(1);
    expect(out.pitch).toBeCloseTo(-0.5);
  });

  it('snaps rather than going NaN when the follow period is NaN', () => {
    const patch = track({ yawRange: 1, pitchRange: 0.5, followMs: Number.NaN });
    const v = voice();
    const pointer = { x: 1, y: -1 };
    patch.at(0, v({ pointer, now: 0 }));
    const out = patch.at(0, v({ pointer, now: 16 }));
    expect(out.yaw).toBeCloseTo(1);
    expect(out.pitch).toBeCloseTo(-0.5);
  });

  it('holds the snapped pose after a hostile frame', () => {
    const pointer = { x: 0.5, y: 0.5 };
    for (const followMs of [0, -100, Number.NaN]) {
      const patch = track({ followMs });
      const v = voice();
      patch.at(0, v({ pointer, now: 0 }));
      patch.at(0, v({ pointer, now: 16, dt: 0 }));
      const out = mergeEnv([patch.at(0, v({ pointer, now: 32 }))]);
      expect(out.yaw).toBeCloseTo(0.5 * (Math.PI / 2));
      expect(out.pitch).toBeCloseTo(0.5 * (Math.PI / 9));
    }
  });

  it('freezes at its last pose when the pointer leaves rather than easing back to rest', () => {
    const patch = track({ yawRange: 1, pitchRange: 0.5, followMs: 1 });
    const v = voice();
    const pointer = { x: 1, y: -1 };
    patch.at(0, v({ pointer, now: 0 }));
    const aimed = mergeEnv([patch.at(0, v({ pointer, now: 100_000 }))]);
    expect(aimed.yaw).toBeCloseTo(1);

    patch.at(0, v({ now: 200_000 }));
    expect(mergeEnv([patch.at(0, v({ now: 300_000 }))])).toEqual(aimed);
  });

  // A fixed fraction per frame would travel twice as far per second at 120Hz as at 60Hz.
  it('eases by elapsed time rather than by frame, so refresh rate does not set the speed', () => {
    const slow = track({ yawRange: 1, followMs: 100 });
    const fast = track({ yawRange: 1, followMs: 100 });
    const pointer = { x: 1, y: 0 };
    const atSlow = voice();
    const atFast = voice();

    let slowOut = 0;
    let fastOut = 0;
    for (let i = 0; i <= 30; i++)
      slowOut = slow.at(0, atSlow({ pointer, now: i * 16.7 })).yaw as number;
    for (let i = 0; i <= 60; i++)
      fastOut = fast.at(0, atFast({ pointer, now: i * 8.35 })).yaw as number;

    expect(slowOut).toBeGreaterThan(0);
    expect(fastOut).toBeCloseTo(slowOut, 4);
  });

  it('follows the pointer partway in a single short frame', () => {
    const patch = track({ yawRange: 1, pitchRange: 1, followMs: 100 });
    const v = voice();
    const pointer = { x: 1, y: 1 };
    patch.at(0, v({ pointer, now: 0 }));
    const out = patch.at(0, v({ pointer, now: 100 }));
    expect(out.yaw).toBeCloseTo(1 - Math.exp(-1), 6);
  });

  it('never turns on the clock', () => {
    const patch = track();
    expect(patch.period).toBe(0);
    const v = voice();
    const pointer = { x: 1, y: 0 };
    patch.at(0, v({ pointer, now: 0 }));
    const settled = mergeEnv([patch.at(0.6, v({ pointer, now: 100_000 }))]);
    expect(mergeEnv([patch.at(0.9, v({ pointer, now: 100_016 }))]).yaw).toBeCloseTo(
      settled.yaw,
      10,
    );
  });

  it('keeps its eased angle per voice, so two lighting frames sharing one track each start from rest', () => {
    const aim = track({ yawRange: 1, pitchRange: 1, followMs: 100 });
    const host = { pointer: { x: 1, y: 1 }, pointerInWord: null, now: 0 };
    const first = new EnvFrame([aim]);
    first.at(0, host);
    expect(first.at(10_000, host).yaw).toBeCloseTo(1);

    const second = new EnvFrame([aim]);
    expect(second.at(0, host)).toEqual({ yaw: 0, pitch: 0 });
    expect(second.at(100, host).yaw).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(first.at(10_100, host).yaw).toBeCloseTo(1);
  });
});

describe('ENV_PATCHES', () => {
  it('has an entry for every lighting name', () => {
    expect(Object.keys(ENV_PATCHES).sort()).toEqual([...NAMES].sort());
  });

  // An annotated Record would erase each factory's own spec parameter.
  it('keeps every factory callable by name and with its own spec', () => {
    const name: LightingName = 'sweep';
    expect(ENV_PATCHES[name]().period).toBe(sweep().period);
    expect(ENV_PATCHES.sweep({ periodMs: 200 }).period).toBe(200);
    expect(ENV_PATCHES.pointer({ yawRange: 2, followMs: 0 }).period).toBe(0);
  });

  it('maps each name to the patch that mode describes', () => {
    expect(ENV_PATCHES.sweep().period).toBe(sweep().period);
    expect(ENV_PATCHES.sweep().at(0.5, NO_CTX).yaw).toBeCloseTo(Math.PI);

    expect(mergeEnv([ENV_PATCHES.static().at(0.5, NO_CTX)])).toEqual({ yaw: 0, pitch: 0 });

    const pointer = ENV_PATCHES.pointer();
    const v = voice();
    pointer.at(0, v({ pointer: { x: 1, y: 0 }, now: 0 }));
    expect(
      mergeEnv([pointer.at(0, v({ pointer: { x: 1, y: 0 }, now: 100_000 }))]).yaw,
    ).toBeGreaterThan(0);
  });
});

describe('resolveLighting', () => {
  const mine: EnvPatch = { period: 0, at: () => ({ pitch: 0.5 }) };

  it('resolves a bare name through the patch its factory builds', () => {
    const [patch] = resolveLighting('sweep');

    expect(patch?.period).toBe(sweep().period);
    expect(patch?.at(0.25, NO_CTX)).toEqual(sweep().at(0.25, NO_CTX));
  });

  it('hands back a bare patch untouched rather than rebuilding it', () => {
    expect(resolveLighting(mine)).toEqual([mine]);
    expect(resolveLighting(mine)[0]).toBe(mine);
  });

  it('keeps an array of names and patches in the order it was given', () => {
    const resolved = resolveLighting(['static', mine, 'sweep']);

    expect(resolved).toHaveLength(3);
    expect(resolved[0]?.period).toBe(still().period);
    expect(resolved[1]).toBe(mine);
    expect(resolved[2]?.period).toBe(sweep().period);
  });

  it('resolves every name in the union', () => {
    for (const name of NAMES) expect(resolveLighting(name)).toHaveLength(1);
  });

  it('gives each resolution its own patch, so two runs cannot share tracked state', () => {
    const [first] = resolveLighting('pointer');
    const [second] = resolveLighting('pointer');

    expect(first).not.toBe(second);
  });
});
