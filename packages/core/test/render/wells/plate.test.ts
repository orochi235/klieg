import type { Font, PathCommand } from 'opentype.js';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WordCaches } from '../../../src/render/caches.js';
import { cutterFor } from '../../../src/render/wells/cutters.js';
import { buildPlate, mergeNonIndexed } from '../../../src/render/wells/plate.js';
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
    family: 'klieg-test-plate',
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

describe('mergeNonIndexed', () => {
  it('concatenates positions and keeps the attribute triple', () => {
    const a = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const b = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const merged = mergeNonIndexed([a, b]);
    expect(merged.getAttribute('position').count).toBe(
      a.getAttribute('position').count + b.getAttribute('position').count,
    );
    expect(merged.getAttribute('normal')).toBeDefined();
    expect(merged.getIndex()).toBeNull();
  });

  // An indexed part would concatenate its positions and silently drop its triangles.
  it('refuses an indexed part rather than dropping its index', () => {
    expect(() => mergeNonIndexed([new THREE.BoxGeometry(1, 1, 1)])).toThrow(/indexed/);
  });
});

describe('buildPlate', () => {
  it('spans the full letter depth and costs more than the plain glyph', () => {
    const caches = new WordCaches();
    const shapes = caches.shapes(stubFont(), 'A');
    const cut = cutterFor('lattice')(shapes, regionOf(shapes), SPEC as never);
    const geo = buildPlate(shapes, cut, { depth: 0.3, bezel: SPEC.bezel });
    geo.computeBoundingBox();
    const box = geo.boundingBox as THREE.Box3;
    // Against the plain glyph, not a constant: three hangs the bevel `bevelThickness` past each
    // end of the extrusion, so a 0.3-deep letter's front face sits at 0.355.
    const plain = caches.glyph(stubFont(), 'A', 0.3);
    expect(box.max.z).toBeCloseTo((plain.boundingBox as THREE.Box3).max.z, 5);
    expect(geo.getAttribute('position').count).toBeGreaterThan(
      plain.getAttribute('position').count,
    );
  });

  // The cached array is shared by every letter of the same char; adding holes to it would give the
  // second 'A' the first one's wells on top of its own.
  it('leaves the shapes it was handed unholed', () => {
    const shapes = new WordCaches().shapes(stubFont(), 'A');
    const before = (shapes[0] as THREE.Shape).holes.length;
    const cut = cutterFor('lattice')(shapes, regionOf(shapes), SPEC as never);
    buildPlate(shapes, cut, { depth: 0.3, bezel: SPEC.bezel });
    expect((shapes[0] as THREE.Shape).holes).toHaveLength(before);
  });

  it('cuts nothing when the cutter found no room', () => {
    const shapes = new WordCaches().shapes(stubFont(), 'A');
    const empty = buildPlate(shapes, { wells: [], floor: 0.09 }, { depth: 0.3, bezel: 0.012 });
    expect(empty.getAttribute('position').count).toBeGreaterThan(0);
  });

  // `buildGlyphGeometry` cuts sharp corners back before extruding, because three's miter cap
  // leaves a nub past the tip of a letter otherwise. A plate that skips it brings that spur back.
  it('chamfers a sharp corner the way the plain extruder does', () => {
    const spike = new THREE.Shape();
    spike.moveTo(0, 0);
    spike.lineTo(1, 0);
    spike.lineTo(0.02, 0.06);
    spike.closePath();
    const geo = buildPlate([spike], { wells: [], floor: 0.09 }, { depth: 0.3, bezel: 0.012 });
    geo.computeBoundingBox();
    // Chamfered this tip reaches 1.020; unchamfered the miter runs it to 1.054, which is as far
    // as three's sqrt(2) cap allows. A looser bound than that passes either way.
    expect((geo.boundingBox as THREE.Box3).max.x).toBeLessThan(1.03);
  });
});
