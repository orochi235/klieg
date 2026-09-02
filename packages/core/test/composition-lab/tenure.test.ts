import { describe, expect, it } from 'vitest';
import { syntheticPool } from '../../dev/composition-lab/src/pool.js';
import { type PassSamples, samplePass } from '../../dev/composition-lab/src/sample.js';
import { tenureAndJump } from '../../dev/composition-lab/src/tenure.js';
import { EffectFrame, planEffects } from '../../src/effects/frame.js';
import { flicker } from '../../src/effects/pieces.js';
import { roving } from '../../src/effects/roving.js';
import type { PartInfo } from '../../src/effects/types.js';
import { NO_CTX } from '../effects/ctx.js';

function parts(count: number): PartInfo[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'run' as const,
    index,
    count,
    letter: { index: 0, count: 1 },
    x: index,
    y: 0,
    ink: { minX: index, maxX: index, minY: 0, maxY: 0 },
    at: index / count,
    span: 1 / count,
  }));
}

/** `moved` is the only field tenure reads; the rest of a PassSamples is filler. */
function samples(moved: boolean[][]): PassSamples {
  const width = (moved[0] as boolean[]).length;
  const grid = (fill: number) => moved.map(() => new Array<number>(width).fill(fill));
  return {
    samples: width,
    gain: grid(1),
    scale: grid(1),
    dark: grid(0),
    crawl: grid(0),
    light: grid(0),
    color: grid(-1),
    touched: moved.map((row) => row.some(Boolean)),
    moved,
  };
}

describe('tenureAndJump', () => {
  it("measures a holder's stretch as the pass over the handovers in it", () => {
    const s = samples([
      [true, true, false, false],
      [false, false, true, true],
    ]);
    const r = tenureAndJump(s, parts(2), 1000);
    expect(r.handovers).toBe(2);
    expect(r.meanTenureMs).toBe(500);
  });

  // The pass loops, so the holder at the last sample also hands back to the holder at the
  // first: one handover mid-pass, one more closing the seam.
  it('counts a handover and measures how far it jumped, seam included', () => {
    const s = samples([
      [true, false],
      [false, true],
    ]);
    const r = tenureAndJump(s, parts(2), 1000);
    expect(r.handovers).toBe(2);
    expect(r.meanJumpParts).toBe(1);
    expect(r.meanJumpEm).toBeCloseTo(1);
  });

  it('adds the loop-seam handover the forward walk alone would miss', () => {
    const s = samples([
      [true, false, false],
      [false, true, false],
      [false, false, true],
    ]);
    const r = tenureAndJump(s, parts(3), 900);
    expect(r.handovers).toBe(3);
    expect(r.meanJumpParts).toBeCloseTo(4 / 3);
  });

  // A layer that drives everything all the time is not a broken readout. It is the honest answer,
  // and it is the one a reader is most likely to file as a bug.
  it('reports a continuous layer as one whole-pass tenure and no jump', () => {
    const s = samples([
      [true, true, true],
      [true, true, true],
    ]);
    const r = tenureAndJump(s, parts(2), 900);
    expect(r.meanTenureMs).toBe(900);
    expect(r.handovers).toBe(0);
    expect(r.meanJumpParts).toBe(0);
  });

  it('reports nothing rather than the whole pass when no layer moves anything', () => {
    const r = tenureAndJump(samples([[false, false]]), parts(1), 1000);
    expect(r.meanTenureMs).toBe(0);
    expect(r.handovers).toBe(0);
  });
});

// An inner that returns to rest between its own drops leaves the holder unmoved for a sample or
// two at a time. Read as a holder in its own right, that empty sample is a part letting go and
// taking the fault straight back: two handovers per drop, each a jump of nothing.
describe('tenureAndJump, where the inner rests', () => {
  it('does not count a part resting and resuming as a handover', () => {
    const s = samples([[true, false, true, true, false, false]]);
    const r = tenureAndJump(s, parts(1), 600);
    expect(r.handovers).toBe(0);
    expect(r.meanTenureMs).toBe(600);
  });

  it('still counts the handover a rest sits between', () => {
    const s = samples([
      [true, false, false, false],
      [false, false, true, false],
    ]);
    const r = tenureAndJump(s, parts(2), 400);
    expect(r.handovers).toBe(2);
    expect(r.meanJumpParts).toBe(1);
  });

  // Starting the walk at sample 0 loses this: the pass opens mid-rest, so the first holder reads
  // as a fade in rather than as the far side of the seam handover.
  it('finds the seam handover when the pass opens on a sample that moves nothing', () => {
    const s = samples([
      [false, true, false, false],
      [false, false, false, true],
    ]);
    const r = tenureAndJump(s, parts(2), 400);
    expect(r.handovers).toBe(2);
  });
});

// The reconciliation itself: what the panel prints against what `roving` says it did. A reading
// that moves with the sample count is a reading of the instrument, so this pins it at two rates.
describe('tenure under a roving flicker', () => {
  const pool = syntheticPool(24, 7);
  const inner = flicker({ duration: 1400, depth: 0, unrest: 0.18 });
  const piece = roving(inner, { dwell: 3200, seed: 0, epochs: 8 });

  const read = (rate: number): number => {
    const specs = [{ piece, target: { kind: 'run' as const, by: 'index' as const, amount: 1 } }];
    const frame = new EffectFrame(planEffects(specs, pool));
    const s = samplePass(frame, pool, piece.duration, rate, NO_CTX);
    return tenureAndJump(s, pool, piece.duration).meanTenureMs;
  };

  it('reads the same at twice the sample rate', () => {
    const coarse = read(1600);
    expect(Math.abs(read(3200) - coarse) / coarse).toBeLessThan(0.05);
  });

  it('reads at least the epoch, because a handover is deferred and never brought forward', () => {
    expect(read(1600)).toBeGreaterThanOrEqual(piece.epoch);
  });
});
