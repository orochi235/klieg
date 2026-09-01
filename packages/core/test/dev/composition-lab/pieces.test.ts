import { describe, expect, it } from 'vitest';
import { hasGradient } from '../../../dev/composition-lab/src/pieces.js';
import { type LookSpec, specOf } from '../../../src/render/looks.js';
import type { TubeSpec } from '../../../src/render/tube/index.js';

const tubing = specOf('tubing');

const withGradient: LookSpec = {
  ...tubing,
  decoration: {
    ...(tubing.decoration as TubeSpec),
    gradient: { domain: { of: 'run' }, stops: [0xff0000, 0x0000ff], mode: 'replace' },
  },
};

describe('hasGradient', () => {
  it('holds a tube look with a ramp apart from the same look without one', () => {
    expect(hasGradient(tubing)).toBe(false);
    expect(hasGradient(withGradient)).toBe(true);
  });

  it('finds no ramp on a look with no decoration at all', () => {
    expect(hasGradient('gold')).toBe(false);
  });
});
