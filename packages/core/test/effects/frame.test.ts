import { describe, expect, it } from 'vitest';
import { EffectFrame, planEffects } from '../../src/effects/frame.js';
import { hinge } from '../../src/effects/hinge.js';
import type { EffectPatch, EffectSpec, Host, PartInfo } from '../../src/effects/types.js';

const HOST: Host = { pointer: null, pointerInWord: null, now: 0 };

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

const HALF: EffectPatch = { period: 1000, at: () => ({ gain: 0.5 }) };
const DIM: EffectPatch = { period: 1000, at: () => ({ gain: 0.2 }) };
/** Reports the phase it was called at, so stagger is observable. */
const PHASE: EffectPatch = { period: 1000, at: (phase) => ({ scale: 1 + phase }) };

describe('planEffects', () => {
  it('selects only parts of the spec kind, indexed into the whole pool', () => {
    const parts = pool(3, 2);
    const [effect] = planEffects(
      [{ patch: HALF, target: { kind: 'run', by: 'index', amount: 1 } }],
      parts,
    );
    expect(effect?.parts).toEqual([2, 3, 4]);
  });

  it('resolves a name to its built-in patch', () => {
    const parts = pool(2, 1);
    const [effect] = planEffects(
      [{ patch: 'flicker', target: { kind: 'run', by: 'index', amount: 1 } }],
      parts,
    );
    expect(effect?.patch.period).toBeGreaterThan(0);
  });

  it('reports an empty selection rather than throwing, so a caller can warn', () => {
    const parts = pool(0, 2);
    const [effect] = planEffects(
      [{ patch: HALF, target: { kind: 'run', by: 'index', amount: 1 } }],
      parts,
    );
    expect(effect?.parts).toEqual([]);
  });

  it('selects by fill name, across kinds', () => {
    const parts = pool(0, 2);
    (parts[1] as PartInfo).fill = 'stone';
    const [effect] = planEffects(
      [{ patch: HALF, target: { fill: 'stone', by: 'index', amount: 1 } }],
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
      [{ patch: HALF, target: { kind: 'body', by: 'index', amount: 1 } }],
      parts,
    );
    expect(effect?.parts).toEqual([0, 1]);
  });
});

describe('EffectFrame', () => {
  it('merges every layer that reaches a part', () => {
    const parts = pool(2, 0);
    const specs: EffectSpec[] = [
      { patch: HALF, target: { kind: 'run', by: 'index', amount: 1 } },
      { patch: DIM, target: { kind: 'run', by: 'index', amount: 1 } },
    ];
    const out = new EffectFrame(planEffects(specs, parts)).resolve(parts, 0, HOST);
    expect(out.get(0)?.gain).toBeCloseTo(0.1);
  });

  it('writes only targeted parts', () => {
    const parts = pool(2, 1);
    const specs: EffectSpec[] = [{ patch: HALF, target: { kind: 'run', by: 'index', amount: 1 } }];
    const out = new EffectFrame(planEffects(specs, parts)).resolve(parts, 0, HOST);
    expect([...out.keys()].sort()).toEqual([1, 2]);
  });

  it('staggers the phase per part rather than passing one pass to all of them', () => {
    const parts = pool(2, 0);
    const specs: EffectSpec[] = [
      { patch: PHASE, target: { kind: 'run', by: 'index', amount: 1 }, stagger: 0.5 },
    ];
    const out = new EffectFrame(planEffects(specs, parts)).resolve(parts, 500, HOST);
    expect(out.get(0)?.scale).not.toBeCloseTo(out.get(1)?.scale as number);
  });

  it('leaves a dropped part out of the result entirely, before or after its first frame', () => {
    const parts = pool(3, 0);
    const specs: EffectSpec[] = [{ patch: HALF, target: { kind: 'run', by: 'index', amount: 1 } }];
    const frame = new EffectFrame(planEffects(specs, parts));
    frame.drop([1]);
    expect([...frame.resolve(parts, 0, HOST).keys()]).toEqual([0, 2]);
    frame.drop([2]);
    const out = frame.resolve(parts, 16, HOST);
    expect([...out.keys()]).toEqual([0]);
    expect(out.get(0)?.gain).toBeCloseTo(0.5);
  });

  it('keeps a dropped part out when a new pool re-cues every effect', () => {
    const parts = pool(2, 0);
    const specs: EffectSpec[] = [{ patch: HALF, target: { kind: 'run', by: 'index', amount: 1 } }];
    const frame = new EffectFrame(planEffects(specs, parts));
    frame.resolve(parts, 0, HOST);
    frame.drop([1]);
    expect([...frame.resolve([...parts], 16, HOST).keys()]).toEqual([0]);
  });

  it('does not leak one frame layers into the next', () => {
    const parts = pool(1, 0);
    const specs: EffectSpec[] = [{ patch: HALF, target: { kind: 'run', by: 'index', amount: 1 } }];
    const frame = new EffectFrame(planEffects(specs, parts));
    frame.resolve(parts, 0, HOST);
    const second = frame.resolve(parts, 0, HOST);
    expect(second.get(0)?.gain).toBeCloseTo(0.5);
  });

  it('holds a patch with no period at its first phase rather than dividing by zero', () => {
    const parts = pool(1, 0);
    const instant: EffectPatch = { period: 0, at: (phase) => ({ scale: 1 + phase }) };
    const specs: EffectSpec[] = [
      { patch: instant, target: { kind: 'run', by: 'index', amount: 1 } },
    ];
    const out = new EffectFrame(planEffects(specs, parts)).resolve(parts, 9999, HOST);
    expect(out.get(0)?.scale).toBe(1);
  });

  it("asks only the two stops a hinge's signal sits between", () => {
    const parts = pool(4, 0);
    let asked = 0;
    const stop = (k: number): EffectPatch => ({
      period: 1000,
      at: () => {
        asked++;
        return { gain: k };
      },
    });
    const specs: EffectSpec[] = [
      { patch: hinge(() => 0.3, stop), target: { kind: 'run', by: 'index', amount: 1 } },
    ];
    new EffectFrame(planEffects(specs, parts)).resolve(parts, 100, HOST);
    expect(asked).toBe(parts.length * 2);
  });
});
