import { describe, expect, it } from 'vitest';
import { turns } from '../../src/effects/turns.js';
import type { EffectPiece, PartInfo } from '../../src/effects/types.js';
import { NO_CTX } from './ctx.js';

const COUNT = 8;

function partAt(index: number, count = COUNT): PartInfo {
  return {
    kind: 'run',
    index,
    count,
    letter: { index: 0, count: 1 },
    x: 0,
    y: 0,
    ink: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
    at: index / count,
    span: 1 / count,
  };
}

const PARTS = Array.from({ length: COUNT }, (_, i) => partAt(i));

/**
 * A piece identifiable by its `gain` while it works, and genuinely at rest for the last third of
 * its own pass. Identity and rest have to share one channel: any other channel written at all
 * makes `isRest` false, so a piece that could be told apart by a marker could never hand over.
 */
function marker(gain: number): EffectPiece {
  return { duration: 900, at: (t) => (t > 0.67 ? { gain: 1 } : { gain }) };
}

/** Never at rest, so a handover can only ever be forced by the deadline. */
const STUCK: EffectPiece = { duration: 900, at: () => ({ gain: 0.5 }) };

const A = marker(0.1);
const B = marker(0.2);
const C = marker(0.3);

/** Which piece a part is on at `t`, read off the gain each marker writes. -1 while resting. */
function on(piece: EffectPiece, t: number, part: PartInfo): number {
  const gain = piece.at(t, part, NO_CTX).gain;
  if (gain === undefined || gain === 1) return -1;
  return Math.round(gain * 10) - 1;
}

/** The sequence of pieces a part visits over one pass, with rests and repeats collapsed. */
function visited(piece: EffectPiece, part: PartInfo, samples = 600): number[] {
  const seen: number[] = [];
  for (let n = 0; n < samples; n++) {
    const now = on(piece, n / samples, part);
    if (now === -1) continue;
    if (seen[seen.length - 1] !== now) seen.push(now);
  }
  return seen;
}

describe('turns', () => {
  it('gives each piece one step of the pass', () => {
    expect(turns({ pieces: [A, B, C], every: 3000 }).duration).toBe(9000);
  });

  it('runs every piece in turn across one pass', () => {
    const piece = turns({ pieces: [A, B, C], every: 3000, stagger: 0 });
    expect(new Set(visited(piece, partAt(0)))).toEqual(new Set([0, 1, 2]));
  });

  it('takes the pieces in the order they were given', () => {
    const piece = turns({ pieces: [A, B, C], every: 3000, stagger: 0 });
    expect(visited(piece, partAt(0))).toEqual([0, 1, 2]);
  });

  it('skips no step while the deadline is below one step', () => {
    const piece = turns({ pieces: [A, B, C], every: 3000, deadline: 400, stagger: 0.6 });
    for (const part of PARTS) {
      expect(visited(piece, part)).toEqual([0, 1, 2]);
    }
  });

  // The deferral itself, as a time rather than as an outcome. `A` rests only in the last third of
  // its own 900ms pass, so at the nominal boundary of 3000ms it is mid-flight and the swap has to
  // wait — 3000 % 900 is 300. Cut the deferral and the swap lands at 3000, which this reads as `B`
  // already showing at 3100.
  it('waits for the outgoing piece to reach rest before handing over', () => {
    const piece = turns({ pieces: [A, B, C], every: 3000, deadline: 400, stagger: 0 });
    expect(on(piece, 3100 / 9000, partAt(0))).toBe(0);
    expect(on(piece, 3700 / 9000, partAt(0))).toBe(1);
  });

  // The same boundary against a piece with no rest to wait for: the swap is held to the far end of
  // the window and lands at 3400, not at 3000.
  it('holds an overdue part for the whole window before forcing it', () => {
    const piece = turns({ pieces: [STUCK, B, C], every: 3000, deadline: 400, stagger: 0 });
    expect(on(piece, 3300 / 9000, partAt(0))).toBe(4);
    expect(on(piece, 3700 / 9000, partAt(0))).toBe(1);
  });

  // The deadline's whole reason to exist: `hue` is always mid-shift, and without a forced swap it
  // would hold its part for good.
  it('hands over even when the outgoing piece never rests', () => {
    const piece = turns({ pieces: [STUCK, B, C], every: 3000, deadline: 400, stagger: 0 });
    expect(visited(piece, partAt(0)).length).toBeGreaterThan(1);
  });

  // Above `every` a part can fall more than one step behind, and the piece it was overdue for is
  // skipped outright — the chase never happens on that letter.
  it('clamps a deadline that reaches one whole step', () => {
    const piece = turns({ pieces: [STUCK, B, C], every: 3000, deadline: 9000, stagger: 0 });
    const seq = visited(piece, partAt(0));
    expect(seq).toHaveLength(3);
    expect(new Set(seq).size).toBe(3);
  });

  it('switches the whole word together at stagger 0', () => {
    const piece = turns({ pieces: [A, B, C], every: 3000, deadline: 0, stagger: 0 });
    const at = (t: number) => PARTS.map((p) => on(piece, t, p));
    for (let n = 0; n < 200; n++) {
      const row = at(n / 200).filter((v) => v !== -1);
      expect(new Set(row).size).toBeLessThanOrEqual(1);
    }
  });

  it('spreads the handover across the word when given a stagger', () => {
    const piece = turns({ pieces: [A, B, C], every: 3000, deadline: 0, stagger: 0.6 });
    const disagreed = Array.from({ length: 200 }, (_, n) => {
      const row = PARTS.map((p) => on(piece, n / 200, p)).filter((v) => v !== -1);
      return new Set(row).size > 1;
    });
    expect(disagreed.some(Boolean)).toBe(true);
  });

  it('delegates to the piece it is on rather than inventing an offset', () => {
    const loud: EffectPiece = { duration: 900, at: () => ({ gain: 0.4, scale: 1.25 }) };
    const piece = turns({ pieces: [loud], every: 3000, stagger: 0 });
    expect(piece.at(0.5, partAt(0), NO_CTX)).toEqual({ gain: 0.4, scale: 1.25 });
  });

  it('resolves a piece named from the registry', () => {
    const piece = turns({ pieces: ['flicker', 'hue'], every: 3000 });
    expect(piece.duration).toBe(6000);
    expect(piece.at(0.5, partAt(0), NO_CTX)).toBeTypeOf('object');
  });

  it('is deterministic in t, across separately built wrappers', () => {
    const of = () => {
      const p = turns({ pieces: [A, B, C], every: 3000, stagger: 0.6 });
      return Array.from({ length: 200 }, (_, n) => on(p, n / 200, partAt(3)));
    };
    expect(of()).toEqual(of());
  });

  it('forwards the ctx it receives to the piece it is on', () => {
    const seen: unknown[] = [];
    const recorder: EffectPiece = {
      duration: 900,
      at: (_t, _part, ctx) => {
        seen.push(ctx);
        return { gain: 0.4 };
      },
    };
    turns({ pieces: [recorder], every: 3000 }).at(0.5, partAt(0), NO_CTX);
    expect(seen).toContain(NO_CTX);
  });

  it('survives a single piece, which has nobody to hand over to', () => {
    const piece = turns({ pieces: [A], every: 3000, stagger: 0 });
    expect(piece.duration).toBe(3000);
    expect(visited(piece, partAt(0))).toEqual([0]);
  });

  it('survives a single-part pool, which has no spread to spend', () => {
    const piece = turns({ pieces: [A, B], every: 3000, stagger: 0.6 });
    expect(on(piece, 0.1, partAt(0, 1))).toBe(0);
  });
});
