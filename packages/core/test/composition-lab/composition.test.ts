import { describe, expect, it } from 'vitest';
import {
  buildLayer,
  type Composition,
  DEFAULT_COMPOSITION,
  type EffectLayer,
  finestPass,
  layerPiece,
  toFireOptions,
} from '../../dev/composition-lab/src/composition.js';

describe('toFireOptions', () => {
  it('carries text settings straight through', () => {
    const c: Composition = { ...DEFAULT_COMPOSITION, look: 'tubing', hold: 4000 };
    expect(toFireOptions(c).look).toBe('tubing');
    expect(toFireOptions(c).hold).toBe(4000);
  });

  it('builds an effect spec per enabled effect layer, and omits disabled ones', () => {
    const c: Composition = {
      ...DEFAULT_COMPOSITION,
      effects: [
        { id: 'a', kind: 'flicker', enabled: true, params: {}, target: 'run', amount: 1, seed: 0 },
        { id: 'b', kind: 'hue', enabled: false, params: {}, target: 'run', amount: 1, seed: 0 },
      ],
    };
    expect(toFireOptions(c).effects).toHaveLength(1);
  });

  it('wraps a layer in roving when the layer asks for it', () => {
    const c: Composition = {
      ...DEFAULT_COMPOSITION,
      effects: [
        {
          id: 'a',
          kind: 'flicker',
          enabled: true,
          params: {},
          target: 'run',
          amount: 1,
          seed: 0,
          roving: { dwell: 3200, seed: 0, epochs: 96 },
        },
      ],
    };
    const piece = toFireOptions(c).effects?.[0]?.piece;
    expect(typeof piece).not.toBe('string');
    // roving's pass is many inner passes long; a bare flicker's is 1400ms.
    expect((piece as { duration: number }).duration).toBeGreaterThan(100000);
  });

  it('omits effects entirely when no layer is enabled, so the look keeps its own', () => {
    const c: Composition = { ...DEFAULT_COMPOSITION, effects: [] };
    expect(toFireOptions(c).effects).toBeUndefined();
  });
});

describe('layerPiece wrappers', () => {
  const base = {
    id: 'a',
    kind: 'flicker' as const,
    enabled: true,
    params: { duration: 1000 },
    target: 'run' as const,
    amount: 1,
    seed: 0,
  };

  it('lengthens a pass to whole bouts under intermittent', () => {
    const plain = layerPiece(base);
    const gated = layerPiece({ ...base, intermittent: { spell: 2000, calm: 1000, bouts: 3 } });
    expect(gated?.duration).toBeGreaterThan(plain?.duration as number);
  });

  it('will not build a layer whose spell cannot cover one inner pass', () => {
    expect(layerPiece({ ...base, intermittent: { spell: 100, calm: 1000, bouts: 3 } })).toBeNull();
  });

  // The rail hides this pairing, but a composition persisted before it did still has to load.
  it('drops a roving wrapper from a lamp rather than lighting the wrong part', () => {
    const layer = {
      ...base,
      kind: 'lamp' as const,
      params: {},
      roving: { dwell: 3200, seed: 0, epochs: 96 },
    };
    const piece = layerPiece(layer);
    expect(piece).not.toBeNull();
    expect(piece?.duration).toBe(4000);
  });
});

const LAYER: EffectLayer = {
  id: 'a',
  kind: 'flicker',
  enabled: true,
  params: { duration: 1400 },
  target: 'run',
  amount: 1,
  seed: 0,
};

// The sampler has to resolve the piece inside the wrappers, and `roving` at `epochs: 96` publishes
// a pass two hundred times longer than the flicker in it. Reading the wrapper's pass instead is
// how the panels came to sample a 306s pass 511ms at a time.
describe('buildLayer', () => {
  it("reports the inner's own pass, not the wrapper's", () => {
    const built = buildLayer({ ...LAYER, roving: { dwell: 3200, seed: 0, epochs: 96 } });
    expect(built?.innerPass).toBe(1400);
    expect(built?.piece.duration).toBeGreaterThan(100_000);
  });

  it("reports roving's settled epoch, so a measured tenure has something to be measured against", () => {
    const built = buildLayer({ ...LAYER, roving: { dwell: 3200, seed: 0, epochs: 96 } });
    expect(built?.epochMs).toBeGreaterThan(3000);
    expect(built?.epochMs).toBeLessThan(3400);
  });

  it('reports no epoch for a layer that does not rove', () => {
    expect(buildLayer(LAYER)?.epochMs).toBeNull();
  });

  it('reports no epoch for a lamp, which cannot be roved', () => {
    const lamp: EffectLayer = { ...LAYER, kind: 'lamp', params: {}, lampSource: 'fixed' };
    expect(
      buildLayer({ ...lamp, roving: { dwell: 3200, seed: 0, epochs: 96 } })?.epochMs,
    ).toBeNull();
  });
});

describe('finestPass', () => {
  it('takes the shortest inner any enabled layer builds', () => {
    const c: Composition = {
      ...DEFAULT_COMPOSITION,
      effects: [
        { ...LAYER, id: 'a', params: { duration: 4000 } },
        { ...LAYER, id: 'b', kind: 'chase', params: { duration: 900 } },
      ],
    };
    expect(finestPass(c)).toBe(900);
  });

  it('ignores a disabled layer, which contributes no piece to sample', () => {
    const c: Composition = {
      ...DEFAULT_COMPOSITION,
      effects: [
        { ...LAYER, id: 'a', params: { duration: 4000 } },
        { ...LAYER, id: 'b', kind: 'chase', params: { duration: 900 }, enabled: false },
      ],
    };
    expect(finestPass(c)).toBe(4000);
  });

  it('answers a whole pass when no layer builds, so the sampler still has a grid', () => {
    expect(finestPass({ ...DEFAULT_COMPOSITION, effects: [] })).toBeGreaterThan(0);
  });
});
