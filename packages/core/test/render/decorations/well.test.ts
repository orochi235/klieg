import type { Font, PathCommand } from 'opentype.js';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WordCaches } from '../../../src/render/caches.js';
import type { WellSpec } from '../../../src/render/decoration.js';
import type { WordBuildContext } from '../../../src/render/decorations/registry.js';
import { WellBuilder } from '../../../src/render/decorations/well.js';
import { createMaterial } from '../../../src/render/looks.js';
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

/** Chars are 0.5 em wide boxes rising 0.7 em — big enough to seat a lattice. */
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
    family: 'klieg-test-well',
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
} as const satisfies WellSpec;

function context(): WordBuildContext {
  const caches = new WordCaches();
  const font = stubFont();
  return {
    font,
    caches,
    baseX: [0, 1],
    baseY: [0, 0],
    studioMaterial: () => createMaterial(null),
    glyph: (char, depth) => caches.glyph(font, char, depth),
    shapes: (char) => caches.shapes(font, char),
    partInfo: (kind, index, count, slot, at, span, ink, fill) => ({
      kind,
      fill,
      index,
      count,
      letter: { index: slot, count: 2 },
      x: 0,
      y: 0,
      ink: ink ?? { minX: 0, maxX: 0, minY: 0, maxY: 0 },
      at,
      span,
    }),
    meshInk: () => ({ minX: 0, maxX: 0, minY: 0, maxY: 0 }),
  };
}

describe('WellBuilder', () => {
  it('adds one instanced draw per letter, holding every seat', () => {
    const builder = new WellBuilder({ ...SPEC, fill: 'stone' }, context());
    const group = new THREE.Group();
    builder.buildLetter(0, 'A', group, undefined);
    const mesh = group.children[0] as THREE.InstancedMesh;
    expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(mesh.count).toBeGreaterThan(4);
    builder.dispose();
  });

  it('contributes one part per letter that drew stones, naming the fill', () => {
    const builder = new WellBuilder({ ...SPEC, fill: 'stone' }, context());
    builder.buildLetter(0, 'A', new THREE.Group(), undefined);
    builder.skipLetter(1);
    const parts = builder.collectParts();
    expect(parts).toHaveLength(1);
    expect(parts[0]?.info.fill).toBe('stone');
    expect(parts[0]?.info.kind).toBe('chunk');
    builder.dispose();
  });

  // The path every existing `well` spec takes, and the one this slice must not disturb.
  it('leaves the wells empty when no fill is named', () => {
    const builder = new WellBuilder(SPEC, context());
    const group = new THREE.Group();
    builder.buildLetter(0, 'A', group, undefined);
    expect(group.children).toHaveLength(0);
    expect(builder.collectParts()).toEqual([]);
    builder.dispose();
  });

  it('still answers a carved body whether or not a fill was named', () => {
    for (const spec of [SPEC, { ...SPEC, fill: 'stone' } as const]) {
      const builder = new WellBuilder(spec, context());
      const geo = builder.bodyGeometry('A', 0.3);
      expect(geo.getAttribute('position').count).toBeGreaterThan(0);
      builder.dispose();
    }
  });
});
