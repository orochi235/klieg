import { describe, expect, it } from 'vitest';
import { samplePass } from '../../dev/composition-lab/src/sample.js';
import { EffectFrame, planEffects } from '../../src/effects/frame.js';
import type { EffectPiece, PartInfo } from '../../src/effects/types.js';
import { NO_CTX } from '../effects/ctx.js';

function pool(count: number): PartInfo[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'run' as const,
    index,
    count,
    letter: { index: 0, count: 1 },
    x: index,
    y: 0,
    ink: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
    at: index / count,
    span: 1 / count,
  }));
}

/** Gain falls linearly across the pass, so a sample grid is trivially checkable. */
const RAMP: EffectPiece = { duration: 1000, at: (t) => ({ gain: 1 - t }) };

describe('samplePass', () => {
  it('returns one row per part and one column per sample', () => {
    const parts = pool(3);
    const frame = new EffectFrame(
      planEffects([{ piece: RAMP, target: { kind: 'run', by: 'index', amount: 1 } }], parts),
    );
    const s = samplePass(frame, parts, 1000, 10, NO_CTX);
    expect(s.samples).toBe(10);
    expect(s.gain).toHaveLength(3);
    expect(s.gain[0]).toHaveLength(10);
  });

  it('walks the whole pass, so the last column is the pass end and not the start', () => {
    const parts = pool(1);
    const frame = new EffectFrame(
      planEffects([{ piece: RAMP, target: { kind: 'run', by: 'index', amount: 1 } }], parts),
    );
    const s = samplePass(frame, parts, 1000, 10, NO_CTX);
    expect(s.gain[0]?.[0]).toBeCloseTo(1);
    expect(s.gain[0]?.[9]).toBeCloseTo(0.1);
  });

  it('reports an untouched part as resting rather than as zero, which would read as fully dark', () => {
    const parts = pool(2);
    const frame = new EffectFrame(
      planEffects([{ piece: RAMP, target: { kind: 'run', by: 'index', amount: 0.5 } }], parts),
    );
    const s = samplePass(frame, parts, 1000, 4, NO_CTX);
    const untouched = s.touched.indexOf(false);
    expect(untouched).toBeGreaterThanOrEqual(0);
    expect(s.gain[untouched]?.every((g) => g === 1)).toBe(true);
  });

  // The failure this guards: EffectFrame writes every TARGETED part, contribution or not, so a
  // piece like roving — which addresses the whole pool and afflicts one part of it — would mark
  // the whole pool touched and make the coverage overlay blind to the fault it exists to show.
  it('does not count a targeted part that no layer ever actually moved', () => {
    const parts = pool(4);
    const oneOnly: EffectPiece = {
      duration: 1000,
      at: (_t, part) => (part.index === 0 ? { gain: 0.5 } : {}),
    };
    const frame = new EffectFrame(
      planEffects([{ piece: oneOnly, target: { kind: 'run', by: 'index', amount: 1 } }], parts),
    );
    const s = samplePass(frame, parts, 1000, 16, NO_CTX);
    expect(s.touched).toEqual([true, false, false, false]);
  });

  it('marks which parts the composition ever touches, so coverage is readable', () => {
    const parts = pool(4);
    const frame = new EffectFrame(
      planEffects([{ piece: RAMP, target: { kind: 'run', by: 'index', amount: 0.5 } }], parts),
    );
    const s = samplePass(frame, parts, 1000, 8, NO_CTX);
    expect(s.touched.filter(Boolean).length).toBeLessThan(4);
  });
});
