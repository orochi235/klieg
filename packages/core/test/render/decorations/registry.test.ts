import type { Font, PathCommand } from 'opentype.js';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WordCaches } from '../../../src/render/caches.js';
import type { WordBuildContext } from '../../../src/render/decorations/registry.js';
import { decorationBuilderFor } from '../../../src/render/decorations/registry.js';
import { createMaterial, specOf } from '../../../src/render/looks.js';
import type { LoadedFont } from '../../../src/text/font.js';

const ctx = {} as WordBuildContext;

describe('decorationBuilderFor', () => {
  it('has a factory registered for each shipped kind', () => {
    expect(decorationBuilderFor(specOf('sequin').decoration, wordContext())).not.toBeNull();
    // Until Task 3 lands, reaching the tube factory is the most that can be asserted — it throws
    // on construction rather than answering a builder.
    expect(() => decorationBuilderFor({ kind: 'tube' } as never, ctx)).toThrow(
      'tube builder not yet implemented',
    );
  });

  it('answers null for no decoration at all', () => {
    expect(decorationBuilderFor(undefined, ctx)).toBeNull();
  });

  // A spec that reached here with a kind nobody registered is a wiring bug, and a silent null
  // would render an undecorated word rather than say so.
  it('throws on a kind nobody registered', () => {
    expect(() => decorationBuilderFor({ kind: 'well' } as never, ctx)).toThrow(/well/);
  });
});

describe('ChunksBuilder', () => {
  it('adds one instanced draw per letter that drew ink', () => {
    const spec = specOf('sequin');
    const decoration = spec.decoration;
    if (decoration?.kind !== 'chunks') throw new Error('sequin is not a chunk look');

    const builder = decorationBuilderFor(decoration, wordContext());
    if (!builder) throw new Error('no builder');
    const sized = new THREE.Group();
    builder.buildLetter(0, 'A', sized, undefined);

    const instanced = sized.children.filter((c) => (c as THREE.InstancedMesh).isInstancedMesh);
    expect(instanced).toHaveLength(1);
    expect(builder.collectParts()).toHaveLength(1);
    builder.dispose();
  });

  it('leaves a letter that drew no ink out of the pool without shifting the slots after it', () => {
    const decoration = specOf('sequin').decoration;
    const builder = decorationBuilderFor(decoration, wordContext());
    if (!builder) throw new Error('no builder');
    builder.skipLetter(0);
    builder.buildLetter(1, 'A', new THREE.Group(), undefined);

    expect(builder.lightAt(0)).toBeNull();
    expect(builder.lightAt(1)).not.toBeNull();
    const parts = builder.collectParts();
    expect(parts).toHaveLength(1);
    expect(parts[0]?.slot).toBe(1);
    builder.dispose();
  });

  // A chunk field covers its whole letter, so it has no box of its own to hand the gradient span.
  it('offers no gradient bounds', () => {
    const builder = decorationBuilderFor(specOf('sequin').decoration, wordContext());
    if (!builder) throw new Error('no builder');
    builder.buildLetter(0, 'A', new THREE.Group(), undefined);
    expect(builder.boundsAt(0)).toBeNull();
    builder.dispose();
  });
});

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

/** Chars are 0.5 em wide boxes rising 0.7 em — enough area for a field to scatter over. */
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
    family: 'klieg-test-decorations',
    metrics: { advanceOf: () => ADVANCE, kernOf: () => 0 },
    bytes: new ArrayBuffer(0),
  };
}

function wordContext(): WordBuildContext {
  const font = stubFont();
  const caches = new WordCaches();
  return {
    font,
    caches,
    baseX: [0, 0],
    baseY: [0, 0],
    // `createMaterial`, not a bare physical material: `applyLook` writes flake uniforms the
    // studio's own hook installs, and a material without them throws.
    studioMaterial: () => createMaterial(null),
    glyph: (char, depth) => caches.glyph(font, char, depth),
    leavingAt: () => false,
    partInfo: (kind, ordinal, of, slot, at, span) =>
      ({ kind, ordinal, of, slot, at, span }) as never,
    meshInk: () => 1 as never,
  };
}
