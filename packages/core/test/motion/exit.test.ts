import { describe, expect, it } from 'vitest';
import { EXIT } from '../../src/motion/exit.js';
import { accumulate, REST } from '../../src/pose.js';

const L = { index: 1, count: 6 };

describe('exit patches', () => {
  it('every patch starts at the rest pose at t=0', () => {
    for (const [name, patch] of Object.entries(EXIT)) {
      const p = accumulate(REST, [patch.at(0, L)]);
      expect(p.position, `${name} position`).toEqual([0, 0, 0]);
      expect(p.scale, `${name} scale`).toBeCloseTo(1, 5);
      expect(p.opacity, `${name} opacity`).toBeCloseTo(1, 5);
    }
  });

  it('every patch except none is fully invisible at t=1', () => {
    for (const [name, patch] of Object.entries(EXIT)) {
      if (name === 'none') continue;
      expect(accumulate(REST, [patch.at(1, L)]).opacity, `${name}`).toBeCloseTo(0, 5);
    }
  });

  it('none is a true no-op at every t', () => {
    for (let i = 0; i <= 10; i++) {
      const p = accumulate(REST, [EXIT.none.at(i / 10, L)]);
      expect(p).toEqual(REST);
    }
  });

  it('drop accelerates downward rather than moving linearly', () => {
    const first = Math.abs(EXIT.drop.at(0.25, L).position?.[1] ?? 0);
    const later = Math.abs(EXIT.drop.at(0.75, L).position?.[1] ?? 0);
    expect(later).toBeGreaterThan(first * 3);
  });

  it('shatter throws letters apart in different directions', () => {
    const a = EXIT.shatter.at(1, { index: 0, count: 6 }).position?.[0] ?? 0;
    const b = EXIT.shatter.at(1, { index: 3, count: 6 }).position?.[0] ?? 0;
    expect(a).not.toBeCloseTo(b, 2);
  });

  // A single bad number silently vanishes a letter with no error, so this is sampled
  // densely across letters, counts, and t.
  it('every patch is finite everywhere', () => {
    const counts = [1, 3, 6, 12];
    for (const [name, patch] of Object.entries(EXIT)) {
      for (const count of counts) {
        for (let index = 0; index < count; index++) {
          for (let i = 0; i <= 40; i++) {
            const t = i / 40;
            const o = patch.at(t, { index, count });
            const nums = [...(o.position ?? []), ...(o.rotation ?? []), o.scale, o.opacity].filter(
              (v): v is number => v !== undefined,
            );
            for (const v of nums) {
              expect(Number.isFinite(v), `${name} t=${t} index=${index}/${count}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it('opacity never leaves [0, 1]', () => {
    for (const [name, patch] of Object.entries(EXIT)) {
      for (const letter of [L, { index: 0, count: 6 }, { index: 2, count: 3 }]) {
        for (let i = 0; i <= 40; i++) {
          const t = i / 40;
          const o = patch.at(t, letter);
          if (o.opacity === undefined) continue;
          expect(o.opacity, `${name} t=${t}`).toBeGreaterThanOrEqual(0);
          expect(o.opacity, `${name} t=${t}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
