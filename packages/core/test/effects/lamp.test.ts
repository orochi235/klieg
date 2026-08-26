import { describe, expect, it } from 'vitest';
import { along, fixed, fromPointer, lamp, orbit } from '../../src/effects/lamp.js';
import type { PartInfo } from '../../src/effects/types.js';
import { AT, NO_CTX } from './ctx.js';

describe('fixed', () => {
  it('ignores both time and pointer', () => {
    expect(fixed(0.8, 0.2)(0, NO_CTX)).toEqual({ x: 0.8, y: 0.2 });
    expect(fixed(0.8, 0.2)(0.75, AT)).toEqual({ x: 0.8, y: 0.2 });
  });
});

describe('fromPointer', () => {
  // Rest, not the origin: the origin is the middle of the word, where a lamp would light the
  // centre letter on a page nobody has touched.
  it('yields null until the pointer has been inside', () => {
    expect(fromPointer()(0, NO_CTX)).toBeNull();
  });

  it('reads the pointer already mapped into the word', () => {
    expect(fromPointer()(0, AT)).toEqual({ x: 1.2, y: 0.3 });
  });

  it('passes the mapped point through a supplied map', () => {
    const source = fromPointer((p) => ({ x: p.x * 2, y: 0 }));
    expect(source(0, AT)).toEqual({ x: 2.4, y: 0 });
  });
});

describe('orbit', () => {
  it('starts at the right of the circle and comes back after one turn', () => {
    const source = orbit({ radius: 2 });
    const start = source(0, NO_CTX);
    expect(start).toEqual({ x: 2, y: 0 });
    expect(source(1, NO_CTX)?.x).toBeCloseTo(2);
    expect(source(0.25, NO_CTX)?.y).toBeCloseTo(2);
  });

  it('orbits around a non-zero, non-symmetric center', () => {
    const source = orbit({ radius: 1, x: 5, y: 7 });
    expect(source(0, NO_CTX)).toEqual({ x: 6, y: 7 });
    const quarter = source(0.25, NO_CTX);
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
    expect(source(0, NO_CTX)).toEqual({ x: 0, y: 0 });
    expect(source(0.5, NO_CTX)?.x).toBeCloseTo(2);
    expect(source(1, NO_CTX)?.x).toBeCloseTo(4);
  });

  it('picks the correct segment across a multi-point path', () => {
    const source = along([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(source(0.25, NO_CTX)).toEqual({ x: 5, y: 0 });
    const threeQuarters = source(0.75, NO_CTX);
    expect(threeQuarters?.x).toBeCloseTo(10);
    expect(threeQuarters?.y).toBeCloseTo(5);
    const end = source(1, NO_CTX);
    expect(end?.x).toBeCloseTo(10);
    expect(end?.y).toBeCloseTo(10);
  });

  it('refuses a path with nothing to walk', () => {
    expect(() => along([])).toThrow(/at least two points/);
  });
});

const partAt = (x: number, y = 0): PartInfo => ({
  kind: 'body',
  index: 0,
  count: 1,
  letter: { index: 0, count: 1 },
  x,
  y,
  at: 0,
  span: 1,
});

describe('lamp', () => {
  it('is brightest at its centre and dark past its radius', () => {
    const piece = lamp({ source: fixed(0, 0), radius: 1, strength: 2 });
    expect(piece.at(0, partAt(0), NO_CTX).light?.amount).toBeCloseTo(2);
    expect(piece.at(0, partAt(1), NO_CTX).light?.amount ?? 0).toBeCloseTo(0);
    expect(piece.at(0, partAt(5), NO_CTX).light?.amount ?? 0).toBeCloseTo(0);
  });

  it('falls off between the two', () => {
    const piece = lamp({ source: fixed(0, 0), radius: 1, strength: 1 });
    const near = piece.at(0, partAt(0.25), NO_CTX).light?.amount as number;
    const far = piece.at(0, partAt(0.75), NO_CTX).light?.amount as number;
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
  });

  it('measures distance in both axes', () => {
    const piece = lamp({ source: fixed(0, 0), radius: 1, strength: 1 });
    expect(piece.at(0, partAt(0, 0.5), NO_CTX).light?.amount).toBeCloseTo(
      piece.at(0, partAt(0.5, 0), NO_CTX).light?.amount as number,
    );
  });

  it('moves with a time-driven source rather than reading it at a fixed phase', () => {
    const piece = lamp({ source: orbit({ radius: 3 }), radius: 1 });
    expect(piece.at(0, partAt(3), NO_CTX)).not.toEqual({});
    expect(piece.at(0.5, partAt(3), NO_CTX)).toEqual({});
  });

  // A page nobody has touched must not light a letter as though the cursor were parked on it.
  it('contributes nothing when its source has nowhere to be', () => {
    const piece = lamp({ source: fromPointer(), radius: 1, strength: 2 });
    expect(piece.at(0, partAt(0), NO_CTX)).toEqual({});
  });

  it('defaults to the cursor', () => {
    const piece = lamp();
    expect(piece.duration).toBe(4000);
    expect(piece.at(0, partAt(1.2, 0.3), NO_CTX)).toEqual({});
    expect(piece.at(0, partAt(1.2, 0.3), AT)).not.toEqual({});
  });

  it('writes only the light channel, leaving every other channel to another layer', () => {
    const piece = lamp({ source: fixed(0, 0) });
    expect(Object.keys(piece.at(0, partAt(0), NO_CTX))).toEqual(['light']);
  });

  it('carries its own colour, at the default strength and radius', () => {
    const piece = lamp({ source: fixed(0, 0), color: 0xff8800 });
    const centre = piece.at(0, partAt(0), NO_CTX);
    expect(centre.light?.color).toBe(0xff8800);
    expect(centre.light?.amount).toBeCloseTo(2);
    expect(piece.at(0, partAt(0.5), NO_CTX)).toEqual({});
  });

  // A linear ramp passes centre/edge/near>far too; this pins the smoothstep shape specifically.
  it('follows a smoothstep curve rather than a linear ramp', () => {
    const piece = lamp({ source: fixed(0, 0), radius: 1, strength: 1 });
    expect(piece.at(0, partAt(0.25), NO_CTX).light?.amount).toBeCloseTo(0.84375);
  });

  it('contributes nothing when the radius is zero or negative', () => {
    const piece = lamp({ source: fixed(0, 0), radius: 0, strength: 2 });
    expect(piece.at(0, partAt(0), NO_CTX)).toEqual({});
  });

  it('treats a non-finite radius or source position as no light, not full light', () => {
    const far = partAt(99);
    const at = (radius: number, x = 0) =>
      lamp({ source: fixed(x, 0), radius, strength: 2 }).at(0, far, NO_CTX);
    expect(at(1)).toEqual({}); // sane control: 99em is well past a radius of 1
    expect(at(Number.NaN)).toEqual({});
    expect(at(Number.POSITIVE_INFINITY)).toEqual({});
    expect(at(1, Number.NaN)).toEqual({});
  });
});
