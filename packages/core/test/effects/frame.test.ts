import { describe, expect, it } from 'vitest';
import { EffectFrame, planEffects } from '../../src/effects/frame.js';
import type { EffectPiece, EffectSpec, PartInfo } from '../../src/effects/types.js';
import { NO_CTX } from './ctx.js';

function pool(runs: number, bodies: number): PartInfo[] {
  const parts: PartInfo[] = [];
  for (let i = 0; i < bodies; i++) {
    parts.push({
      kind: 'body',
      index: i,
      count: bodies,
      letter: { index: i, count: bodies },
      x: i,
      y: 0,
      ink: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
      at: i / bodies,
      span: 1 / bodies,
    });
  }
  for (let i = 0; i < runs; i++) {
    parts.push({
      kind: 'run',
      index: i,
      count: runs,
      letter: { index: 0, count: bodies },
      x: i,
      y: 0,
      ink: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
      at: i / runs,
      span: 1 / runs,
    });
  }
  return parts;
}

const HALF: EffectPiece = { duration: 1000, at: () => ({ gain: 0.5 }) };
const DIM: EffectPiece = { duration: 1000, at: () => ({ gain: 0.2 }) };
/** Reports the phase it was called at, so stagger is observable. */
const PHASE: EffectPiece = { duration: 1000, at: (t) => ({ scale: 1 + t }) };

describe('planEffects', () => {
  it('selects only parts of the spec kind, indexed into the whole pool', () => {
    const parts = pool(3, 2);
    const [effect] = planEffects(
      [{ piece: HALF, target: { kind: 'run', by: 'index', amount: 1 } }],
      parts,
    );
    expect(effect?.parts).toEqual([2, 3, 4]);
  });

  it('resolves a name to its built-in piece', () => {
    const parts = pool(2, 1);
    const [effect] = planEffects(
      [{ piece: 'flicker', target: { kind: 'run', by: 'index', amount: 1 } }],
      parts,
    );
    expect(effect?.piece.duration).toBeGreaterThan(0);
  });

  it('reports an empty selection rather than throwing, so a caller can warn', () => {
    const parts = pool(0, 2);
    const [effect] = planEffects(
      [{ piece: HALF, target: { kind: 'run', by: 'index', amount: 1 } }],
      parts,
    );
    expect(effect?.parts).toEqual([]);
  });

  it('selects by fill name, across kinds', () => {
    const parts = pool(0, 2);
    (parts[1] as PartInfo).fill = 'stone';
    const [effect] = planEffects(
      [{ piece: HALF, target: { fill: 'stone', by: 'index', amount: 1 } }],
      parts,
    );
    expect(effect?.parts).toEqual([1]);
  });

  // The guard on the whole change: a `kind` target must keep reaching a part a fill built, or
  // every shipped look's effects narrow the moment a fill exists.
  it('leaves a kind target selecting by kind, filled or not', () => {
    const parts = pool(0, 2);
    (parts[1] as PartInfo).fill = 'stone';
    const [effect] = planEffects(
      [{ piece: HALF, target: { kind: 'body', by: 'index', amount: 1 } }],
      parts,
    );
    expect(effect?.parts).toEqual([0, 1]);
  });
});

describe('EffectFrame', () => {
  it('merges every layer that reaches a part', () => {
    const parts = pool(2, 0);
    const specs: EffectSpec[] = [
      { piece: HALF, target: { kind: 'run', by: 'index', amount: 1 } },
      { piece: DIM, target: { kind: 'run', by: 'index', amount: 1 } },
    ];
    const out = new EffectFrame(planEffects(specs, parts)).resolve(parts, 0, NO_CTX);
    expect(out.get(0)?.gain).toBeCloseTo(0.1);
  });

  it('writes only targeted parts', () => {
    const parts = pool(2, 1);
    const specs: EffectSpec[] = [{ piece: HALF, target: { kind: 'run', by: 'index', amount: 1 } }];
    const out = new EffectFrame(planEffects(specs, parts)).resolve(parts, 0, NO_CTX);
    expect([...out.keys()].sort()).toEqual([1, 2]);
  });

  it('staggers the phase per part rather than passing one pass to all of them', () => {
    const parts = pool(2, 0);
    const specs: EffectSpec[] = [
      { piece: PHASE, target: { kind: 'run', by: 'index', amount: 1 }, stagger: 0.5 },
    ];
    const out = new EffectFrame(planEffects(specs, parts)).resolve(parts, 500, NO_CTX);
    expect(out.get(0)?.scale).not.toBeCloseTo(out.get(1)?.scale as number);
  });

  it('skips a part the caller disowns, leaving it out of the result entirely', () => {
    const parts = pool(2, 0);
    const specs: EffectSpec[] = [{ piece: HALF, target: { kind: 'run', by: 'index', amount: 1 } }];
    const frame = new EffectFrame(planEffects(specs, parts));
    const out = frame.resolve(parts, 0, NO_CTX, (i) => i === 1);
    expect([...out.keys()]).toEqual([0]);
  });

  it('does not leak one frame layers into the next', () => {
    const parts = pool(1, 0);
    const specs: EffectSpec[] = [{ piece: HALF, target: { kind: 'run', by: 'index', amount: 1 } }];
    const frame = new EffectFrame(planEffects(specs, parts));
    frame.resolve(parts, 0, NO_CTX);
    const second = frame.resolve(parts, 0, NO_CTX);
    expect(second.get(0)?.gain).toBeCloseTo(0.5);
  });

  it('holds a piece with no duration at its first phase rather than dividing by zero', () => {
    const parts = pool(1, 0);
    const instant: EffectPiece = { duration: 0, at: (t) => ({ scale: 1 + t }) };
    const specs: EffectSpec[] = [
      { piece: instant, target: { kind: 'run', by: 'index', amount: 1 } },
    ];
    const out = new EffectFrame(planEffects(specs, parts)).resolve(parts, 9999, NO_CTX);
    expect(out.get(0)?.scale).toBe(1);
  });
});
