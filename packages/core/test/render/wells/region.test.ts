import type { Font, PathCommand } from 'opentype.js';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WordCaches } from '../../../src/render/caches.js';
import { lazyRegion, regionOf } from '../../../src/render/wells/region.js';
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
    family: 'klieg-test-region',
    metrics: { advanceOf: () => ADVANCE, kernOf: () => 0 },
    bytes: new ArrayBuffer(0),
  };
}

function boxRegion() {
  const caches = new WordCaches();
  return regionOf(caches.shapes(stubFont(), 'A'));
}

describe('regionOf', () => {
  it('holds a point further inside than the clearance asked for', () => {
    expect(boxRegion().contains(0.25, 0.35, 0.2)).toBe(true);
  });

  it('rejects the same point at a clearance it does not have', () => {
    expect(boxRegion().contains(0.25, 0.35, 0.3)).toBe(false);
  });

  it('rejects a point near the edge', () => {
    expect(boxRegion().contains(0.02, 0.35, 0.05)).toBe(false);
  });

  it('rejects a point outside the glyph entirely', () => {
    expect(boxRegion().contains(-0.1, 0.35, 0)).toBe(false);
  });

  // A counter is boundary to the field exactly as an outline is, which is the whole reason this
  // needs no separate hole handling.
  it('rejects a point inside a counter', () => {
    const outer = new THREE.Shape();
    outer.moveTo(0, 0);
    outer.lineTo(1, 0);
    outer.lineTo(1, 1);
    outer.lineTo(0, 1);
    outer.closePath();
    const hole = new THREE.Path();
    hole.moveTo(0.4, 0.4);
    hole.lineTo(0.6, 0.4);
    hole.lineTo(0.6, 0.6);
    hole.lineTo(0.4, 0.6);
    hole.closePath();
    outer.holes.push(hole);
    const region = regionOf([outer]);
    expect(region.contains(0.5, 0.5, 0)).toBe(false);
    expect(region.contains(0.15, 0.5, 0.05)).toBe(true);
  });
});

// `tile` needs no region, and the field is most of what one costs — so the builder hands every
// cutter one that is only built when read.
describe('lazyRegion', () => {
  it('builds nothing until read', () => {
    // `regionOf` throws on a glyph with no ink, so a lazy one over nothing throws only on use.
    const region = lazyRegion([]);
    expect(() => region.field).toThrow(/ink/);
  });

  it('answers what regionOf does once read', () => {
    const shapes = new WordCaches().shapes(stubFont(), 'A');
    const lazy = lazyRegion(shapes, 'proportional');
    const eager = regionOf(shapes, 'proportional');
    for (const [x, y, c] of [
      [0.25, 0.35, 0.2],
      [0.02, 0.35, 0.05],
      [-0.1, 0.35, 0],
    ] as const) {
      expect(lazy.contains(x, y, c)).toBe(eager.contains(x, y, c));
    }
    expect(lazy.levelFor(0.1)).toBe(eager.levelFor(0.1));
  });
});

// A uniform bezel takes the same absolute amount off both sides of every stroke, so a thin stroke
// loses a larger fraction of itself and the letter's own contrast is exaggerated — worse than
// cosmetic here, because it is what decides how much of a thin stroke a cutter may fill.
describe('a proportional region', () => {
  /** Two bars, one 0.20 em across and one 0.06 em, far enough apart not to share a ridge. */
  const bars = () => {
    const bar = (x0: number, x1: number) => {
      const s = new THREE.Shape();
      s.moveTo(x0, 0);
      s.lineTo(x1, 0);
      s.lineTo(x1, 0.6);
      s.lineTo(x0, 0.6);
      s.closePath();
      return s;
    };
    return [bar(0, 0.2), bar(0.4, 0.46)];
  };

  const THICK = 0.1;
  const THIN = 0.03;
  /** A fifth of the thickest stroke's half-width, so both readings are well clear of the grid. */
  const BEZEL = THICK / 5;

  /** How far either side of a bar's centre line the region still holds, in em. */
  const reach = (region: ReturnType<typeof regionOf>, cx: number, bezel: number) => {
    let far = 0;
    for (let d = 0; d < 0.1; d += 0.0005) {
      if (region.contains(cx + d, 0.3, bezel)) far = d;
    }
    return far;
  };

  it('takes the same fraction off a thin stroke as off a thick one', () => {
    const region = regionOf(bars(), 'proportional');
    expect(reach(region, 0.1, BEZEL) / THICK).toBeCloseTo(0.8, 1);
    expect(reach(region, 0.43, BEZEL) / THIN).toBeCloseTo(0.8, 1);
  });

  it('leaves a thin stroke a third of itself where a thick one keeps four fifths', () => {
    const region = regionOf(bars());
    expect(regionOf(bars(), 'uniform').contains(0.43, 0.3, BEZEL)).toBe(
      region.contains(0.43, 0.3, BEZEL),
    );
    // The thick bar keeps four fifths of itself either way; the thin one keeps a third.
    expect(reach(region, 0.1, BEZEL) / THICK).toBeCloseTo(0.8, 1);
    expect(reach(region, 0.43, BEZEL) / THIN).toBeCloseTo(1 / 3, 1);
  });

  it('leaves the thickest stroke measuring the bezel it was given', () => {
    const uniform = reach(regionOf(bars()), 0.1, BEZEL);
    const scaled = reach(regionOf(bars(), 'proportional'), 0.1, BEZEL);
    expect(scaled).toBeCloseTo(uniform, 2);
  });
});
