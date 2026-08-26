import { describe, expect, it } from 'vitest';
import type { GlyphMetrics } from '../../src/text/layout.js';
import { layoutBlock } from '../../src/text/layout.js';
import { arrange, fitOf, placeBlock } from '../../src/text/placement.js';

const UPEM = 1000;
const ADVANCE = 600;
const SCALE_TO_EM = 1 / UPEM;
/** One advance in em. */
const STEP = ADVANCE / UPEM;

const metrics: GlyphMetrics = { advanceOf: () => ADVANCE, kernOf: () => 0 };
const drawsInk = (char: string) => char.trim().length > 0;

const place = (text: string) =>
  placeBlock(layoutBlock(text, metrics), SCALE_TO_EM, metrics, drawsInk);

describe('placeBlock', () => {
  it('centres a single line on x = 0', () => {
    const p = place('AB');
    // Positions are glyph origins, so the line spans x[0] to x[1] + one advance.
    expect(p.x[0]).toBeCloseTo(-STEP);
    expect(p.x[1]).toBeCloseTo(0);
  });

  it('centres each line independently', () => {
    const p = place('AB\nA');
    expect(p.x[2]).toBeCloseTo(-STEP / 2);
  });

  it('excludes a trailing space from the centring', () => {
    expect(place('AB ').x[0]).toBeCloseTo(place('AB').x[0] as number);
  });

  it('steps y down one line height per line', () => {
    const p = place('A\nB');
    expect(p.y[0]).toBeCloseTo(0);
    expect(p.y[1]).toBeCloseTo(-1.1);
  });

  it('reports the character, line, column and counts', () => {
    const p = place('AB\nC');
    expect(p.char).toEqual(['A', 'B', 'C']);
    expect(p.line).toEqual([0, 0, 1]);
    expect(p.column).toEqual([0, 1, 0]);
    expect(p.lineCount).toBe(2);
    expect(p.columnCount).toBe(2);
  });

  it('counts columns from the widest line, not the first', () => {
    expect(place('A\nBCD').columnCount).toBe(3);
  });

  it('measures the drawn ink across the block', () => {
    expect(place('AB').inkWidth).toBeCloseTo(2 * STEP);
    expect(place('AB\nC').inkWidth).toBeCloseTo(2 * STEP);
  });
});

describe('a block that draws no ink', () => {
  it('places every glyph, unshifted', () => {
    const p = place('  ');
    expect(p.x).toHaveLength(2);
    expect(p.x[0]).toBeCloseTo(0);
    expect(p.x[1]).toBeCloseTo(STEP);
  });

  it('measures no ink', () => {
    expect(place('  ').inkWidth).toBe(0);
  });

  it('is skipped by the fit rather than counted as ink at its own y', () => {
    const blank = fitOf(
      place('  '),
      { minX: [null, null], maxX: [null, null], minY: [null, null], maxY: [null, null] },
      { width: 1, height: 1 },
    );
    expect(blank.scale).toBe(2.2);
    expect(blank.midY).toBe(0);

    // A blank line counted as ink would drag the centre down to the middle of the two lines.
    const mixed = fitOf(
      place('A\n '),
      { minX: [0, null], maxX: [0.5, null], minY: [0, null], maxY: [0.7, null] },
      { width: 100, height: 100 },
    );
    expect(mixed.midY).toBeCloseTo(0.35);
  });
});

describe('arrange', () => {
  it('joins a line', () => {
    expect(arrange(['N', 'E', 'O'], 'line')).toBe('NEO');
  });

  it('breaks a stack one glyph per line', () => {
    expect(arrange(['N', 'E', 'O'], 'stack')).toBe('N\nE\nO');
  });
});

describe('fitOf', () => {
  it('scales a wide block down to the budget width', () => {
    const p = place('AAAA');
    const fit = fitOf(
      p,
      { minX: [0, 0, 0, 0], maxX: [0.5, 0.5, 0.5, 0.5], minY: [0, 0, 0, 0], maxY: [0.7, 0.7, 0.7, 0.7] },
      { width: 1, height: 10 },
    );
    // Four 0.6em advances span 2.4em of ink; a 1-wide budget scales that by 1/2.4.
    expect(fit.scale).toBeCloseTo(1 / 2.4, 4);
  });

  it('puts the vertical centre of the ink at midY', () => {
    const p = place('A');
    const fit = fitOf(p, { minX: [0], maxX: [0.5], minY: [-0.2], maxY: [0.7] }, { width: 100, height: 100 });
    expect(fit.midY).toBeCloseTo(0.25);
  });
});

describe('fitOf alignment', () => {
  /** Boxes 0.5 em wide on a 0.6 em advance, so paint and advance disagree by one side bearing. */
  const bounds = (n: number) => ({
    minX: Array(n).fill(0),
    maxX: Array(n).fill(0.5),
    minY: Array(n).fill(0),
    maxY: Array(n).fill(0.7),
  });

  it('leaves a centred word at the origin', () => {
    expect(fitOf(place('AB'), bounds(2), { width: 1.2, height: 100, extent: 4 }).offsetX).toBe(0);
    expect(
      fitOf(place('AB'), bounds(2), { width: 1.2, height: 100, extent: 4, align: 'center' }).offsetX,
    ).toBe(0);
  });

  it('puts the leftmost paint on the box edge for start', () => {
    const fit = fitOf(place('AB'), bounds(2), {
      width: 1.2,
      height: 100,
      extent: 4,
      align: 'start',
    });

    // 'AB' spans 1.2 em of advance into a 1.2-wide budget, so scale is 1; the left origin is -0.6.
    expect(fit.scale).toBeCloseTo(1, 6);
    expect(fit.offsetX + -0.6 * fit.scale).toBeCloseTo(-2, 6);
  });

  it('puts the rightmost paint on the box edge for end', () => {
    const fit = fitOf(place('AB'), bounds(2), { width: 1.2, height: 100, extent: 4, align: 'end' });

    // The last glyph's origin is 0 and its ink ends at 0.5 — not at the 0.6 its advance reaches.
    expect(fit.offsetX + 0.5 * fit.scale).toBeCloseTo(2, 6);
    expect(fit.offsetX).not.toBeCloseTo(2 - 0.6, 6);
  });

  it('aligns against the box, not the budget the fractions cut out of it', () => {
    const narrow = fitOf(place('AB'), bounds(2), {
      width: 0.6,
      height: 100,
      extent: 4,
      align: 'start',
    });

    // Half the budget halves the scale, and the paint still lands on the box's own edge.
    expect(narrow.scale).toBeCloseTo(0.5, 6);
    expect(narrow.offsetX + -0.6 * narrow.scale).toBeCloseTo(-2, 6);
  });

  it('stays at the origin when the box extent is unknown', () => {
    expect(
      fitOf(place('AB'), bounds(2), { width: 1.2, height: 100, align: 'start' }).offsetX,
    ).toBe(0);
  });

  it('stays at the origin when nothing draws', () => {
    const blank = { minX: [null, null], maxX: [null, null], minY: [null, null], maxY: [null, null] };

    expect(fitOf(place('  '), blank, { width: 1, height: 1, extent: 4, align: 'start' }).offsetX).toBe(0);
  });

  it('does not move the scale or the vertical centring', () => {
    const budget = { width: 1.2, height: 100, extent: 4 };
    const centred = fitOf(place('AB'), bounds(2), budget);

    expect(fitOf(place('AB'), bounds(2), { ...budget, align: 'start' }).scale).toBe(centred.scale);
    expect(fitOf(place('AB'), bounds(2), { ...budget, align: 'end' }).midY).toBe(centred.midY);
  });
});
