import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CORNER_REPAIRS,
  CUT_REPAIR_IDS,
  popStretch,
  SPAN_REPAIRS,
  trimStretch,
} from '../../../src/render/tube/repairs.js';

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

describe('the two stretches', () => {
  const line = () => Array.from({ length: 5 }, (_, i) => new THREE.Vector3(i / 10, 0, 0));

  it('lets the corner-side stretch empty a span', () => {
    const span = line();
    popStretch(span, 99);
    expect(span).toHaveLength(0);
  });

  it('pops exactly count vertices off the tail', () => {
    const span = line();
    popStretch(span, 2);
    expect(span.map((p) => p.x)).toEqual([0, 0.1, 0.2]);
  });

  it('floors the break-side stretch at two vertices', () => {
    expect(trimStretch(line(), 99, 'tail')).toHaveLength(2);
    expect(trimStretch(line(), 99, 'head')).toHaveLength(2);
  });

  it('trims exactly count vertices off the tail, keeping the head', () => {
    expect(trimStretch(line(), 2, 'tail').map((p) => p.x)).toEqual([0, 0.1, 0.2]);
  });

  it('trims exactly count vertices off the head, keeping the tail', () => {
    expect(trimStretch(line(), 2, 'head').map((p) => p.x)).toEqual([0.2, 0.3, 0.4]);
  });
});
