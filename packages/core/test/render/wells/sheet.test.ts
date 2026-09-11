import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { SheetSpec } from '../../../src/render/decoration.js';
import { createMaterial } from '../../../src/render/looks.js';
import { regionOf } from '../../../src/render/wells/region.js';
import {
  bakeSheet,
  CLIP_Z,
  MASK,
  maskMaterial,
  SHEET_ATTRIBUTE,
  SHEET_METAL,
  SHEET_RIM,
  sheetLetterOf,
  sheetUniforms,
} from '../../../src/render/wells/sheet.js';
import { DEFAULT_GLYPH_OPTIONS } from '../../../src/text/glyphs.js';

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

const BOX = new THREE.Box2(new THREE.Vector2(-0.25, -0.25), new THREE.Vector2(0.75, 0.75));

function lowestZ(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position');
  let low = Number.POSITIVE_INFINITY;
  for (let i = 0; i < position.count; i++) low = Math.min(low, position.getZ(i));
  return low;
}

describe('bakeSheet', () => {
  // The plate's own outer chamfer may stand a bevel's width past the box; nothing ever shows it.
  it('covers the box it was asked for', () => {
    const sheet = bakeSheet(BOX, SPEC);
    sheet.shell.computeBoundingBox();
    const box = sheet.shell.boundingBox as THREE.Box3;
    const slack = DEFAULT_GLYPH_OPTIONS.bevelSize + 1e-6;
    for (const [got, want] of [
      [box.min.x, BOX.min.x],
      [box.min.y, BOX.min.y],
    ] as const) {
      expect(got).toBeLessThanOrEqual(want + 1e-6);
      expect(got).toBeGreaterThanOrEqual(want - slack);
    }
    for (const [got, want] of [
      [box.max.x, BOX.max.x],
      [box.max.y, BOX.max.y],
    ] as const) {
      expect(got).toBeGreaterThanOrEqual(want - 1e-6);
      expect(got).toBeLessThanOrEqual(want + slack);
    }
    sheet.dispose();
  });

  it('marks every vertex of its metal as sheet', () => {
    const sheet = bakeSheet(BOX, SPEC);
    const marks = sheet.shell.getAttribute(SHEET_ATTRIBUTE);
    expect(marks.count).toBe(sheet.shell.getAttribute('position').count);
    expect(new Set(marks.array)).toEqual(new Set([SHEET_METAL]));
    sheet.dispose();
  });

  // The back face shows the same sheet turned over, and each copy is clipped at the letter's
  // middle so neither shows through the other. A stone reaching below that plane would be cut.
  it('sets every stone above the plane the sheet is clipped at', () => {
    const sheet = bakeSheet(BOX, SPEC);
    expect(sheet.stones).not.toBeNull();
    expect(lowestZ(sheet.stones as THREE.BufferGeometry)).toBeGreaterThan(CLIP_Z);
    expect(sheet.thickness).toBeGreaterThan(0);
    sheet.dispose();
  });

  it('refuses a floor deep enough to reach the clip plane', () => {
    expect(() => bakeSheet(BOX, { ...SPEC, floor: 0.2 })).toThrow(/floor/);
  });

  it('bakes no stones when no fill is named', () => {
    const { fill: _, ...bare } = SPEC;
    const sheet = bakeSheet(BOX, bare);
    expect(sheet.stones).toBeNull();
    expect(sheet.thickness).toBe(0);
    sheet.dispose();
  });
});

/** A 0.5 by 0.7 em box, the letter every stub font in these tests draws. */
function boxShapes(): THREE.Shape[] {
  return [
    new THREE.Shape([
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.5, 0),
      new THREE.Vector2(0.5, 0.7),
      new THREE.Vector2(0, 0.7),
    ]),
  ];
}

const FACE_Z = DEFAULT_GLYPH_OPTIONS.depth + DEFAULT_GLYPH_OPTIONS.bevelThickness;

describe('sheetLetterOf', () => {
  it('carries the glyph distance field as a half-float texture the shader can filter', () => {
    const letter = sheetLetterOf(boxShapes());
    expect(letter.mask.type).toBe(THREE.HalfFloatType);
    expect(letter.mask.format).toBe(THREE.RedFormat);
    expect(letter.mask.magFilter).toBe(THREE.LinearFilter);

    const { field } = regionOf(boxShapes(), 'uniform');
    const [originX, originY, emPerCell, size] = letter.xf.toArray();
    expect([originX, originY, emPerCell, size]).toEqual([
      field.originX,
      field.originY,
      field.emPerCell,
      field.size,
    ]);
    // The texel under the middle of the box: deep inside, so negative, and what the field holds.
    const ix = Math.round((0.25 - field.originX) / field.emPerCell);
    const iy = Math.round((0.35 - field.originY) / field.emPerCell);
    const texel = (letter.mask.image.data as Uint16Array)[iy * field.size + ix] as number;
    const depth = THREE.DataUtils.fromHalfFloat(texel);
    expect(depth).toBeLessThan(-0.2);
    expect(depth).toBeCloseTo(field.data[iy * field.size + ix] as number, 3);
    letter.dispose();
  });

  it('seats the rim on the seam between the letter face and the sheet', () => {
    const letter = sheetLetterOf(boxShapes());
    const { field } = regionOf(boxShapes(), 'uniform');
    const position = letter.rim.getAttribute('position');
    expect(position.count).toBeGreaterThan(0);
    for (let i = 0; i < position.count; i++) {
      // Within the bead's half-width and its rounding of the seam, which sits MASK em inside.
      expect(Math.abs(field.sample(position.getX(i), position.getY(i)) + MASK)).toBeLessThan(0.012);
    }
    letter.rim.computeBoundingBox();
    const box = letter.rim.boundingBox as THREE.Box3;
    // Its lower bevel buried in the face, its crown standing just proud of it.
    expect(box.min.z).toBeLessThan(FACE_Z);
    expect(box.max.z).toBeGreaterThan(FACE_Z);
    expect(box.max.z).toBeLessThan(FACE_Z + 0.02);
    letter.dispose();
  });

  it('marks every rim vertex as rim', () => {
    const letter = sheetLetterOf(boxShapes());
    expect(new Set(letter.rim.getAttribute(SHEET_ATTRIBUTE).array)).toEqual(new Set([SHEET_RIM]));
    letter.dispose();
  });
});

/** Runs a material's patch over a skeleton of three's shaders, as the renderer would. */
function patched(material: THREE.MeshPhysicalMaterial) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: 'void main() {\n#include <beginnormal_vertex>\n#include <begin_vertex>\n}',
    fragmentShader: 'void main() {\n}',
  };
  material.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer);
  return shader;
}

describe('maskMaterial', () => {
  const letter = sheetLetterOf(boxShapes());
  const shift = new THREE.Vector2(-0.1, -0.2);

  it('keeps the patch the material already carried', () => {
    const material = createMaterial(null);
    maskMaterial(material, sheetUniforms(letter, shift), 'body');
    expect(patched(material).vertexShader).toContain('vFlakePos');
  });

  it('tells the body, the sheet and the rim apart by a vertex attribute', () => {
    const body = createMaterial(null);
    maskMaterial(body, sheetUniforms(letter, shift), 'body');
    const stones = createMaterial(null);
    maskMaterial(stones, sheetUniforms(letter, shift), 'stones');
    expect(patched(body).vertexShader).toContain(`attribute float ${SHEET_ATTRIBUTE}`);
    expect(patched(stones).vertexShader).not.toContain(SHEET_ATTRIBUTE);
    expect(patched(body).fragmentShader).toContain('discard');
    expect(patched(stones).fragmentShader).toContain('discard');
  });

  it("hands the shader this letter's own mask and slide", () => {
    const material = createMaterial(null);
    maskMaterial(material, sheetUniforms(letter, shift), 'stones');
    const { uniforms } = patched(material);
    expect(uniforms.uMask?.value).toBe(letter.mask);
    const gotShift = uniforms.uMaskShift?.value as THREE.Vector2;
    expect(gotShift.toArray()).toEqual([-0.1, -0.2]);
    expect(uniforms.uMaskLevel?.value).toBe(-MASK);
  });

  it('gives each role its own program, shared by every letter in that role', () => {
    const other = sheetLetterOf(boxShapes());
    const key = (role: 'body' | 'stones', of = letter) => {
      const material = createMaterial(null);
      maskMaterial(material, sheetUniforms(of, shift), role);
      return material.customProgramCacheKey();
    };
    expect(key('body')).toBe(key('body', other));
    expect(key('body')).not.toBe(key('stones'));
    expect(key('body')).not.toBe(createMaterial(null).customProgramCacheKey());
  });
});
