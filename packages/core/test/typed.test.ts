import { describe, expect, it } from 'vitest';
import {
  type EffectSpec,
  type EnterSlot,
  effect,
  type LightingSlot,
  lighting,
  motion,
} from '../src/index.js';

// tsc is the real assertion here: each inline `at` below must type its arguments without an
// annotation, in a slot whose union also holds a built-in name.
describe('typed patch helpers', () => {
  it('type an inline patch beside a name, and hand it back unchanged', () => {
    const enter: EnterSlot = motion({
      duration: 300,
      at: (phase, letter) => ({ position: [phase * letter.index, 0, 0] }),
    });
    const layered: EnterSlot = [
      'slam',
      motion({ duration: 300, at: (phase) => ({ scale: phase }) }),
    ];
    const env: LightingSlot = lighting({ period: 3000, at: (phase) => ({ yaw: phase }) });
    const spec: EffectSpec = {
      patch: effect({ period: 700, at: (phase, part) => ({ gain: phase * part.span }) }),
      target: { kind: 'run', by: 'index', amount: 1 },
    };

    expect(typeof enter === 'object' && 'at' in enter).toBe(true);
    expect(Array.isArray(layered)).toBe(true);
    expect(typeof env === 'object' && 'period' in env && env.period).toBe(3000);
    expect(typeof spec.patch === 'object' && spec.patch.period).toBe(700);
  });
});
