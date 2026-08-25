import { describe, expect, it } from 'vitest';
import { flicker } from '../../src/effects/pieces.js';
import { roving } from '../../src/effects/roving.js';
import type { EffectPiece, PartInfo } from '../../src/effects/types.js';

const COUNT = 6;

function partAt(index: number): PartInfo {
  return {
    kind: 'run',
    index,
    count: COUNT,
    letter: { index: 0, count: 1 },
    x: 0,
    y: 0,
    at: index / COUNT,
    span: 1 / COUNT,
  };
}

const PARTS = Array.from({ length: COUNT }, (_, i) => partAt(i));

/** Which part indices are contributing anything at `t`. */
function afflicted(piece: EffectPiece, t: number): number[] {
  return PARTS.filter((p) => Object.keys(piece.at(t, p)).length > 0).map((p) => p.index);
}

/** A piece that is never at rest, so a deferred handover can never resolve. */
const STUCK: EffectPiece = { duration: 100, at: () => ({ gain: 0.1 }) };

const SAMPLES = 500;

describe('roving', () => {
  it('afflicts exactly one part at every sample of a whole pass', () => {
    const piece = roving(flicker());
    for (let n = 0; n < SAMPLES; n++) {
      expect(afflicted(piece, n / SAMPLES)).toHaveLength(1);
    }
  });

  it('returns a bare no-contribution offset for every part but the holder', () => {
    const piece = roving(flicker());
    const holder = afflicted(piece, 0.5)[0] as number;
    for (const p of PARTS) {
      if (p.index === holder) continue;
      expect(piece.at(0.5, p)).toEqual({});
    }
  });

  it('delegates the holder to the inner piece rather than inventing an offset', () => {
    const marker: EffectPiece = { duration: 100, at: () => ({ gain: 0.5, scale: 1.25 }) };
    const piece = roving(marker);
    const holder = afflicted(piece, 0.5)[0] as number;
    expect(piece.at(0.5, partAt(holder))).toEqual({ gain: 0.5, scale: 1.25 });
  });

  // Measured at 4 distinct holders over a default pass against a pool of 6. This is the assertion
  // that catches the arithmetic failure a prototype found: an epoch snapped to a whole number of
  // inner passes samples the inner at one fixed phase, `flicker`'s rest there is a per-part
  // constant, and the first part to block its own handover keeps the fault forever.
  it('moves the fault: a whole pass visits more than one part', () => {
    const piece = roving(flicker());
    const holders = new Set(
      Array.from({ length: SAMPLES }, (_, n) => afflicted(piece, n / SAMPLES)[0] as number),
    );
    expect(holders.size).toBeGreaterThan(2);
  });

  it('holds a part for a stretch rather than jumping every frame', () => {
    const piece = roving(flicker());
    let changes = 0;
    let prev = afflicted(piece, 0)[0];
    for (let n = 1; n < SAMPLES; n++) {
      const now = afflicted(piece, n / SAMPLES)[0];
      if (now !== prev) changes++;
      prev = now;
    }
    // Eight epochs to a pass, so at most eight handovers, and deferral only ever removes some.
    expect(changes).toBeGreaterThan(0);
    expect(changes).toBeLessThanOrEqual(8);
  });

  it('is deterministic in t, across separately built wrappers', () => {
    const of = (p: EffectPiece) =>
      Array.from({ length: 200 }, (_, n) => afflicted(p, n / 200)[0] as number);
    expect(of(roving(flicker()))).toEqual(of(roving(flicker())));
  });

  it('takes a seed that changes which part is afflicted when', () => {
    const of = (seed: number) =>
      Array.from(
        { length: 200 },
        (_, n) => afflicted(roving(flicker(), { seed }), n / 200)[0] as number,
      );
    expect(of(1)).not.toEqual(of(2));
  });

  it('spans several inner passes, so the choice of tube changes far more slowly', () => {
    const inner = flicker();
    expect(roving(inner).duration).toBeGreaterThan(inner.duration * 4);
  });

  it('makes its duration a whole multiple of the inner pass, so the loop seam is continuous', () => {
    expect(roving(flicker({ duration: 900 }), { dwell: 2500 }).duration % 900).toBe(0);
    expect(roving(flicker(), { dwell: 3200 }).duration % 1400).toBe(0);
  });

  // The deferral, stated as behaviour rather than as arithmetic: an inner piece that never rests
  // never lets the fault go.
  it('defers the handover while the outgoing part is not at rest', () => {
    const piece = roving(STUCK);
    const holders = new Set(
      Array.from({ length: SAMPLES }, (_, n) => afflicted(piece, n / SAMPLES)[0] as number),
    );
    expect(holders.size).toBe(1);
  });

  it('still afflicts exactly one part when the inner piece never rests', () => {
    const piece = roving(STUCK);
    for (let n = 0; n < 100; n++) {
      expect(afflicted(piece, n / 100)).toHaveLength(1);
    }
  });

  // The pool count reaches the wrapper through `part`, not through its spec, so the per-frame memo
  // is keyed on it. Without that key a pool of one reads back a holder resolved against a pool of
  // six at the same `t` — the answer is silently wrong rather than an error, so the sequence here
  // is the test: ask with six parts first, then with one, at the same `t`.
  it('survives a single-part pool, even right after a larger one at the same t', () => {
    const piece = roving(flicker());
    afflicted(piece, 0.5);
    const one: PartInfo = { ...partAt(0), count: 1 };
    expect(piece.at(0.5, one).gain).toBeTypeOf('number');
  });

  it('survives an inner piece with no duration', () => {
    const instant: EffectPiece = { duration: 0, at: () => ({ gain: 0.2 }) };
    const piece = roving(instant);
    expect(piece.duration).toBeGreaterThan(0);
    expect(afflicted(piece, 0.5)).toHaveLength(1);
  });
});
