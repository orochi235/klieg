import { describe, expect, it } from 'vitest';
import {
  blankPose,
  slotMovesLetters,
  Timeline,
  type TimelineOptions,
} from '../../src/motion/compositor.js';
import type { MotionPatch } from '../../src/motion/types.js';
import { NONE } from '../../src/motion/types.js';
import { type PoseDelta, REST } from '../../src/pose.js';

const patch = (duration: number, x: number): MotionPatch => ({
  duration,
  at: () => ({ position: [x, 0, 0] }),
});

const build = (hold = 100) =>
  new Timeline({
    enter: patch(100, 1),
    active: patch(50, 10),
    exit: patch(100, 100),
    hold,
    blendMs: 20,
  });

const L = { index: 0, count: 1 };

/** Every segment contributes 1, so `poseAt(t).position[0]` reads back the total segment weight. */
const unit = (duration: number): MotionPatch => ({
  duration,
  at: () => ({ position: [1, 0, 0] }),
});

const expectUnitWeight = (over: Partial<TimelineOptions> = {}) => {
  const tl = new Timeline({
    enter: unit(100),
    active: unit(50),
    exit: unit(100),
    hold: 100,
    blendMs: 20,
    ...over,
  });
  for (let t = 0; t <= tl.duration; t += 1) {
    expect(tl.poseAt(t, L).position[0], `t=${t}`).toBeCloseTo(1);
  }
};

describe('Timeline held until release', () => {
  const held = () =>
    new Timeline({
      enter: patch(100, 1),
      active: patch(50, 10),
      exit: patch(100, 100),
      hold: 'until-release',
      blendMs: 0,
    });

  it('never finishes while it is held', () => {
    const tl = held();

    expect(tl.duration).toBe(Number.POSITIVE_INFINITY);
    expect(tl.isFinished(1e9)).toBe(false);
  });

  it('keeps looping the active segment while held', () => {
    expect(held().poseAt(1e6, L).position[0]).toBe(10);
  });

  it('runs the exit once released', () => {
    const tl = held();
    tl.release(500);

    expect(tl.duration).toBe(600);
    expect(tl.isFinished(599)).toBe(false);
    expect(tl.isFinished(600)).toBe(true);
    expect(tl.poseAt(550, L).position[0]).toBe(100);
  });

  it('ignores a second release, so a double click cannot cut the exit short', () => {
    const tl = held();
    tl.release(500);
    tl.release(900);

    expect(tl.duration).toBe(600);
  });

  it('still plays a whole exit when released before the enter has finished', () => {
    const tl = held();
    tl.release(10);

    expect(tl.duration).toBe(200);
  });

  // The crossfade straddles where the active segment ends. Ending it at the release instant would put
  // the ramp's first half in the past, and the exit would jump to half weight in one frame.
  it('starts the exit from nothing at the release instant and ramps it over the blend', () => {
    const tl = new Timeline({
      enter: patch(100, 1),
      active: patch(50, 10),
      exit: patch(100, 100),
      hold: 'until-release',
      blendMs: 20,
    });
    tl.poseAt(499, L);
    tl.release(500);

    expect(tl.poseAt(500, L).position[0]).toBeCloseTo(10);
    expect(tl.poseAt(510, L).position[0]).toBeCloseTo(55);
    expect(tl.poseAt(520, L).position[0]).toBeCloseTo(100);
  });

  it('leaves a numeric hold alone', () => {
    const tl = build(100);
    tl.release(10);

    expect(tl.duration).toBe(300);
  });
});

describe('Timeline', () => {
  it('reports total duration as enter + hold + exit', () => {
    expect(build(100).duration).toBe(300);
  });

  it('is finished only past the end', () => {
    const tl = build();
    expect(tl.isFinished(299)).toBe(false);
    expect(tl.isFinished(300)).toBe(true);
  });

  it('applies only enter in the middle of the enter segment', () => {
    expect(build().poseAt(50, L).position[0]).toBe(1);
  });

  it('applies only active in the middle of the hold', () => {
    expect(build().poseAt(150, L).position[0]).toBe(10);
  });

  it('blends both segments evenly at the midpoint of the crossfade window', () => {
    // Halfway through the 20ms window straddling the enter/active boundary at t=100:
    // 0.5 of enter's 1, plus 0.5 of active's 10 sampled at its loop start.
    expect(build().poseAt(100, L).position[0]).toBeCloseTo(5.5);
  });

  it('holds total segment weight at 1 for the whole timeline', () => {
    expectUnitWeight();
  });

  it('loops the active patch rather than running it once', () => {
    const tl = build(200);
    // active duration is 50ms, so 120ms and 170ms into the hold are the same phase point
    expect(tl.poseAt(220, L)).toEqual(tl.poseAt(270, L));
  });

  it('reads the same pose at a time whether it is reached going forward or going back', () => {
    const tl = new Timeline({
      enter: { duration: 100, at: (phase: number): PoseDelta => ({ position: [phase, 0, 0] }) },
      active: {
        duration: 50,
        at: (phase: number): PoseDelta => ({ position: [10 + phase, 0, 0] }),
      },
      exit: {
        duration: 100,
        at: (phase: number): PoseDelta => ({ position: [100 * phase, 0, 0] }),
      },
      hold: 100,
      blendMs: 20,
    });
    const times = [0, 50, 95, 100, 105, 160, 195, 200, 250, 299, 300];
    const forward = times.map((t) => tl.poseAt(t, L).position[0]);
    const back = [...times].reverse().map((t) => tl.poseAt(t, L).position[0]);

    expect(back.reverse()).toEqual(forward);
  });

  it('samples the looping active patch at its wrapped phase point', () => {
    const tl = new Timeline({
      enter: patch(100, 1),
      active: { duration: 50, at: (phase: number): PoseDelta => ({ position: [phase, 0, 0] }) },
      exit: patch(100, 100),
      hold: 200,
      blendMs: 20,
    });
    expect(tl.poseAt(160, L).position[0]).toBe(0.2);
    expect(tl.poseAt(210, L).position[0]).toBe(0.2);
    expect(tl.poseAt(185, L).position[0]).toBe(0.7);
  });

  it('publishes the enter end and the active end, and moves only the latter on release', () => {
    const numeric = build(100);
    expect(numeric.enterEnd).toBe(100);
    expect(numeric.activeEnd).toBe(200);

    const held = new Timeline({
      enter: patch(100, 1),
      active: patch(50, 10),
      exit: patch(100, 100),
      hold: 'until-release',
      blendMs: 20,
    });
    expect(held.enterEnd).toBe(100);
    expect(held.activeEnd).toBe(Number.POSITIVE_INFINITY);

    held.release(500);
    // The enter is fixed; the release sets where the exit begins, half a blend later, so the
    // crossfade it centers on starts at the release itself.
    expect(held.enterEnd).toBe(100);
    expect(held.activeEnd).toBe(510);
    expect(held.duration).toBe(610);
  });
});

describe('Timeline with degenerate durations', () => {
  const degenerate = (over: Partial<TimelineOptions>) =>
    new Timeline({
      enter: patch(100, 1),
      active: patch(50, 10),
      exit: patch(100, 100),
      hold: 100,
      blendMs: 20,
      ...over,
    });

  it('gives a zero-length segment no weight at all', () => {
    const tl = degenerate({ enter: patch(0, 1) });
    expect(tl.duration).toBe(200);
    expect(tl.poseAt(0, L).position[0]).toBe(10);
    expectUnitWeight({ enter: unit(0) });
  });

  it('covers the whole timeline when the hold is zero', () => {
    const tl = degenerate({ hold: 0 });
    expect(tl.duration).toBe(200);
    expectUnitWeight({ hold: 0 });
  });

  it('does not overshoot when the hold is shorter than the blend window', () => {
    expectUnitWeight({ hold: 10 });
  });

  it('hands over cleanly at every boundary with no blend window', () => {
    const tl = degenerate({ blendMs: 0 });
    expectUnitWeight({ blendMs: 0 });
    expect(tl.poseAt(99, L).position[0]).toBe(1);
    expect(tl.poseAt(100, L).position[0]).toBe(10);
    expect(tl.poseAt(199, L).position[0]).toBe(10);
    expect(tl.poseAt(200, L).position[0]).toBe(100);
  });

  it('is finished immediately when every segment is empty', () => {
    const tl = degenerate({
      enter: patch(0, 1),
      active: patch(0, 10),
      exit: patch(0, 100),
      hold: 0,
    });
    expect(tl.duration).toBe(0);
    expect(tl.isFinished(0)).toBe(true);
    expect(tl.poseAt(0, L)).toEqual(REST);
  });
});

describe('Timeline layers', () => {
  const layered = (active: MotionPatch[]) =>
    new Timeline({
      enter: NONE,
      active,
      exit: NONE,
      hold: 100,
      blendMs: 0,
    });

  it('sums the deltas of every patch in a slot', () => {
    const tl = layered([patch(100, 1), patch(100, 10)]);

    expect(tl.poseAt(50, L).position[0]).toBe(11);
  });

  it('takes the longest duration in the slot', () => {
    const tl = new Timeline({
      enter: [patch(100, 1), patch(400, 1)],
      active: NONE,
      exit: NONE,
      hold: 0,
      blendMs: 0,
    });

    expect(tl.duration).toBe(400);
  });

  it('loops a layered active segment on the longest of its patches', () => {
    const short: MotionPatch = { duration: 100, at: (phase) => ({ position: [phase, 0, 0] }) };
    const long: MotionPatch = { duration: 400, at: () => ({}) };
    const tl = layered([short, long]);

    // Local t runs over 400ms, so 200ms in is halfway rather than back at the start.
    expect(tl.poseAt(200, L).position[0]).toBeCloseTo(0.5, 10);
  });

  it('takes a bare patch exactly as it did before slots held layers', () => {
    const one = new Timeline({
      enter: patch(100, 1),
      active: patch(50, 10),
      exit: patch(100, 100),
      hold: 100,
      blendMs: 20,
    });

    expect(one.duration).toBe(300);
    expect(one.poseAt(150, L).position[0]).toBe(10);
  });
});

describe('poseAt out-parameter', () => {
  it('writes into the pose it is given and returns it', () => {
    const tl = build(100);
    const out = blankPose();

    const returned = tl.poseAt(150, L, out);

    expect(returned).toBe(out);
    expect(out.position[0]).toBe(10);
  });

  it('resets the pose each call rather than accumulating into it', () => {
    const tl = build(100);
    const out = blankPose();

    tl.poseAt(150, L, out);
    tl.poseAt(150, L, out);

    expect(out.position[0]).toBe(10);
  });

  it('still allocates a pose when none is offered', () => {
    const tl = build(100);

    expect(tl.poseAt(150, L)).not.toBe(tl.poseAt(150, L));
  });
});

describe('slotMovesLetters', () => {
  const drift: MotionPatch = { duration: 1000, at: (phase) => ({ position: [0, phase, 0] }) };
  const tilt: MotionPatch = { duration: 1000, at: () => ({ rotation: [0, 0.2, 0] }) };
  const breathe: MotionPatch = { duration: 1000, at: (phase) => ({ scale: 1 + phase * 0.1 }) };
  const dim: MotionPatch = { duration: 1000, at: () => ({ opacity: 0.5 }) };
  const perLetter: MotionPatch = {
    duration: 1000,
    at: (_t, letter) => (letter.index === 3 ? { position: [1, 0, 0] } : {}),
  };

  it('clears a slot that never leaves rest', () => {
    expect(slotMovesLetters(NONE)).toBe(false);
    expect(slotMovesLetters([NONE, NONE])).toBe(false);
  });

  it('catches position, rotation and scale', () => {
    expect(slotMovesLetters(drift)).toBe(true);
    expect(slotMovesLetters(tilt)).toBe(true);
    expect(slotMovesLetters(breathe)).toBe(true);
  });

  it('ignores opacity, which does not move a letter', () => {
    expect(slotMovesLetters(dim)).toBe(false);
  });

  it('catches a layer that moves even when its neighbours do not', () => {
    expect(slotMovesLetters([NONE, drift])).toBe(true);
  });

  it('catches a patch that only moves one letter of the word', () => {
    expect(slotMovesLetters(perLetter)).toBe(true);
  });

  it('catches a constant offset, which misaligns without ever animating', () => {
    const lifted: MotionPatch = { duration: 1000, at: () => ({ position: [0, 2, 0] }) };
    expect(slotMovesLetters(lifted)).toBe(true);
  });
});
