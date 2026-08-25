import { describe, expect, it } from 'vitest';
import { ENTER } from '../../src/motion/enter.js';
import { accumulate, REST } from '../../src/pose.js';

const L = { index: 0, count: 6 };
const LAST = { index: 5, count: 6 };

describe('enter pieces', () => {
  it('every piece lands on the rest pose at t=1', () => {
    for (const [name, piece] of Object.entries(ENTER)) {
      for (const letter of [L, LAST]) {
        const p = accumulate(REST, [piece.offset(1, letter)]);
        expect(p.position, `${name} position`).toEqual([0, 0, 0]);
        expect(p.scale, `${name} scale`).toBeCloseTo(1, 5);
        expect(p.opacity, `${name} opacity`).toBeCloseTo(1, 5);
      }
    }
  });

  it('every piece starts displaced from rest at t=0', () => {
    for (const [name, piece] of Object.entries(ENTER)) {
      if (name === 'none') continue; // `none` contributes nothing by definition
      const o = piece.offset(0, L);
      const moved =
        (o.position?.some((v) => v !== 0) ?? false) ||
        (o.rotation?.some((v) => v !== 0) ?? false) ||
        (o.scale !== undefined && o.scale !== 1) ||
        (o.opacity !== undefined && o.opacity !== 1);
      expect(moved, `${name} should displace at t=0`).toBe(true);
    }
  });

  it('slam approaches from behind the camera and overshoots', () => {
    expect(ENTER.slam.offset(0, L).position?.[2]).toBeLessThan(0);
    const zs = Array.from(
      { length: 50 },
      (_, i) => ENTER.slam.offset(i / 49, L).position?.[2] ?? 0,
    );
    expect(Math.max(...zs)).toBeGreaterThan(0);
  });

  it('spin staggers: the last letter lags the first', () => {
    const first = Math.abs(ENTER.spin.offset(0.4, L).rotation?.[1] ?? 0);
    const last = Math.abs(ENTER.spin.offset(0.4, LAST).rotation?.[1] ?? 0);
    expect(last).toBeGreaterThan(first);
  });

  // (a) flip's opacity is a deliberate hard cut, not a fade: invisible while edge-on,
  // fully visible once past the cutoff. If this regresses to a fade, this must fail.
  it('flip pops into visibility rather than fading', () => {
    expect(ENTER.flip.offset(0, L).opacity).toBe(0);
    expect(ENTER.flip.offset(1, L).opacity).toBe(1);
  });

  // The step exists to keep a half-turned letter — which reads as a stray edge — out of sight
  // until it is nearly face-on. Endpoint checks pass whichever way the comparison runs, so these
  // pin the angle it actually appears at.
  it('flip appears only once it is nearly face-on', () => {
    let appeared: number | null = null;
    for (let i = 0; i <= 1000; i++) {
      const t = i / 1000;
      if (ENTER.flip.offset(t, L).opacity === 1) {
        appeared = t;
        break;
      }
    }
    expect(appeared, 'flip never becomes visible').not.toBeNull();
    const turn = (ENTER.flip.offset(appeared as number, L).rotation ?? [0, 0, 0])[0] as number;
    expect(Math.abs((turn * 180) / Math.PI)).toBeLessThan(15);
  });

  it('flip stays hidden while it is edge-on or further', () => {
    for (let i = 0; i <= 1000; i++) {
      const o = ENTER.flip.offset(i / 1000, L);
      const turn = Math.abs((((o.rotation ?? [0, 0, 0])[0] as number) * 180) / Math.PI);
      if (turn >= 90) expect(o.opacity, `at ${turn.toFixed(0)} degrees from rest`).toBe(0);
    }
  });

  // (b) assemble's scatter must be deterministic and per-letter distinct: no RNG, no
  // Date.now — repeated calls with the same args are identical, and different indices scatter
  // to genuinely different places (not clustered).
  it('assemble scatters deterministically and distinctly per letter', () => {
    const a1 = ENTER.assemble.offset(0.3, { index: 0, count: 6 });
    const a2 = ENTER.assemble.offset(0.3, { index: 0, count: 6 });
    expect(a1).toEqual(a2);

    const b = ENTER.assemble.offset(0.3, { index: 3, count: 6 });
    const pa = a1.position ?? [0, 0, 0];
    const pb = b.position ?? [0, 0, 0];
    const dist = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
    expect(dist).toBeGreaterThan(1);
  });

  // (c) assemble should read as "assembling", not "fading in" — opacity must be fully
  // resolved by the midpoint, well ahead of the positional settle at t=1.
  it('assemble reaches full opacity by t=0.5', () => {
    expect(ENTER.assemble.offset(0.5, L).opacity).toBeCloseTo(1, 5);
    expect(ENTER.assemble.offset(0.5, LAST).opacity).toBeCloseTo(1, 5);
  });

  // (d) no piece may ever emit NaN/Infinity: a single bad number silently vanishes a letter
  // with no error, so this is sampled densely across letters, counts, and t.
  it('every piece is finite everywhere', () => {
    const counts = [1, 3, 6, 12];
    for (const [name, piece] of Object.entries(ENTER)) {
      for (const count of counts) {
        for (let index = 0; index < count; index++) {
          for (let i = 0; i <= 40; i++) {
            const t = i / 40;
            const o = piece.offset(t, { index, count });
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

  // (e) opacity is a visual alpha and must stay within [0, 1] for every piece, everywhere sampled.
  it('opacity never leaves [0, 1]', () => {
    for (const [name, piece] of Object.entries(ENTER)) {
      for (const letter of [L, LAST, { index: 2, count: 3 }]) {
        for (let i = 0; i <= 40; i++) {
          const t = i / 40;
          const o = piece.offset(t, letter);
          if (o.opacity === undefined) continue;
          expect(o.opacity, `${name} t=${t}`).toBeGreaterThanOrEqual(0);
          expect(o.opacity, `${name} t=${t}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  // (f) slam must reach its full depth (-26) at t=0, not merely "some negative number".
  // A broken backOut that flattens to [1.0, 1.281] would produce 0 here instead.
  it('slam reaches full depth of -26 at t=0', () => {
    expect(ENTER.slam.offset(0, L).position?.[2]).toBeCloseTo(-26, 5);
  });
});
