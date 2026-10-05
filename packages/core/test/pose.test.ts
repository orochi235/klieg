import { describe, expect, it } from 'vitest';
import { accumulate, REST, scaleDelta } from '../src/pose.js';

describe('pose algebra', () => {
  it('accumulating no offsets leaves the rest pose untouched', () => {
    expect(accumulate(REST, [])).toEqual(REST);
  });

  it('adds positions and rotations, multiplies scale and opacity', () => {
    const p = accumulate(REST, [
      { position: [1, 2, 3], rotation: [0, 0.5, 0], scale: 2, opacity: 0.5 },
      { position: [1, 0, 0], rotation: [0, 0.5, 0], scale: 3, opacity: 0.5 },
    ]);
    expect(p.position).toEqual([2, 2, 3]);
    expect(p.rotation).toEqual([0, 1, 0]);
    expect(p.scale).toBe(6);
    expect(p.opacity).toBe(0.25);
  });

  it('treats omitted fields as identity', () => {
    expect(accumulate(REST, [{ scale: 2 }])).toEqual({ ...REST, scale: 2 });
  });

  it('scaleDelta at weight 0 is the identity offset', () => {
    const o = scaleDelta({ position: [4, 4, 4], scale: 3, opacity: 0 }, 0);
    expect(accumulate(REST, [o])).toEqual(REST);
  });

  it('scaleDelta at weight 1 is unchanged', () => {
    const o = { position: [4, 0, 0] as [number, number, number], scale: 3 };
    expect(scaleDelta(o, 1)).toEqual(o);
  });

  it('scaleDelta interpolates scale toward 1, not toward 0', () => {
    expect(scaleDelta({ scale: 3 }, 0.5).scale).toBe(2);
  });

  it('does not mutate its base pose, its offsets, or the shared REST singleton', () => {
    const base = {
      position: [1, 1, 1] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: 1,
      opacity: 1,
    };
    const baseSnapshot = structuredClone(base);
    const offsets = [
      {
        position: [1, 0, 0] as [number, number, number],
        rotation: [0, 1, 0] as [number, number, number],
        scale: 2,
        opacity: 0.5,
      },
      { position: [0, 1, 0] as [number, number, number], scale: 3 },
    ];
    const offsetsSnapshot = structuredClone(offsets);
    const restSnapshot = structuredClone(REST);

    accumulate(base, offsets);
    accumulate(REST, offsets);
    accumulate(REST, []);

    expect(base).toEqual(baseSnapshot);
    expect(offsets).toEqual(offsetsSnapshot);
    expect(REST).toEqual(restSnapshot);
  });

  it('is order-independent when accumulating multiple offsets', () => {
    const a = {
      position: [1, 0, 0] as [number, number, number],
      rotation: [0, 1, 0] as [number, number, number],
      scale: 2,
      opacity: 0.5,
    };
    const b = {
      position: [0, 2, 0] as [number, number, number],
      rotation: [1, 0, 0] as [number, number, number],
      scale: 3,
      opacity: 0.5,
    };
    const c = {
      position: [0, 0, 3] as [number, number, number],
      rotation: [0, 0, 1] as [number, number, number],
      scale: 0.5,
      opacity: 2,
    };

    const forward = accumulate(REST, [a, b, c]);
    const reversed = accumulate(REST, [c, b, a]);
    const shuffled = accumulate(REST, [b, c, a]);

    expect(reversed).toEqual(forward);
    expect(shuffled).toEqual(forward);
  });

  it('scaleDelta on an empty offset returns an empty offset with no spurious keys', () => {
    const scaled = scaleDelta({}, 0.5);
    expect(scaled).toEqual({});
    expect(Object.keys(scaled)).toHaveLength(0);
    expect(accumulate(REST, [scaled])).toEqual(REST);
  });
});
