import { describe, expect, it } from 'vitest';
import { intermittent } from '../../src/effects/intermittent.js';
import type { EffectPiece, PartInfo } from '../../src/effects/types.js';
import { NO_CTX } from './ctx.js';

const PART: PartInfo = {
  kind: 'run',
  index: 0,
  count: 1,
  letter: { index: 0, count: 1 },
  x: 0,
  y: 0,
  ink: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
  at: 0,
  span: 1,
};

/** Reports the phase it was called at, so a test can read what the gate let through. */
function probe(duration: number): EffectPiece & { seen: number[] } {
  const seen: number[] = [];
  return {
    duration,
    seen,
    at(phase: number) {
      seen.push(phase);
      return { gain: 0.2 };
    },
  };
}

const INNER = 1400;
const contributes = (piece: EffectPiece, t: number) =>
  Object.keys(piece.at(t, PART, NO_CTX)).length > 0;

describe('intermittent', () => {
  it('runs a whole number of inner passes, so the loop seam is continuous', () => {
    const gated = intermittent(probe(INNER), { spell: 4000, calm: 15000 });
    expect(gated.duration % INNER).toBeCloseTo(0, 6);
  });

  it('opens every bout on a different phase of the inner', () => {
    // The trap this wrapper exists to avoid: tie the bout's own period to the inner and every
    // bout opens on phase 0, so they all look identical while the inner never resets.
    const inner = probe(INNER);
    const gated = intermittent(inner, { spell: 4000, calm: 15000, bouts: 3 });

    const opens: number[] = [];
    for (let bout = 0; bout < 3; bout++) {
      inner.seen.length = 0;
      // A hair inside the bout, so this reads the opening rather than the boundary itself.
      gated.at((bout * (gated.duration / 3) + 1) / gated.duration, PART, NO_CTX);
      opens.push(inner.seen[0] as number);
    }

    expect(new Set(opens.map((p) => Math.round(p * 1000))).size).toBe(3);
  });

  it('swallows the inner during the calm rather than resetting it', () => {
    const inner = probe(INNER);
    const gated = intermittent(inner, { spell: 4000, calm: 15000, bouts: 1 });
    const cycle = gated.duration;

    // Deep in the calm: nothing contributes.
    expect(contributes(gated, (cycle * 0.9) / gated.duration)).toBe(false);

    // The phase the inner is handed still tracks the wall clock, never restarting at 0.
    inner.seen.length = 0;
    gated.at(0.001, PART, NO_CTX);
    const early = inner.seen[0] as number;
    inner.seen.length = 0;
    gated.at(0.002, PART, NO_CTX);
    expect(inner.seen[0] as number).toBeGreaterThan(early);
  });

  it('lets the inner through untouched when nothing is asked for', () => {
    const inner = probe(INNER);
    const gated = intermittent(inner);
    expect(gated.duration).toBe(INNER);
    expect(contributes(gated, 0.5)).toBe(true);
  });

  it('holds the requested share of each bout lit', () => {
    const gated = intermittent(probe(INNER), { spell: 4000, calm: 12000, bouts: 2 });
    const cycle = gated.duration / 2;
    let lit = 0;
    const STEPS = 400;
    for (let i = 0; i < STEPS; i++) {
      if (contributes(gated, (i / STEPS) * (cycle / gated.duration))) lit++;
    }
    // 4000 of 16000 asked for; the cycle is rounded to fit the pass, so allow a step either way.
    expect(lit / STEPS).toBeCloseTo(0.25, 1);
  });

  it('refuses a bout shorter than one inner pass', () => {
    // A spell under one pass shows a sliver of the inner and reads as a glitch, not a bout.
    expect(() => intermittent(probe(INNER), { spell: 200, calm: 5000 })).toThrow(/spell/);
  });
});
