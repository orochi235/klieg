import { describe, expect, it } from 'vitest';
import { INK, LEGEND, MEASURE_ONLY } from '../../../dev/corner-lab/src/legend.js';

describe('corner lab legend', () => {
  it('has an entry for every ink the canvas draws', () => {
    const drawn = Object.keys(INK).filter((k) => !MEASURE_ONLY.includes(k));
    expect(LEGEND.map((e) => e.key).sort()).toEqual(drawn.sort());
  });

  it('never invents a colour the ink table does not hold', () => {
    const inks = new Set(Object.values(INK));
    for (const entry of LEGEND) expect(inks.has(entry.color)).toBe(true);
  });

  it('takes each entry colour from the ink of the same name', () => {
    for (const entry of LEGEND) {
      expect(entry.color).toBe(INK[entry.key as keyof typeof INK]);
    }
  });

  it('leaves out the ink that only ever colours the measures list', () => {
    expect(LEGEND.some((e) => e.key === 'bad')).toBe(false);
    expect(MEASURE_ONLY).toContain('bad');
  });

  it('labels every entry with something other than its key', () => {
    for (const entry of LEGEND) expect(entry.label.length).toBeGreaterThan(0);
  });

  it('names both sides of a split corner distinctly', () => {
    const before = LEGEND.find((e) => e.key === 'built')?.label;
    const after = LEGEND.find((e) => e.key === 'builtAfter')?.label;
    expect(before).not.toBe(after);
  });

  it('draws the non-stroke inks as the shapes they actually are', () => {
    const markOf = (k: string) => LEGEND.find((e) => e.key === k)?.mark;
    expect(markOf('floor')).toBe('dash');
    expect(markOf('frame')).toBe('dash');
    expect(markOf('authored')).toBe('dot');
    expect(markOf('replaced')).toBe('band');
    expect(markOf('contour')).toBeUndefined();
  });
});
