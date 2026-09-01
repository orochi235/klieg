import { describe, expect, it } from 'vitest';
import type { PassSamples } from '../../dev/composition-lab/src/sample.js';
import { tenureAndJump } from '../../dev/composition-lab/src/tenure.js';
import type { PartInfo } from '../../src/effects/types.js';

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
  it("measures a holder's stretch in milliseconds", () => {
    const s = samples([
      [true, true, false, false],
      [false, false, true, true],
    ]);
    const r = tenureAndJump(s, parts(2), 1000);
    expect(r.tenures).toEqual([500, 500]);
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
    expect(r.tenures).toEqual([900, 900]);
    expect(r.handovers).toBe(0);
    expect(r.meanJumpParts).toBe(0);
  });

  it('reports nothing rather than NaN when no layer moves anything', () => {
    const r = tenureAndJump(samples([[false, false]]), parts(1), 1000);
    expect(r.tenures).toEqual([]);
    expect(r.meanTenureMs).toBe(0);
    expect(r.handovers).toBe(0);
  });

  it('joins a stretch that straddles the loop seam instead of halving it', () => {
    const s = samples([[true, false, true]]);
    const r = tenureAndJump(s, parts(1), 900);
    expect(r.tenures).toEqual([600]);
  });

  it('does not double-count an all-true row when joining the seam', () => {
    const s = samples([[true, true, true]]);
    const r = tenureAndJump(s, parts(1), 900);
    expect(r.tenures).toEqual([900]);
  });
});
