import type { Font, PathCommand } from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { WordCaches } from '../../../src/render/caches.js';
import { cutterFor } from '../../../src/render/wells/cutters.js';
import { regionOf } from '../../../src/render/wells/region.js';
import type { LoadedFont } from '../../../src/text/font.js';

const UPEM = 1000;
const ADVANCE = 600;

/** Box spanning `bottom`..`top` in three's y-up space; opentype paths are y-down. */
function boxPath(w: number, top: number, bottom: number): PathCommand[] {
  return [
    { type: 'M', x: 0, y: -bottom },
    { type: 'L', x: w, y: -bottom },
    { type: 'L', x: w, y: -top },
    { type: 'L', x: 0, y: -top },
    { type: 'Z' },
  ];
}

/** Chars are 0.5 em wide boxes rising 0.7 em. */
function stubFont(): LoadedFont {
  const font = {
    charToGlyph: () => ({
      advanceWidth: ADVANCE,
      getPath: (_x: number, _y: number, size: number) => ({
        commands: boxPath(0.5 * size, 0.7 * size, 0),
        toPathData: () => 'M0 0',
      }),
    }),
  } as unknown as Font;

  return {
    font,
    unitsPerEm: UPEM,
    key: '/f.ttf',
    family: 'klieg-test-cutters',
    metrics: { advanceOf: () => ADVANCE, kernOf: () => 0 },
    bytes: new ArrayBuffer(0),
  };
}

const SPEC = {
  kind: 'well',
  cutter: 'lattice',
  bezel: 0.012,
  floor: 0.09,
  pitch: 0.068,
  size: 0.048,
  look: {},
} as const;

function cutBox(overrides = {}) {
  const shapes = new WordCaches().shapes(stubFont(), 'A');
  return cutterFor('lattice')(shapes, regionOf(shapes), { ...SPEC, ...overrides } as never);
}

describe('the lattice cutter', () => {
  it('fills a box with wells and takes its floor from the spec', () => {
    const cut = cutBox();
    expect(cut.wells.length).toBeGreaterThan(10);
    expect(cut.floor).toBe(0.09);
  });

  it('keeps every well inside the bezel', () => {
    const shapes = new WordCaches().shapes(stubFont(), 'A');
    const region = regionOf(shapes);
    for (const well of cutBox().wells) {
      for (const p of well.getPoints(1)) {
        expect(region.contains(p.x, p.y, 0)).toBe(true);
      }
    }
  });

  // The corners, not the centre: a centre clearing the bezel by less than the half-diagonal still
  // hangs the well off the letter's edge, and a count alone would never show it.
  it('rejects a well whose corners leave the bezel even though its centre does not', () => {
    expect(cutBox({ size: 0.048 }).wells.length).toBeGreaterThan(cutBox({ size: 0.3 }).wells.length);
  });

  it('places fewer wells as the bezel grows', () => {
    expect(cutBox({ bezel: 0.1 }).wells.length).toBeLessThan(cutBox({ bezel: 0.012 }).wells.length);
  });

  it('throws on a cutter nobody registered', () => {
    expect(() => cutterFor('spiral')).toThrow(/spiral/);
  });
});
