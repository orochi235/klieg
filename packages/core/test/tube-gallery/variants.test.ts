import { describe, expect, it } from 'vitest';
import {
  effectsFor,
  lookFor,
  sweepIsVisible,
  VARIANTS,
  type Variant,
} from '../../dev/tube-gallery/src/variants.js';
import { specOf } from '../../src/render/looks.js';

const PLAIN: Variant = { id: 'plain', label: 'plain' };

describe('VARIANTS', () => {
  it('names every cell distinctly', () => {
    expect(new Set(VARIANTS.map((v) => v.id)).size).toBe(VARIANTS.length);
  });

  it('builds a tube look for every one', () => {
    for (const variant of VARIANTS) {
      const look = lookFor(variant);
      expect(look.decoration?.kind, variant.id).toBe('tube');
    }
  });

  it('leaves the shipped look untouched, however many cells are built', () => {
    const before = JSON.stringify(specOf('tubing'));
    for (const variant of VARIANTS) lookFor(variant);
    expect(JSON.stringify(specOf('tubing'))).toBe(before);
  });
});

describe('effectsFor', () => {
  it('targets runs, the only kind a tube decoration builds', () => {
    const [effect] = effectsFor(PLAIN);
    expect(effect?.target).toMatchObject({ kind: 'run' });
  });

  it('takes the whole pool when no share is named', () => {
    expect(effectsFor(PLAIN)[0]?.target).not.toHaveProperty('amount');
  });

  it('carries a named share through to the selection', () => {
    expect(effectsFor({ ...PLAIN, amount: 0.5 })[0]?.target).toMatchObject({ amount: 0.5 });
  });
});

describe('sweepIsVisible', () => {
  const gradient = (mode: 'replace' | 'modulate') => ({
    domain: { of: 'axis' as const },
    stops: [0xff0000, 0x00ff00],
    mode,
  });

  it('refuses a replace gradient, which paints over the sweep', () => {
    expect(() => lookFor({ ...PLAIN, tube: { gradient: gradient('replace') } })).toThrow(/replace/);
  });

  it('allows a modulate gradient, which multiplies against it', () => {
    expect(() => lookFor({ ...PLAIN, tube: { gradient: gradient('modulate') } })).not.toThrow();
  });
});
