import { describe, expect, it } from 'vitest';
import { along, fixed, fromPointer, orbit } from '../../src/effects/lamp.js';
import type { FrameCtx } from '../../src/render/lighting.js';

const NO_POINTER: FrameCtx = { pointer: null, pointerInWord: null, dt: 16 };
const AT: FrameCtx = { pointer: { x: 0.5, y: -0.5 }, pointerInWord: { x: 1.2, y: 0.3 }, dt: 16 };

describe('fixed', () => {
  it('ignores both time and pointer', () => {
    expect(fixed(0.8, 0.2)(0, NO_POINTER)).toEqual({ x: 0.8, y: 0.2 });
    expect(fixed(0.8, 0.2)(0.75, AT)).toEqual({ x: 0.8, y: 0.2 });
  });
});

describe('fromPointer', () => {
  // Rest, not the origin: the origin is the middle of the word, where a lamp would light the
  // centre letter on a page nobody has touched.
  it('yields null until the pointer has been inside', () => {
    expect(fromPointer()(0, NO_POINTER)).toBeNull();
  });

  it('reads the pointer already projected into the word', () => {
    expect(fromPointer()(0, AT)).toEqual({ x: 1.2, y: 0.3 });
  });

  it('passes the projected point through a supplied map', () => {
    const source = fromPointer((p) => ({ x: p.x * 2, y: 0 }));
    expect(source(0, AT)).toEqual({ x: 2.4, y: 0 });
  });
});

describe('orbit', () => {
  it('starts at the right of the circle and comes back after one turn', () => {
    const source = orbit({ radius: 2 });
    const start = source(0, NO_POINTER);
    expect(start).toEqual({ x: 2, y: 0 });
    expect(source(1, NO_POINTER)?.x).toBeCloseTo(2);
    expect(source(0.25, NO_POINTER)?.y).toBeCloseTo(2);
  });

  it('orbits around a non-zero, non-symmetric center', () => {
    const source = orbit({ radius: 1, x: 5, y: 7 });
    expect(source(0, NO_POINTER)).toEqual({ x: 6, y: 7 });
    const quarter = source(0.25, NO_POINTER);
    expect(quarter?.x).toBeCloseTo(5);
    expect(quarter?.y).toBeCloseTo(8);
  });
});

describe('along', () => {
  it('walks the path end to end across the pass', () => {
    const source = along([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
    expect(source(0, NO_POINTER)).toEqual({ x: 0, y: 0 });
    expect(source(0.5, NO_POINTER)?.x).toBeCloseTo(2);
    expect(source(1, NO_POINTER)?.x).toBeCloseTo(4);
  });

  it('picks the correct segment across a multi-point path', () => {
    const source = along([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(source(0.25, NO_POINTER)).toEqual({ x: 5, y: 0 });
    const threeQuarters = source(0.75, NO_POINTER);
    expect(threeQuarters?.x).toBeCloseTo(10);
    expect(threeQuarters?.y).toBeCloseTo(5);
    const end = source(1, NO_POINTER);
    expect(end?.x).toBeCloseTo(10);
    expect(end?.y).toBeCloseTo(10);
  });

  it('refuses a path with nothing to walk', () => {
    expect(() => along([])).toThrow(/at least two points/);
  });
});
