import { describe, expect, it } from 'vitest';
import { flicker } from '../../src/effects/pieces.js';
import { roving } from '../../src/effects/roving.js';
import type { EffectPiece, FrameCtx, PartInfo } from '../../src/effects/types.js';
import { NO_CTX } from './ctx.js';

const COUNT = 6;

function partAt(index: number): PartInfo {
  return {
    kind: 'run',
    index,
    count: COUNT,
    letter: { index: 0, count: 1 },
    x: 0,
    y: 0,
    ink: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
    at: index / COUNT,
    span: 1 / COUNT,
  };
}

const PARTS = Array.from({ length: COUNT }, (_, i) => partAt(i));

/** Which part indices are contributing anything at `t`. */
function afflicted(piece: EffectPiece, t: number): number[] {
  return PARTS.filter((p) => Object.keys(piece.at(t, p, NO_CTX)).length > 0).map((p) => p.index);
}

/** A piece that is never at rest, so a deferred handover can never resolve. */
const STUCK: EffectPiece = { duration: 100, at: () => ({ gain: 0.1 }) };

/** Always at rest, so every epoch hands over — and `{ gain: 1 }` still marks the holder, which
 * a bare `{}` could not. Coverage is a property of the walk, not of any inner's stutter. */
const RESTING: EffectPiece = { duration: 100, at: () => ({ gain: 1 }) };

function poolOf(count: number): PartInfo[] {
  return Array.from({ length: count }, (_, index) => ({
    ...partAt(index),
    count,
    at: index / count,
    span: 1 / count,
  }));
}

/** The holder at each of `samples` evenly spaced points of one pass, against `pool`. */
function holderRun(piece: EffectPiece, pool: PartInfo[], samples: number): number[] {
  return Array.from({ length: samples }, (_, n) => {
    const t = n / samples;
    const held = pool.find((p) => Object.keys(piece.at(t, p, NO_CTX)).length > 0);
    return held?.index ?? -1;
  });
}

/** Holders in order, with consecutive repeats collapsed: the handover sequence. */
function handovers(piece: EffectPiece, pool: PartInfo[], samples: number): number[] {
  return holderRun(piece, pool, samples).filter((h, i, all) => i === 0 || h !== all[i - 1]);
}

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
      expect(piece.at(0.5, p, NO_CTX)).toEqual({});
    }
  });

  it('delegates the holder to the inner piece rather than inventing an offset', () => {
    const marker: EffectPiece = { duration: 100, at: () => ({ gain: 0.5, scale: 1.25 }) };
    const piece = roving(marker);
    const holder = afflicted(piece, 0.5)[0] as number;
    expect(piece.at(0.5, partAt(holder), NO_CTX)).toEqual({ gain: 0.5, scale: 1.25 });
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

  // A pass that visits 7 of 24 parts and then loops leaves 17 parts that never flicker, ever,
  // and the same 7 that always do. Measured at 7 before the walk became a permutation.
  it('visits every part of a real-sized pool within one pass', () => {
    const pool = poolOf(55);
    const seen = new Set(handovers(roving(RESTING), pool, 4000));
    expect(seen.size).toBe(55);
  });

  it('gives every part the fault once before giving any of them a second turn', () => {
    const pool = poolOf(24);
    const seq = handovers(roving(RESTING), pool, 4000).slice(0, 24);
    expect(new Set(seq).size).toBe(seq.length);
  });

  it('takes an epoch count, which sets how many handovers a pass holds', () => {
    const few = roving(RESTING, { epochs: 4 });
    const many = roving(RESTING, { epochs: 32 });
    expect(many.duration).toBeGreaterThan(few.duration);
    expect(handovers(few, poolOf(24), 2000).length).toBeLessThan(
      handovers(many, poolOf(24), 4000).length,
    );
  });

  it('holds a part for a stretch rather than jumping every frame', () => {
    const piece = roving(flicker(), { epochs: 8 });
    let changes = 0;
    let prev = afflicted(piece, 0)[0];
    for (let n = 1; n < SAMPLES; n++) {
      const now = afflicted(piece, n / SAMPLES)[0];
      if (now !== prev) changes++;
      prev = now;
    }
    // One handover per epoch at most, and deferral only ever removes some. Sampled at 500 across
    // a pass, so a pass with more epochs than samples would undercount — hence the explicit cap.
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

  // An instrument comparing a measured tenure against the asked dwell needs the number the
  // wrapper actually settled on. Re-deriving it outside drifts the moment this arithmetic moves.
  it('publishes the epoch it settled on, and the count that divides its pass', () => {
    const piece = roving(flicker({ duration: 1400 }), { dwell: 3200, epochs: 96 });
    expect(piece.epochs).toBe(Math.round(piece.duration / piece.epoch));
    expect(piece.epoch * piece.epochs).toBeCloseTo(piece.duration);
    expect(piece.epoch).toBeGreaterThan(3000);
    expect(piece.epoch).toBeLessThan(3400);
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
    expect(piece.at(0.5, one, NO_CTX).gain).toBeTypeOf('number');
  });

  it('survives an inner piece with no duration', () => {
    const instant: EffectPiece = { duration: 0, at: () => ({ gain: 0.2 }) };
    const piece = roving(instant);
    expect(piece.duration).toBeGreaterThan(0);
    expect(afflicted(piece, 0.5)).toHaveLength(1);
  });

  it('forwards the ctx it receives to the inner piece, rather than dropping or inventing one', () => {
    const seen: unknown[] = [];
    const recorder: EffectPiece = {
      duration: 100,
      at: (_t, _part, ctx) => {
        seen.push(ctx);
        return { gain: 1 };
      },
    };
    const ctx: FrameCtx = {
      pointer: { x: 0.1, y: 0.2 },
      pointerInWord: { x: 0.3, y: 0.4 },
      dt: 42,
    };
    for (const p of PARTS) roving(recorder).at(0.5, p, ctx);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((c) => c === ctx)).toBe(true);
  });
});
