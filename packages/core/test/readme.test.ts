import { describe, expect, it } from 'vitest';
import * as bk from '../src/index.js';

/**
 * The README teaches an API by name. A rename that misses the prose leaves a copy-pasteable
 * example that throws, which no other test would notice.
 */
describe('documented surface', () => {
  it('exports everything the README tells people to import', () => {
    for (const name of [
      'createKlieg',
      'transition',
      'cycle',
      'spring',
      'stagger',
      'ManualClock',
      'ENTER_NAMES',
      'ACTIVE_NAMES',
      'EXIT_NAMES',
      'LOOK_NAMES',
      'POLICY_NAMES',
      'sweep',
      'still',
      'track',
      'lamp',
      'fixed',
      'orbit',
      'along',
      'fromPointer',
      'linear',
      'easeOutCubic',
      'easeInCubic',
      'easeInOutCubic',
      'backOut',
    ]) {
      expect(bk, name).toHaveProperty(name);
    }
  });

  it('builds the README motion example', () => {
    const swoop = bk.transition(800, {
      from: { position: [0, -6, 0], opacity: 0 },
      ease: bk.spring({ stiffness: 180, damping: 11 }),
      stagger: { each: 0.06, from: 'center' },
    });

    expect(swoop.duration).toBe(800);
    expect(swoop.offset(0, { index: 0, count: 4 }).opacity).toBeCloseTo(0, 6);
    expect(swoop.offset(1, { index: 0, count: 4 }).opacity).toBeCloseTo(1, 6);
  });
});
