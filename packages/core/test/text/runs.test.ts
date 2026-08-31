import { describe, expect, it } from 'vitest';
import { styledRunsOf, type TextRun, tintOf } from '../../src/text/runs.js';

describe('styledRunsOf', () => {
  it('turns a bare string into one run', () => {
    expect(styledRunsOf('HI', 'display')).toEqual([
      { text: 'HI', fontFamily: 'display', fontSize: 1 },
    ]);
  });

  it('gives each run the fire-wide font unless it names its own', () => {
    const runs: TextRun[] = [{ text: 'A' }, { text: 'B', font: 'body' }];
    expect(styledRunsOf(runs, 'display').map((r) => r.fontFamily)).toEqual(['display', 'body']);
  });

  it('carries size as a font scale, not an absolute size', () => {
    expect(styledRunsOf([{ text: 'x', size: 0.5 }], 'display')[0]?.fontSize).toBeCloseTo(0.5);
  });

  it('drops an empty run rather than laying out nothing', () => {
    expect(styledRunsOf([{ text: '' }, { text: 'A' }], 'display')).toHaveLength(1);
  });
});

describe('tintOf', () => {
  it('has no per-slot tint for a plain string', () => {
    expect(tintOf('AB')(0)).toBeUndefined();
  });

  it('gives every code point of a run the tint that run names', () => {
    const at = tintOf([{ text: 'AB', tint: 0xff0000 }, { text: 'C' }]);
    expect([at(0), at(1), at(2)]).toEqual([0xff0000, 0xff0000, undefined]);
  });

  it('counts an astral character as one slot, not a surrogate pair', () => {
    const at = tintOf([
      { text: '\u{1F600}', tint: 1 },
      { text: 'A', tint: 2 },
    ]);
    expect([at(0), at(1)]).toEqual([1, 2]);
  });
});
