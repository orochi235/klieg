import type { Font, PathCommand } from 'opentype.js';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { PartInfo, ResolvedOffset } from '../../../src/effects/types.js';
import type { LetterInfo } from '../../../src/motion/types.js';
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
    const builder = decorationBuilderFor(specOf('sequin').decoration, wordContext());
    if (!builder) throw new Error('no builder');
    builder.skipLetter(0);
    builder.buildLetter(1, 'A', new THREE.Group(), undefined);

    const parts = builder.collectParts();
    expect(parts).toHaveLength(1);
    expect(parts[0]?.slot).toBe(1);

    // Slot-indexed, not push-packed: letter 1's light has to answer at slot 1 and nothing at 0.
    const mesh = parts[0]?.mesh as THREE.InstancedMesh;
    const material = mesh.material as THREE.MeshPhysicalMaterial;
    builder.writePart(0, mesh, lamplight());
    const unlit = material.emissive.getHex();
    builder.writePart(1, mesh, lamplight());
    expect(material.emissive.getHex()).not.toBe(unlit);
    builder.dispose();
  });

  // The one leak the visual gate cannot see: a relief look clones the chunk geometry per letter,
  // and a clone nothing disposes shows up on `sequin` alone.
  it('disposes every relief clone it made', () => {
    const decoration = specOf('sequin').decoration;
    if (decoration?.kind !== 'chunks' || !decoration.relief) {
      throw new Error('sequin no longer carries relief');
    }
    const builder = decorationBuilderFor(decoration, wordContext());
    if (!builder) throw new Error('no builder');
    const sized = new THREE.Group();
    builder.buildLetter(0, 'A', sized, undefined);
    builder.buildLetter(1, 'A', sized, undefined);

    const clones = sized.children.map((c) => (c as THREE.InstancedMesh).geometry);
    expect(new Set(clones).size).toBe(2);
    const spies = clones.map((geometry) => vi.spyOn(geometry, 'dispose'));
    builder.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
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
    partInfo: (kind, index, count, slot, at, span, ink = INK) => ({
      kind,
      index,
      count,
      letter: letterInfo(slot),
      x: 0,
      y: 0,
      ink,
      line: 0,
      column: slot,
      lineCount: 1,
      columnCount: 2,
      at,
      span,
    }),
    meshInk: () => INK,
  };
}

const INK: PartInfo['ink'] = { minX: 0, maxX: 0.5, minY: 0, maxY: 0.7 };

function letterInfo(slot: number): LetterInfo {
  return {
    char: 'A',
    index: slot,
    count: 2,
    line: 0,
    column: slot,
    lineCount: 1,
    columnCount: 2,
    x: 0,
    y: 0,
  };
}

/** A white lamp at full strength, which is what makes a lit part distinguishable from an unlit one. */
function lamplight(): ResolvedOffset {
  return {
    gain: 1,
    dark: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
    crawl: 0,
    light: [1, 1, 1],
  };
}
