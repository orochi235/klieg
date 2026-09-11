import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { SheetSpec } from '../../../src/render/decoration.js';
import {
  bakeSheet,
  CLIP_Z,
  SHEET_ATTRIBUTE,
  SHEET_METAL,
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
