import { describe, expect, it } from 'vitest';
import { turns } from '../../src/effects/turns.js';
import type { EffectPatch, PartInfo } from '../../src/effects/types.js';
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
 * A patch identifiable by its `gain` while it works, and genuinely at rest for the last third of
 * its own pass. Identity and rest have to share one channel: any other channel written at all
 * makes `isRest` false, so a patch that could be told apart by a marker could never hand over.
 */
function marker(gain: number): EffectPatch {
  return { period: 900, at: (phase) => (phase > 0.67 ? { gain: 1 } : { gain }) };
}

/** Never at rest, so a handover can only ever be forced by the deadline. */
const STUCK: EffectPatch = { period: 900, at: () => ({ gain: 0.5 }) };

const A = marker(0.1);
const B = marker(0.2);
const C = marker(0.3);

/** Which patch a part is on at `phase`, read off the gain each marker writes. -1 while resting. */
function on(patch: EffectPatch, phase: number, part: PartInfo): number {
  const gain = patch.at(phase, part, NO_CTX).gain;
  if (gain === undefined || gain === 1) return -1;
  return Math.round(gain * 10) - 1;
}

/** The sequence of patches a part visits over one pass, with rests and repeats collapsed. */
function visited(patch: EffectPatch, part: PartInfo, samples = 600): number[] {
  const seen: number[] = [];
  for (let n = 0; n < samples; n++) {
    const now = on(patch, n / samples, part);
    if (now === -1) continue;
    if (seen[seen.length - 1] !== now) seen.push(now);
  }
  return seen;
}

describe('turns', () => {
  it('gives each patch one step of the pass', () => {
    expect(turns({ patches: [A, B, C], every: 3000 }).period).toBe(9000);
  });

  it('runs every patch in turn across one pass', () => {
    const patch = turns({ patches: [A, B, C], every: 3000, stagger: 0 });
    expect(new Set(visited(patch, partAt(0)))).toEqual(new Set([0, 1, 2]));
  });

  it('takes the patches in the order they were given', () => {
    const patch = turns({ patches: [A, B, C], every: 3000, stagger: 0 });
    expect(visited(patch, partAt(0))).toEqual([0, 1, 2]);
  });

  it('skips no step while the deadline is below one step', () => {
    const patch = turns({ patches: [A, B, C], every: 3000, deadline: 400, stagger: 0.6 });
    for (const part of PARTS) {
      expect(visited(patch, part)).toEqual([0, 1, 2]);
    }
  });

  // The deferral itself, as a time rather than as an outcome. `A` rests only in the last third of
  // its own 900ms pass, so at the nominal boundary of 3000ms it is mid-flight and the swap has to
  // wait — 3000 % 900 is 300. Cut the deferral and the swap lands at 3000, which this reads as `B`
  // already showing at 3100.
  it('waits for the outgoing patch to reach rest before handing over', () => {
    const patch = turns({ patches: [A, B, C], every: 3000, deadline: 400, stagger: 0 });
    expect(on(patch, 3100 / 9000, partAt(0))).toBe(0);
    expect(on(patch, 3700 / 9000, partAt(0))).toBe(1);
  });

  // The same boundary against a patch with no rest to wait for: the swap is held to the far end of
  // the window and lands at 3400, not at 3000.
  it('holds an overdue part for the whole window before forcing it', () => {
    const patch = turns({ patches: [STUCK, B, C], every: 3000, deadline: 400, stagger: 0 });
    expect(on(patch, 3300 / 9000, partAt(0))).toBe(4);
    expect(on(patch, 3700 / 9000, partAt(0))).toBe(1);
  });

  // The deadline's whole reason to exist: `hue` is always mid-shift, and without a forced swap it
  // would hold its part for good.
  it('hands over even when the outgoing patch never rests', () => {
    const patch = turns({ patches: [STUCK, B, C], every: 3000, deadline: 400, stagger: 0 });
    expect(visited(patch, partAt(0)).length).toBeGreaterThan(1);
  });

  // Above `every` a part can fall more than one step behind, and the patch it was overdue for is
  // skipped outright — the chase never happens on that letter.
  it('clamps a deadline that reaches one whole step', () => {
    const patch = turns({ patches: [STUCK, B, C], every: 3000, deadline: 9000, stagger: 0 });
    const seq = visited(patch, partAt(0));
    expect(seq).toHaveLength(3);
    expect(new Set(seq).size).toBe(3);
  });

  it('switches the whole word together at stagger 0', () => {
    const patch = turns({ patches: [A, B, C], every: 3000, deadline: 0, stagger: 0 });
    const at = (phase: number) => PARTS.map((p) => on(patch, phase, p));
    for (let n = 0; n < 200; n++) {
      const row = at(n / 200).filter((v) => v !== -1);
      expect(new Set(row).size).toBeLessThanOrEqual(1);
    }
  });

  it('spreads the handover across the word when given a stagger', () => {
    const patch = turns({ patches: [A, B, C], every: 3000, deadline: 0, stagger: 0.6 });
    const disagreed = Array.from({ length: 200 }, (_, n) => {
      const row = PARTS.map((p) => on(patch, n / 200, p)).filter((v) => v !== -1);
      return new Set(row).size > 1;
    });
    expect(disagreed.some(Boolean)).toBe(true);
  });

  it('delegates to the patch it is on rather than inventing a delta', () => {
    const loud: EffectPatch = { period: 900, at: () => ({ gain: 0.4, scale: 1.25 }) };
    const patch = turns({ patches: [loud], every: 3000, stagger: 0 });
    expect(patch.at(0.5, partAt(0), NO_CTX)).toEqual({ gain: 0.4, scale: 1.25 });
  });

  it('resolves a patch named from the registry', () => {
    const patch = turns({ patches: ['flicker', 'hue'], every: 3000 });
    expect(patch.period).toBe(6000);
    expect(patch.at(0.5, partAt(0), NO_CTX)).toBeTypeOf('object');
  });

  it('is deterministic in phase, across separately built wrappers', () => {
    const of = () => {
      const p = turns({ patches: [A, B, C], every: 3000, stagger: 0.6 });
      return Array.from({ length: 200 }, (_, n) => on(p, n / 200, partAt(3)));
    };
    expect(of()).toEqual(of());
  });

  it('forwards the setting it receives to the patch it is on', () => {
    const seen: unknown[] = [];
    const recorder: EffectPatch = {
      period: 900,
      at: (_phase, _part, setting) => {
        seen.push(setting);
        return { gain: 0.4 };
      },
    };
    turns({ patches: [recorder], every: 3000 }).at(0.5, partAt(0), NO_CTX);
    expect(seen).toContain(NO_CTX);
  });

  it('survives a single patch, which has nobody to hand over to', () => {
    const patch = turns({ patches: [A], every: 3000, stagger: 0 });
    expect(patch.period).toBe(3000);
    expect(visited(patch, partAt(0))).toEqual([0]);
  });

  it('survives a single-part pool, which has no spread to spend', () => {
    const patch = turns({ patches: [A, B], every: 3000, stagger: 0.6 });
    expect(on(patch, 0.1, partAt(0, 1))).toBe(0);
  });
});
