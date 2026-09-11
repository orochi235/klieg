import type { Font, PathCommand } from 'opentype.js';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WordCaches } from '../../../src/render/caches.js';
import type { SheetSpec } from '../../../src/render/decoration.js';
import type { WordBuildContext } from '../../../src/render/decorations/registry.js';
import { SheetBuilder, SLACK, slideOf } from '../../../src/render/decorations/sheet.js';
import { createMaterial } from '../../../src/render/looks.js';
import { SHEET_ATTRIBUTE, SHEET_BODY } from '../../../src/render/wells/sheet.js';
import type { LoadedFont } from '../../../src/text/font.js';
import { DEFAULT_GLYPH_OPTIONS } from '../../../src/text/glyphs.js';

const DEPTH = DEFAULT_GLYPH_OPTIONS.depth;

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

/** Every char is a 0.5 em wide box rising 0.7 em, except 'W', which is twice as wide. */
function stubFont(): LoadedFont {
  const font = {
    charToGlyph: (char: string) => ({
      advanceWidth: 600,
      getPath: (_x: number, _y: number, size: number) => ({
        commands: boxPath((char === 'W' ? 1 : 0.5) * size, 0.7 * size, 0),
        toPathData: () => 'M0 0',
      }),
    }),
  } as unknown as Font;
  return {
    font,
    unitsPerEm: 1000,
    key: '/f.ttf',
    family: 'klieg-test-sheet',
    metrics: { advanceOf: () => 600, kernOf: () => 0 },
    bytes: new ArrayBuffer(0),
  };
}

/** `pave`'s own numbers at twice the pitch, so a bake costs a quarter of the shipped one. */
const SPEC = {
  kind: 'sheet',
  cutter: 'pave',
  bezel: 0.026,
  floor: 0.07,
  pitch: 0.1,
  wall: 0.012,
  relax: 1,
  edge: 'absorb',
  size: 0.048,
  rimBevel: 0.003,
  rimDrop: 0.003,
  look: {},
  fill: 'stone',
  sink: 0.25,
  facets: 8,
} as const satisfies SheetSpec;

function context(
  inflate?: WordBuildContext['inflate'],
  caches = new WordCaches(),
  font = stubFont(),
): WordBuildContext {
  return {
    font,
    caches,
    inflate,
    baseX: [0, 1],
    baseY: [0, 0],
    studioMaterial: () => createMaterial(null),
    glyph: (char, depth) => caches.glyph(font, char, depth, inflate),
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

/** A body the way `Word` makes one: the builder's geometry on a fresh studio material. */
function bodyOf(builder: SheetBuilder, char: string): THREE.Mesh {
  return new THREE.Mesh(builder.bodyGeometry(char, DEPTH), createMaterial(null));
}

describe('SheetBuilder', () => {
  it('answers a body marked as body, one per char', () => {
    const ctx = context();
    const builder = new SheetBuilder(SPEC, ctx);
    const body = builder.bodyGeometry('A', DEPTH);
    expect(body).toBe(builder.bodyGeometry('A', DEPTH));
    expect(body).not.toBe(ctx.glyph('A', DEPTH));
    expect(body.getAttribute('position').count).toBe(
      ctx.glyph('A', DEPTH).getAttribute('position').count,
    );
    expect(new Set(body.getAttribute(SHEET_ATTRIBUTE).array)).toEqual(new Set([SHEET_BODY]));
    builder.dispose();
  });

  it('hangs the sheet and the rim off the body, front and back, on the body material', () => {
    const builder = new SheetBuilder(SPEC, context());
    const body = bodyOf(builder, 'A');
    builder.dressBody(0, 'A', body);
    const [front, back, rim, rimBack] = body.children as THREE.Mesh[];
    expect(body.children).toHaveLength(4);
    for (const child of body.children as THREE.Mesh[]) expect(child.material).toBe(body.material);
    expect(back?.geometry).toBe(front?.geometry);
    expect(rimBack?.geometry).toBe(rim?.geometry);
    for (const turned of [back, rimBack]) {
      expect(turned?.scale.z).toBe(-1);
      expect(turned?.position.z).toBe(DEPTH);
    }
    expect((body.material as THREE.Material).customProgramCacheKey()).toContain('sheet-body');
    builder.dispose();
  });

  it('slides each letter to its own patch of the sheet', () => {
    expect(slideOf(0).equals(slideOf(1))).toBe(false);
    for (let slot = 0; slot < 24; slot++) {
      const { x, y } = slideOf(slot);
      for (const v of [x, y]) {
        expect(v).toBeLessThanOrEqual(0);
        expect(v).toBeGreaterThanOrEqual(-SLACK);
      }
    }
    const builder = new SheetBuilder(SPEC, context());
    const body = bodyOf(builder, 'A');
    builder.dressBody(1, 'A', body);
    const front = body.children[0] as THREE.Mesh;
    expect(front.position.x).toBeCloseTo(slideOf(1).x, 9);
    expect(front.position.y).toBeCloseTo(slideOf(1).y, 9);
    builder.dispose();
  });

  it('contributes one stone part per letter, its back copy riding the front', () => {
    const builder = new SheetBuilder(SPEC, context());
    const sized = new THREE.Group();
    builder.buildLetter(0, 'A', sized, undefined);
    builder.skipLetter(1);
    const parts = builder.collectParts();
    expect(parts).toHaveLength(1);
    expect(parts[0]?.info.kind).toBe('chunk');
    expect(parts[0]?.info.fill).toBe('stone');
    const stones = parts[0]?.mesh as THREE.Mesh;
    expect(stones.parent?.position.x).toBeCloseTo(slideOf(0).x, 9);
    expect(stones.position.toArray()).toEqual([0, 0, 0]);
    expect((stones.children[0] as THREE.Mesh).scale.z).toBe(-1);
    expect((stones.material as THREE.Material).customProgramCacheKey()).toContain('sheet-stones');
    builder.dispose();
  });

  it('sets no stones and contributes no part when no fill is named', () => {
    const { fill: _, ...bare } = SPEC;
    const builder = new SheetBuilder(bare, context());
    const sized = new THREE.Group();
    builder.buildLetter(0, 'A', sized, undefined);
    expect(sized.children).toHaveLength(0);
    expect(builder.collectParts()).toEqual([]);
    builder.dispose();
  });

  it('bakes one sheet for a primed word, wide letter and all', () => {
    const ctx = context();
    const builder = new SheetBuilder(SPEC, ctx);
    builder.prime(['A', 'W', ' ']);
    const primed = ctx.caches.sheet(SPEC, new THREE.Box2(), () => {
      throw new Error('prime should already have baked a sheet');
    });
    const body = bodyOf(builder, 'W');
    builder.dressBody(1, 'W', body);
    expect((body.children[0] as THREE.Mesh).geometry).toBe(primed.shell);
    builder.dispose();
  });

  it('shares the sheet and each letter through the caches, and leaves them there on dispose', () => {
    const caches = new WordCaches();
    const font = stubFont();
    const first = new SheetBuilder(SPEC, context(undefined, caches, font));
    const second = new SheetBuilder(SPEC, context(undefined, caches, font));
    const a = bodyOf(first, 'A');
    const b = bodyOf(second, 'A');
    first.dressBody(0, 'A', a);
    second.dressBody(0, 'A', b);
    const shell = (a.children[0] as THREE.Mesh).geometry;
    expect((b.children[0] as THREE.Mesh).geometry).toBe(shell);
    expect((b.children[2] as THREE.Mesh).geometry).toBe((a.children[2] as THREE.Mesh).geometry);
    first.dispose();
    expect(shell.getAttribute('position').count).toBeGreaterThan(0);
    expect(() =>
      caches.sheet(SPEC, new THREE.Box2(), () => {
        throw new Error('the sheet should still be held');
      }),
    ).not.toThrow();
    second.dispose();
  });

  it('refuses an inflated letter, whose crown the sheet would not follow', () => {
    expect(
      () => new SheetBuilder(SPEC, context({ profile: 'cushion', rise: 0.06, reach: 0.08 })),
    ).toThrow(/flat/);
  });
});
