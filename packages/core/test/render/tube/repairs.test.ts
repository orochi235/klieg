import { describe, expect, it } from 'vitest';
import { CORNER_REPAIRS, CUT_REPAIR_IDS, SPAN_REPAIRS } from '../../../src/render/tube/repairs.js';

describe('the repair registries', () => {
  it('names every repair the design does, and nothing else', () => {
    expect([...CUT_REPAIR_IDS]).toEqual([
      'stretch',
      'setback',
      'resume',
      'fillet',
      'close',
      'return',
      'hairpin',
    ]);
  });

  it('splits the two registries by where they run, with stretch in both', () => {
    expect(CORNER_REPAIRS.map((r) => r.id)).toEqual(['stretch', 'setback', 'resume']);
    expect(SPAN_REPAIRS.map((r) => r.id)).toEqual(['stretch', 'close', 'return']);
  });

  it('gives every repair a label, since the lab shows it to a person', () => {
    for (const r of [...CORNER_REPAIRS, ...SPAN_REPAIRS]) {
      expect(r.label.length).toBeGreaterThan(0);
    }
  });
});
