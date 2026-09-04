import type { Font, PathCommand } from 'opentype.js';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WordCaches } from '../../../src/render/caches.js';
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
