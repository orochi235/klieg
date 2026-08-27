import { describe, expect, it } from 'vitest';
import {
  type Composition,
  DEFAULT_COMPOSITION,
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
