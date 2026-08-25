import { describe, expect, it } from 'vitest';
import { EFFECTS, flicker } from '../../src/effects/pieces.js';
import type { EffectPiece, PartInfo } from '../../src/effects/types.js';

const part: PartInfo = {
  kind: 'run',
  index: 0,
  count: 4,
  letter: { index: 0, count: 1 },
  x: 0,
  y: 0,
  at: 0,
  span: 1,
};

const SAMPLES = 200;

/** Samples one pass at a fixed rate, so a claim about the whole cycle is not read off one frame. */
function gainsAcrossOnePass(
  piece: EffectPiece = flicker(),
  which: PartInfo = part,
  steps = SAMPLES,
): number[] {
  return Array.from({ length: steps }, (_, n) => piece.at(n / steps, which).gain as number);
}

/** Lengths, in samples, of each maximal stretch spent dark. */
function darkRuns(gains: number[], threshold = 0.5): number[] {
  const runs: number[] = [];
  let run = 0;
  for (const g of gains) {
    if (g < threshold) run++;
    else if (run > 0) {
      runs.push(run);
      run = 0;
    }
  }
  if (run > 0) runs.push(run);
  return runs;
}

describe('flicker', () => {
  it('writes only gain, leaving every other channel to another layer', () => {
    const out = flicker().at(0.5, part);
    expect(Object.keys(out)).toEqual(['gain']);
  });

  it('stays inside 0..1', () => {
    for (const g of gainsAcrossOnePass()) {
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
    }
  });

  it('spends most of the pass lit, which is what makes the stutter read as a fault', () => {
    const lit = gainsAcrossOnePass().filter((g) => g > 0.8).length;
    expect(lit).toBeGreaterThan(120);
  });

  it('actually drops dark somewhere in the pass', () => {
    expect(Math.min(...gainsAcrossOnePass())).toBeLessThan(0.2);
  });

  it('stutters in several short excursions rather than one long dropout', () => {
    const runs = darkRuns(gainsAcrossOnePass());
    expect(runs.length).toBeGreaterThan(1);
    expect(Math.max(...runs)).toBeLessThan(SAMPLES * 0.15);
    // A drop must also hold: one sample is under a frame at 60fps, which reads as static noise
    // rather than as a tube going out.
    expect(Math.min(...runs)).toBeGreaterThanOrEqual(SAMPLES * 0.02);
  });

  it('is deterministic in t, across a whole pass and across separately built pieces', () => {
    expect(gainsAcrossOnePass(flicker())).toEqual(gainsAcrossOnePass(flicker()));
  });

  it('gives two parts different stutters, so a pair does not blink in lockstep', () => {
    const piece = flicker();
    // Compared as timing, not as values: two parts dropping together to different depths is
    // still lockstep, and would pass a comparison of the raw gains.
    const when = (index: number) =>
      gainsAcrossOnePass(piece, { ...part, index }).map((g) => g < 0.5);
    expect(when(0)).not.toEqual(when(1));
  });

  it('takes a depth that bounds how dark it goes', () => {
    expect(Math.min(...gainsAcrossOnePass(flicker({ depth: 0.5 })))).toBeGreaterThanOrEqual(0.5);
  });

  it('is reachable by name', () => {
    expect(typeof EFFECTS.flicker).toBe('function');
  });
});
