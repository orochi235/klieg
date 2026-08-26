import { describe, expect, it } from 'vitest';
import { linear } from '../../src/easing.js';
import { cycle, partition, transition } from '../../src/motion/build.js';
import type { LetterInfo, MotionPiece } from '../../src/motion/types.js';
import { scaleOffset } from '../../src/pose.js';

const L: LetterInfo = { index: 0, count: 1 };
const at = (index: number, count: number): LetterInfo => ({ index, count });

describe('transition', () => {
  it('relaxes a from-offset toward identity', () => {
    const piece = transition(100, { from: { position: [0, 0, -26], scale: 0.55 }, ease: linear });

    expect(piece.offset(0, L).position).toEqual([0, 0, -26]);
    expect(piece.offset(0, L).scale).toBeCloseTo(0.55, 12);
    expect(piece.offset(1, L).position).toEqual([0, 0, 0]);
    expect(piece.offset(1, L).scale).toBeCloseTo(1, 12);
  });

  it('departs from identity toward a to-offset', () => {
    const piece = transition(100, { to: { position: [0, -22, 0], opacity: 0 }, ease: linear });

    expect(piece.offset(0, L).position).toEqual([0, 0, 0]);
    expect(piece.offset(0, L).opacity).toBeCloseTo(1, 12);
    expect(piece.offset(1, L).position).toEqual([0, -22, 0]);
    expect(piece.offset(1, L).opacity).toBeCloseTo(0, 12);
  });

  it('is exactly scaleOffset(from, 1 - ease(t)), the primitive the compositor already uses', () => {
    const from = { position: [1, -2, 3] as [number, number, number], scale: 0.4, opacity: 0.2 };
    const piece = transition(100, { from, ease: linear });

    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const built = piece.offset(t, L);
      const primitive = scaleOffset(from, 1 - t);

      // Component-wise: multiplying by a zero weight yields -0 where lerping yields +0, which
      // deep equality separates and three.js does not.
      for (let i = 0; i < 3; i++) {
        expect(built.position?.[i]).toBeCloseTo(primitive.position?.[i] as number, 12);
      }
      expect(built.scale).toBeCloseTo(primitive.scale as number, 12);
      expect(built.opacity).toBeCloseTo(primitive.opacity as number, 12);
    }
  });

  it('grows a shrunk scale to 1, never toward 0', () => {
    const piece = transition(100, { from: { scale: 0.5 }, ease: linear });

    expect(piece.offset(0.5, L).scale).toBeCloseTo(0.75, 12);
    expect(piece.offset(1, L).scale).toBeCloseTo(1, 12);
  });

  it('overrides one channel with easeBy while the rest keep ease', () => {
    const piece = transition(100, {
      from: { position: [10, 0, 0], opacity: 0 },
      ease: linear,
      easeBy: { opacity: () => 1 },
    });

    // Opacity is already fully arrived at t=0; position is not.
    expect(piece.offset(0, L).opacity).toBeCloseTo(1, 12);
    expect(piece.offset(0, L).position?.[0]).toBeCloseTo(10, 12);
  });

  it('takes from as a function of the letter', () => {
    const piece = transition(100, {
      from: (letter) => ({ position: [letter.index * 2, 0, 0] }),
      ease: linear,
    });

    expect(piece.offset(0, at(3, 5)).position?.[0]).toBeCloseTo(6, 12);
  });

  it('staggers when asked, and moves as one word when not', () => {
    const staggered = transition(100, {
      from: { opacity: 0 },
      ease: linear,
      stagger: { spread: 0.5 },
    });
    const together = transition(100, { from: { opacity: 0 }, ease: linear });

    const early = staggered.offset(0.3, at(0, 5)).opacity as number;
    const late = staggered.offset(0.3, at(4, 5)).opacity as number;
    expect(early).toBeGreaterThan(late);

    expect(together.offset(0.3, at(0, 5)).opacity).toBe(together.offset(0.3, at(4, 5)).opacity);
  });

  it('reads a two-stop keyframe list the same as the from sugar', () => {
    const from = { position: [0, 5, 0] as [number, number, number], scale: 0.5 };
    const sugar = transition(100, { from, ease: linear });
    const stops = transition(100, {
      keyframes: [{ at: 0, ...from }, { at: 1 }],
      ease: linear,
    });

    for (const t of [0, 0.3, 0.7, 1]) {
      expect(stops.offset(t, L).position).toEqual(sugar.offset(t, L).position);
      expect(stops.offset(t, L).scale).toBeCloseTo(sugar.offset(t, L).scale as number, 12);
    }
  });

  it('passes through a middle keyframe on the way', () => {
    const piece = transition(100, {
      keyframes: [
        { at: 0, position: [0, 0, -20] },
        { at: 0.5, position: [0, 0, 6] },
        { at: 1, position: [0, 0, 0] },
      ],
      ease: linear,
    });

    expect(piece.offset(0.5, L).position?.[2]).toBeCloseTo(6, 12);
    expect(piece.offset(0.25, L).position?.[2]).toBeCloseTo(-7, 12);
    expect(piece.offset(1, L).position?.[2]).toBeCloseTo(0, 12);
  });

  it('holds the outer stops outside the keyframe range', () => {
    const piece = transition(100, {
      keyframes: [
        { at: 0.2, position: [1, 0, 0] },
        { at: 0.8, position: [3, 0, 0] },
      ],
      ease: linear,
    });

    expect(piece.offset(0, L).position?.[0]).toBeCloseTo(1, 12);
    expect(piece.offset(1, L).position?.[0]).toBeCloseTo(3, 12);
  });
});

describe('cycle', () => {
  it('swings a channel around its identity and returns to it', () => {
    const piece = cycle(100, { amplitude: { position: [0, 0.12, 0] } });

    expect(piece.offset(0, L).position?.[1]).toBeCloseTo(0, 12);
    expect(piece.offset(0.25, L).position?.[1]).toBeCloseTo(0.12, 12);
    expect(piece.offset(0.75, L).position?.[1]).toBeCloseTo(-0.12, 12);
  });

  it('centers a multiplicative channel on 1', () => {
    const piece = cycle(100, { amplitude: { scale: 0.035 } });

    expect(piece.offset(0, L).scale).toBeCloseTo(1, 12);
    expect(piece.offset(0.25, L).scale).toBeCloseTo(1.035, 12);
  });

  it('runs a channel at a harmonic of the fundamental', () => {
    const piece = cycle(100, {
      amplitude: { rotation: [0.03, 0.1, 0] },
      harmonic: { rotation: [2, 1, 1] },
    });

    // Double rate is back at zero by the quarter turn; the fundamental is at its peak.
    expect(piece.offset(0.25, L).rotation?.[0]).toBeCloseTo(0, 12);
    expect(piece.offset(0.25, L).rotation?.[1]).toBeCloseTo(0.1, 12);
  });

  it('offsets each letter by a phase', () => {
    const piece = cycle(100, {
      amplitude: { rotation: [0, 0.05, 0] },
      phase: (letter) => (letter.index / letter.count) * Math.PI * 2,
    });

    expect(piece.offset(0, at(0, 4)).rotation?.[1]).not.toBeCloseTo(
      piece.offset(0, at(1, 4)).rotation?.[1] as number,
      6,
    );
  });
});

describe('delayBy', () => {
  const letter: LetterInfo = { index: 0, count: 1 };

  it('holds a delayed channel at its start value through the delay', () => {
    const piece = transition(100, {
      from: { position: [10, 0, 0], scale: 2 },
      ease: linear,
      delayBy: { scale: 0.5 },
    });
    const half = piece.offset(0.5, letter);
    // Position is half done; scale has not started.
    expect(half.position?.[0]).toBeCloseTo(5);
    expect(half.scale).toBeCloseTo(2);
  });

  it('still lands the delayed channel at rest by the end of the pass', () => {
    const piece = transition(100, {
      from: { scale: 2 },
      ease: linear,
      delayBy: { scale: 0.5 },
    });
    expect(piece.offset(0.75, letter).scale).toBeCloseTo(1.5);
    expect(piece.offset(1, letter).scale).toBeCloseTo(1);
  });

  it('delays a channel departing from rest as well as one relaxing to it', () => {
    const piece = transition(100, {
      to: { position: [10, 0, 0] },
      ease: linear,
      delayBy: { position: 0.5 },
    });
    expect(piece.offset(0.5, letter).position?.[0]).toBeCloseTo(0);
    expect(piece.offset(0.75, letter).position?.[0]).toBeCloseTo(5);
  });

  it('clamps a delay of the whole pass, which would leave no span to travel over', () => {
    const piece = transition(100, {
      from: { position: [10, 0, 0] },
      ease: linear,
      delayBy: { position: 1 },
    });
    // Dividing by a zero span yields NaN, which reaches the transform as a vanished letter.
    expect(piece.offset(1, letter).position?.[0]).toBeCloseTo(0);
    expect(piece.offset(0.5, letter).position?.[0]).toBeCloseTo(10);
  });

  it('leaves undelayed channels alone', () => {
    const piece = transition(100, { from: { position: [10, 0, 0] }, ease: linear, delayBy: {} });
    expect(piece.offset(0.5, letter).position?.[0]).toBeCloseTo(5);
  });
});

describe('partition', () => {
  const kept: MotionPiece = { duration: 100, offset: () => ({ position: [1, 0, 0] }) };
  const dropped: MotionPiece = { duration: 300, offset: () => ({ position: [0, 2, 0] }) };
  const piece = partition((l) => l.index === 0, kept, dropped);

  it('runs the kept piece where the predicate holds', () => {
    expect(piece.offset(0.5, { index: 0, count: 2 }).position).toEqual([1, 0, 0]);
  });

  it('runs the dropped piece elsewhere', () => {
    expect(piece.offset(0.5, { index: 1, count: 2 }).position).toEqual([0, 2, 0]);
  });

  it('lasts as long as its longer half', () => {
    expect(piece.duration).toBe(300);
  });
});
