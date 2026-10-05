import { describe, expect, it } from 'vitest';
import { ACTIVE } from '../../src/motion/active.js';
import type { MotionPatch } from '../../src/motion/types.js';

const L = { index: 2, count: 6 };

// Seamlessness must be checked with a tolerance, not toEqual. Math.sin(2*PI) is -2.45e-16,
// not 0, so exact comparison fails for every sine-driven patch — which is most of them.
function expectSeamless(name: string, patch: MotionPatch): void {
  const a = patch.at(0, L);
  const b = patch.at(1, L);
  expect(Object.keys(a).sort(), `${name} contributes different keys at 0 and 1`).toEqual(
    Object.keys(b).sort(),
  );
  for (const k of ['position', 'rotation'] as const) {
    for (let i = 0; i < 3; i++) {
      expect(a[k]?.[i] ?? 0, `${name}.${k}[${i}]`).toBeCloseTo(b[k]?.[i] ?? 0, 9);
    }
  }
  for (const k of ['scale', 'opacity'] as const) {
    expect(a[k] ?? 1, `${name}.${k}`).toBeCloseTo(b[k] ?? 1, 9);
  }
}

describe('active patches', () => {
  it('loop seamlessly: at(0) matches at(1)', () => {
    for (const [name, patch] of Object.entries(ACTIVE)) expectSeamless(name, patch);
  });

  it('stay near rest — active is an idle, not a journey', () => {
    for (const [name, patch] of Object.entries(ACTIVE)) {
      for (let i = 0; i <= 20; i++) {
        const o = patch.at(i / 20, L);
        for (const v of o.position ?? []) {
          expect(Math.abs(v), `${name} position`).toBeLessThan(0.6);
        }
        if (o.scale !== undefined)
          expect(Math.abs(o.scale - 1), `${name} scale`).toBeLessThan(0.15);
      }
    }
  });

  it('none contributes nothing', () => {
    expect(ACTIVE.none.at(0.5, L)).toEqual({});
  });
});
