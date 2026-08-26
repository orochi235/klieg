import { describe, expect, it } from 'vitest';
import { chase, EFFECTS, flicker, hue } from '../../src/effects/pieces.js';
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

  /** Shortest dark stretch in milliseconds, which is what a step length actually means on screen. */
  function shortestDropMs(piece: EffectPiece, samples = 4000): number {
    const runs = darkRuns(gainsAcrossOnePass(piece, part, samples));
    return Math.min(...runs) * (piece.duration / samples);
  }

  // A step is ~58ms so a drop covers about three frames. Holding 24 steps against a long pass turns
  // that into a multi-second strobe, which is a different effect wearing the same name.
  it('holds a step near 58ms however long the pass is', () => {
    // Pinned, not banded: a 40-80ms band admits 1400/25, which moves every frame of every shipped
    // flicker() while staying green.
    expect(shortestDropMs(flicker(), 40000)).toBeCloseTo(1400 / 24, 0);
    expect(shortestDropMs(flicker({ duration: 30000 }))).toBeLessThan(80);
  });

  /** Longest continuously-lit stretch in milliseconds — the calm, when there is one. */
  function longestCalmMs(piece: EffectPiece, samples = 4000): number {
    const gains = gainsAcrossOnePass(piece, part, samples);
    let best = 0;
    let run = 0;
    for (const g of gains) {
      if (g >= 0.5) {
        run++;
        best = Math.max(best, run);
      } else run = 0;
    }
    return best * (piece.duration / samples);
  }

  // A calm alone used to invent a one-step spell, inflating the pass tenfold for an effect
  // indistinguishable from a steady tube.
  it('leaves the pass alone when only one of the two scales is given', () => {
    expect(flicker({ calm: 15000 }).duration).toBe(1400);
    expect(gainsAcrossOnePass(flicker({ calm: 15000 }))).toEqual(gainsAcrossOnePass(flicker()));
    expect(flicker({ spell: Number.NaN, calm: 15000 }).duration).toBe(1400);
  });

  it('leaves the pass alone when no calm is asked for', () => {
    expect(flicker({ spell: 4000 }).duration).toBe(1400);
    expect(gainsAcrossOnePass(flicker({ spell: 4000 }))).toEqual(gainsAcrossOnePass(flicker()));
  });

  // 4000ms is 69 steps and 15000ms is 257, so a cycle is 326 steps and three of them fit 60s.
  it('fits the pass to a whole number of spells', () => {
    expect(flicker({ duration: 60000, spell: 4000, calm: 15000 }).duration).toBe(57050);
  });

  // The tube goes quiet for the calm, which is the whole point of the macro scale.
  it('holds the tube lit for the calm between spells', () => {
    const piece = flicker({ duration: 60000, spell: 4000, calm: 15000 });
    expect(longestCalmMs(piece)).toBeGreaterThan(13000);
    expect(longestCalmMs(piece)).toBeLessThan(17000);
  });

  // A gate boundary landing mid-step clips a drop to a single frame, which reads as noise rather
  // than as a failing tube — the thing the step length exists to prevent.
  it('lands every gate boundary on a step edge', () => {
    const piece = flicker({ duration: 60000, spell: 4000, calm: 15000 });
    expect(shortestDropMs(piece, 20000)).toBeGreaterThan(40);
  });

  it('still stutters inside a spell', () => {
    const piece = flicker({ duration: 60000, spell: 4000, calm: 15000 });
    expect(darkRuns(gainsAcrossOnePass(piece, part, 4000)).length).toBeGreaterThan(15);
  });

  // The gate and the stutter share one clock, so each bout samples a different stretch of the hash.
  // A second clock — or a step index that restarts per bout — makes every bout identical instead.
  // The sample count must not be a multiple of the pass's step count: sampling on the step grid
  // lands every third sample on an edge, where float residue alone makes identical bouts compare
  // unequal and the test stops seeing the defect.
  it('gives each spell its own stutter rather than repeating one', () => {
    const piece = flicker({ duration: 60000, spell: 4000, calm: 15000 });
    const gains = gainsAcrossOnePass(piece, part, 2937);
    const third = gains.length / 3;
    const drops = (from: number) => gains.slice(from, from + third).filter((g) => g < 1);
    expect(drops(0).length).toBeGreaterThan(20);
    expect(drops(0)).not.toEqual(drops(third));
  });

  // cycles rounds rather than floors, so a pass that is nearer three bouts than two gets three.
  it('rounds the pass to the nearest whole number of spells rather than down', () => {
    expect(flicker({ duration: 50000, spell: 4000, calm: 15000 }).duration).toBe(57050);
  });
});

describe('hue', () => {
  it('writes only colour, leaving gain to another layer', () => {
    expect(Object.keys(hue().at(0.5, part))).toEqual(['color']);
  });

  it('travels the whole wheel by default, and is seamless across the loop', () => {
    const piece = hue();
    const seen = new Set(
      Array.from({ length: 120 }, (_, n) => piece.at(n / 120, part).color as number),
    );
    expect(seen.size).toBeGreaterThan(90);
    // span defaults to a whole turn, so the end of a pass is the start of the next one.
    expect(piece.at(1, part).color).toBe(piece.at(0, part).color);
  });

  it('takes an arc, so a look can throb rather than cycle', () => {
    const spread = (p: EffectPiece) =>
      new Set(
        Array.from({ length: 60 }, (_, n) => ((p.at(n / 60, part).color as number) >> 16) & 0xff),
      ).size;
    expect(spread(hue({ from: 0.5, span: 0.1 }))).toBeLessThan(spread(hue()));
    expect(hue({ from: 0.5, span: 0.1 }).at(0, part).color).toBe(
      hue({ from: 0.5, span: 1 }).at(0, part).color,
    );
  });

  it('gives every part the same colour when unspread, which is one sign changing together', () => {
    const piece = hue();
    expect(piece.at(0.3, { ...part, index: 0, at: 0 }).color).toBe(
      piece.at(0.3, { ...part, index: 3, at: 0.75 }).color,
    );
  });

  it('offsets by arc-length share when spread, which is a gradient down the word', () => {
    const piece = hue({ spread: 0.5 });
    expect(piece.at(0.3, { ...part, at: 0 }).color).not.toBe(
      piece.at(0.3, { ...part, at: 0.75 }).color,
    );
    // The offset is in turns, so a part three quarters along at spread 0.5 reads the same hue the
    // whole sign reads 0.375 turns later.
    expect(piece.at(0, { ...part, at: 0.75 }).color).toBe(
      piece.at(0.375, { ...part, at: 0 }).color,
    );
  });

  it('is deterministic in t, across separately built pieces', () => {
    const of = (p: EffectPiece) =>
      Array.from({ length: 50 }, (_, n) => p.at(n / 50, part).color as number);
    expect(of(hue())).toEqual(of(hue()));
  });

  it('is reachable by name', () => {
    expect(typeof EFFECTS.hue).toBe('function');
  });
});

describe('the public surface', () => {
  it('names every registry piece in EFFECT_NAMES', async () => {
    const { EFFECT_NAMES } = await import('../../src/index.js');
    expect([...EFFECT_NAMES].sort()).toEqual(['chase', 'flicker', 'hue']);
  });

  it('exports roving as a factory, since no name can carry an inner piece', async () => {
    const api = await import('../../src/index.js');
    expect(typeof api.roving).toBe('function');
    expect(typeof api.roving(api.EFFECTS.flicker()).at).toBe('function');
  });
});

describe('chase', () => {
  const P = part;

  it('travels one ramp length per pass by default', () => {
    const p = chase();
    expect(p.at(0, P).crawl).toBe(0);
    expect(p.at(0.5, P).crawl).toBe(0.5);
    expect(p.at(1, P).crawl).toBe(1);
  });

  it('runs backwards on a negative lap count', () => {
    expect(chase({ laps: -1 }).at(0.25, P).crawl).toBe(-0.25);
  });

  // The shader wraps with fract, so the piece is free to hand out an unwrapped offset — and must,
  // or a spread would collapse every part onto the same phase once it crossed 1.
  it('hands out an unwrapped offset, leaving the wrap to the shader', () => {
    expect(chase({ laps: 3 }).at(1, P).crawl).toBe(3);
  });

  it('spreads consecutive parts so the chase reads as a procession', () => {
    const p = chase({ spread: 0.25 });
    const a = p.at(0, { ...P, at: 0 }).crawl as number;
    const b = p.at(0, { ...P, at: 1 }).crawl as number;
    expect(b - a).toBeCloseTo(0.25, 9);
  });

  it('is usable with no spec, which is all a name lookup can supply', () => {
    expect(EFFECTS.chase().duration).toBeGreaterThan(0);
  });
});
