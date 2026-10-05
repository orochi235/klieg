import { describe, expect, it } from 'vitest';
import { ACTIVE } from '../../src/motion/active.js';
import { ENTER } from '../../src/motion/enter.js';
import { EXIT } from '../../src/motion/exit.js';
import type { MotionPatch } from '../../src/motion/types.js';
import { GOLDEN } from './golden.js';

// The vocabulary rewrite has to reproduce these numbers exactly — a diff here is a re-tune
// wearing a refactor's clothes, and nothing else in the suite would catch one.
const COUNT = 5;
const STEPS = 20;
const CHANNELS = ['px', 'py', 'pz', 'rx', 'ry', 'rz', 'scale', 'opacity'];

function sample(patch: MotionPatch): number[] {
  const out: number[] = [];
  for (let s = 0; s <= STEPS; s++) {
    const t = s / STEPS;
    for (let index = 0; index < COUNT; index++) {
      const o = patch.at(t, { index, count: COUNT });
      const p = o.position ?? [0, 0, 0];
      const r = o.rotation ?? [0, 0, 0];
      out.push(...p, ...r, o.scale ?? 1, o.opacity ?? 1);
    }
  }
  // 9 places keeps float noise out while still pinning every constant that matters. Negative
  // zero is folded in: JSON writes it as 0, so a round-trip would never match under Object.is.
  return out.map((v) => {
    const n = Number(v.toFixed(9));
    return n === 0 ? 0 : n;
  });
}

function capture(): Record<string, number[]> {
  const all: Record<string, number[]> = {};
  for (const [name, patch] of Object.entries(ENTER)) all[`enter.${name}`] = sample(patch);
  for (const [name, patch] of Object.entries(ACTIVE)) all[`active.${name}`] = sample(patch);
  for (const [name, patch] of Object.entries(EXIT)) all[`exit.${name}`] = sample(patch);
  return all;
}

describe('motion golden', () => {
  it('every patch samples as it did before the vocabulary rewrite', () => {
    const now = capture();
    const drift: string[] = [];

    for (const [name, want] of Object.entries(GOLDEN)) {
      const got = now[name];
      if (!got) {
        drift.push(`${name}: patch is gone`);
        continue;
      }
      if (got.length !== want.length) {
        drift.push(`${name}: ${got.length} samples, expected ${want.length}`);
        continue;
      }
      for (let i = 0; i < want.length; i++) {
        const a = want[i] as number;
        const b = got[i] as number;
        // A tolerance, not equality: `(1 - e) * a` and `a + (0 - a) * e` are the same number
        // mathematically and differ in the last bit, and the constructors reassociate every
        // expression. 1e-8 is still five orders tighter than any change you could see.
        if (Math.abs(a - b) > 1e-8) {
          const slot = Math.floor(i / CHANNELS.length);
          drift.push(
            `${name} t=${(Math.floor(slot / COUNT) / STEPS).toFixed(2)} letter=${slot % COUNT} ` +
              `${CHANNELS[i % CHANNELS.length]}: expected ${a}, got ${b}`,
          );
          break;
        }
      }
    }

    expect(drift, `motion drifted:\n${drift.join('\n')}`).toEqual([]);
  });

  it('samples every patch the library ships', () => {
    // Twelve real patches plus the shared `none` under each of the three slots. `sweep` left the
    // vocabulary when lighting became its own option; it never contributed a transform.
    expect(Object.keys(capture())).toHaveLength(15);
  });

  it('pins durations too, which the offset samples cannot see', () => {
    const durations = {
      ...Object.fromEntries(Object.entries(ENTER).map(([n, p]) => [`enter.${n}`, p.duration])),
      ...Object.fromEntries(Object.entries(ACTIVE).map(([n, p]) => [`active.${n}`, p.duration])),
      ...Object.fromEntries(Object.entries(EXIT).map(([n, p]) => [`exit.${n}`, p.duration])),
    };

    expect(durations).toEqual({
      'enter.slam': 900,
      'enter.spin': 1100,
      'enter.flip': 1000,
      'enter.assemble': 1200,
      'enter.rise': 900,
      'enter.none': 0,
      'active.float': 5200,
      'active.pulse': 1600,
      'active.shimmer': 2600,
      'active.none': 0,
      'exit.shatter': 800,
      'exit.drop': 700,
      'exit.recede': 650,
      'exit.fade': 500,
      'exit.none': 0,
    });
  });
});
