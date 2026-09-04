import type { Font, PathCommand } from 'opentype.js';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { PartInfo, ResolvedOffset } from '../../../src/effects/types.js';
import type { LetterInfo } from '../../../src/motion/types.js';
import { WordCaches } from '../../../src/render/caches.js';
import type {
  DecorationBuilder,
  DecorationPart,
  WordBuildContext,
} from '../../../src/render/decorations/registry.js';
import { decorationBuilderFor } from '../../../src/render/decorations/registry.js';
import { createMaterial, specOf } from '../../../src/render/looks.js';
import { RUN_COLOR_ATTRIBUTE } from '../../../src/render/tube/tint.js';
import type { WordDebugHooks } from '../../../src/render/word.js';
import type { LoadedFont } from '../../../src/text/font.js';

const ctx = {} as WordBuildContext;

describe('decorationBuilderFor', () => {
  it('has a factory registered for each shipped kind', () => {
    expect(decorationBuilderFor(specOf('sequin').decoration, wordContext())).not.toBeNull();
    expect(decorationBuilderFor(specOf('tubing').decoration, wordContext())).not.toBeNull();
  });

  it('answers null for no decoration at all', () => {
    expect(decorationBuilderFor(undefined, ctx)).toBeNull();
  });

  // A spec that reached here with a kind nobody registered is a wiring bug, and a silent null
  // would render an undecorated word rather than say so.
  it('throws on a kind nobody registered', () => {
    expect(() => decorationBuilderFor({ kind: 'etching' } as never, ctx)).toThrow(/etching/);
  });
});

const WELL_SPEC = {
  kind: 'well',
  cutter: 'lattice',
  bezel: 0.012,
  floor: 0.09,
  pitch: 0.068,
  size: 0.048,
  look: {},
};

function wellBuilder() {
  const builder = decorationBuilderFor(WELL_SPEC as never, wordContext());
  if (!builder) throw new Error('no builder');
  return builder;
}

describe('WellBuilder', () => {
  it('carves a body that costs more than the plain glyph', () => {
    const builder = wellBuilder();
    const geo = builder.bodyGeometry?.('A', 0.3);
    expect(geo).toBeDefined();
    const carved = (geo as THREE.BufferGeometry).getAttribute('position').count;
    expect(carved).toBeGreaterThan(0);
    builder.dispose();
  });

  it('answers one geometry per char, however many letters ask', () => {
    const builder = wellBuilder();
    expect(builder.bodyGeometry?.('A', 0.3)).toBe(builder.bodyGeometry?.('A', 0.3));
    expect(builder.bodyGeometry?.('B', 0.3)).not.toBe(builder.bodyGeometry?.('A', 0.3));
    builder.dispose();
  });

  it('adds nothing to the letter group — the wells are in the body', () => {
    const builder = wellBuilder();
    const sized = new THREE.Group();
    builder.buildLetter(0, 'A', sized, undefined);
    expect(sized.children).toHaveLength(0);
    builder.dispose();
  });

  it('contributes no parts, because a well has no fill to target yet', () => {
    const builder = wellBuilder();
    builder.buildLetter(0, 'A', new THREE.Group(), undefined);
    expect(builder.collectParts()).toEqual([]);
    expect(builder.boundsAt(0)).toBeNull();
    builder.dispose();
  });

  // `collectParts()` walks "highest index written + 1" for every other builder, so a trailing
  // hole is the case that distinguishes it from the letter count. This builder keeps no
  // per-letter array — if one is ever added, assert alignment once **per array**, because a
  // single assertion stays green while a different array is the one that slipped.
  it('survives a hole at either end of the letter run', () => {
    const builder = wellBuilder();
    builder.skipLetter(0);
    builder.buildLetter(1, 'A', new THREE.Group(), undefined);
    builder.skipLetter(2);
    expect(builder.collectParts()).toEqual([]);
    expect(() => builder.frame(1, 1)).not.toThrow();
    builder.dispose();
  });

  it('leaves the shipped kinds without a body of their own', () => {
    const tube = decorationBuilderFor(specOf('tubing').decoration, wordContext());
    expect(tube?.bodyGeometry).toBeUndefined();
    tube?.dispose();
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
    const part = parts[0] as DecorationPart;
    const material = (part.mesh as THREE.InstancedMesh).material as THREE.MeshPhysicalMaterial;
    builder.writePart({ ...part, slot: 0 }, lamplight());
    const unlit = material.emissive.getHex();
    builder.writePart(part, lamplight());
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

describe('TubeBuilder', () => {
  it('adds a mesh per lit run and contributes each as a part', () => {
    const decoration = specOf('tubing').decoration;
    if (decoration?.kind !== 'tube') throw new Error('tubing is not a tube look');

    const builder = decorationBuilderFor(decoration, wordContext());
    if (!builder) throw new Error('no builder');
    const sized = new THREE.Group();
    builder.buildLetter(0, 'A', sized, undefined);

    const parts = builder.collectParts();
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.every((p) => p.info.kind === 'run')).toBe(true);
    expect(parts.every((p) => sized.children.includes(p.mesh))).toBe(true);
    expect(builder.boundsAt(0)).not.toBeNull();
    builder.dispose();
  });

  it('leaves a letter that drew no ink out of the pool and lends it no bounds', () => {
    const builder = tubeBuilder();
    builder.skipLetter(0);
    expect(builder.boundsAt(0)).toBeNull();
    expect(builder.collectParts()).toHaveLength(0);
    builder.dispose();
  });

  // One assertion per per-letter array: a single check keyed on `parts[0].slot` catches a
  // misaligned mesh array but stays green when a different one slipped, which lands letter 0's
  // state on letter 1. The trailing hole is what distinguishes `collectParts` walking the arrays
  // from it walking the letter count.
  describe('with a hole either side of the only letter that drew ink', () => {
    it('keeps the gradient bounds on the letter that grew them', () => {
      const builder = holed();
      expect(builder.boundsAt(0)).toBeNull();
      expect(builder.boundsAt(1)).not.toBeNull();
      expect(builder.boundsAt(2)).toBeNull();
      builder.dispose();
    });

    it('hangs every run part off the letter that drew it', () => {
      const builder = holed();
      const parts = builder.collectParts();
      expect(parts.length).toBeGreaterThan(0);
      expect(parts.every((p) => p.slot === 1)).toBe(true);
      builder.dispose();
    });

    it('dims the lit material of that letter alone', () => {
      const builder = holed();
      const material = builder.collectParts()[0]?.mesh.material as THREE.Material;
      builder.frame(0, 0.25);
      expect(material.opacity).toBe(1);
      builder.frame(1, 0.25);
      expect(material.opacity).toBe(0.25);
      builder.dispose();
    });

    it('dims the dark material of that letter alone', () => {
      const dark = new THREE.MeshPhysicalMaterial();
      const builder = holed({ tubeMaterial: (which) => (which === 'dark' ? dark : undefined) });
      builder.frame(0, 0.25);
      expect(dark.opacity).toBe(1);
      builder.frame(1, 0.25);
      expect(dark.opacity).toBe(0.25);
      builder.dispose();
    });

    it('carries the run-colour contract from the slot that drew the run', () => {
      const builder = holed();
      const part = builder.collectParts()[0] as DecorationPart;
      const buffer = runColorBuffer(part);
      const base = [...buffer];
      builder.writePart(part, lamplight());
      expect([...buffer]).not.toEqual(base);
      builder.dispose();
    });
  });

  /**
   * The one failure nothing else observes: a swept geometry carries the run-colour attribute
   * whatever material it wears, so writing it under an override that never samples it changes no
   * pixel and throws nothing.
   */
  it('leaves the run-colour buffer alone under a lit-material override', () => {
    const builder = tubeBuilder({
      tubeMaterial: (which) => (which === 'lit' ? new THREE.MeshBasicMaterial() : undefined),
    });
    builder.buildLetter(0, 'A', new THREE.Group(), undefined);
    const part = builder.collectParts()[0] as DecorationPart;
    const buffer = runColorBuffer(part);
    const base = [...buffer];

    builder.writePart(part, lamplight());

    expect([...buffer]).toEqual(base);
    builder.dispose();
  });
});

function runColorBuffer(part: DecorationPart): Float32Array {
  const attribute = (part.mesh as THREE.Mesh).geometry.getAttribute(RUN_COLOR_ATTRIBUTE);
  if (!attribute) throw new Error('a swept run carries the run-colour attribute');
  return attribute.array as Float32Array;
}

function tubeBuilder(debug?: WordDebugHooks): DecorationBuilder {
  const builder = decorationBuilderFor(specOf('tubing').decoration, wordContext(debug));
  if (!builder) throw new Error('tubing carries no decoration');
  return builder;
}

/** Skip 0, build 1, skip 2 — a leading hole and a trailing one around the only drawn letter. */
function holed(debug?: WordDebugHooks): DecorationBuilder {
  const builder = tubeBuilder(debug);
  builder.skipLetter(0);
  builder.buildLetter(1, 'A', new THREE.Group(), undefined);
  builder.skipLetter(2);
  return builder;
}

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

function wordContext(debug?: WordDebugHooks): WordBuildContext {
  const font = stubFont();
  const caches = new WordCaches();
  return {
    font,
    caches,
    debug,
    baseX: [0, 0, 0],
    baseY: [0, 0, 0],
    // `createMaterial`, not a bare physical material: `applyLook` writes flake uniforms the
    // studio's own hook installs, and a material without them throws.
    studioMaterial: () => createMaterial(null),
    glyph: (char, depth) => caches.glyph(font, char, depth),
    shapes: (char) => caches.shapes(font, char),
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
      columnCount: 3,
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
    count: 3,
    line: 0,
    column: slot,
    lineCount: 1,
    columnCount: 3,
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
