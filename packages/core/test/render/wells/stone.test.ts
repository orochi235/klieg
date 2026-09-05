import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { WellSpec } from '../../../src/render/decoration.js';
import { createMaterial } from '../../../src/render/looks.js';
import type { FillContext } from '../../../src/render/wells/fills.js';
import { fillFor } from '../../../src/render/wells/fills.js';
import { shellPlanes } from '../../../src/render/wells/shell.js';
import { girdleWidth, stone } from '../../../src/render/wells/stone.js';

const SPEC = {
  kind: 'well',
  cutter: 'lattice',
  bezel: 0.012,
  floor: 0.09,
  pitch: 0.068,
  size: 0.048,
  look: {},
  fill: 'stone',
} as const satisfies WellSpec;

const PLANES = shellPlanes(0.3, SPEC.floor, SPEC.bezel);
// `createMaterial`, not a bare `MeshPhysicalMaterial`: `applyLook` writes flake uniforms that only
// the former installs, and this is what `studioMaterial()` hands a builder.
const ctx: FillContext = {
  material: () => createMaterial(null),
  faceZ: PLANES.faceZ,
  floorZ: PLANES.floorZ,
};
const seat = (x: number, y: number) => ({ x, y, half: SPEC.size / 2 });

describe('the stone fill', () => {
  it('registers itself under its own name', () => {
    expect(fillFor('stone')).toBe(stone);
  });

  // The bevel widens the opening toward the face, so seating the girdle a quarter of the way down
  // it is also what fixes the girdle's radius.
  it('seats the girdle in the opening at the height it sits at', () => {
    const { geometry } = stone([seat(0, 0)], ctx, SPEC);
    const box = geometry.boundingBox as THREE.Box3;
    expect(box.max.x).toBeCloseTo(0.024 + 0.038 * 0.75, 5);
    expect(box.max.x - box.min.x).toBeCloseTo(girdleWidth(0.024, 0.25), 5);
  });

  // A crown under the letter's own surface is a dimple, not a stone. `depth` is not the front
  // face: the extruder carries a bevelled face past the depth it was asked for.
  it('stands its crown proud of the letter and keeps its culet above the floor', () => {
    const { geometry } = stone([seat(0, 0)], ctx, SPEC);
    const box = geometry.boundingBox as THREE.Box3;
    expect(box.max.z).toBeGreaterThan(PLANES.faceZ);
    expect(box.min.z).toBeGreaterThan(PLANES.floorZ);
  });

  it('scales transmission thickness to the stone rather than to the look', () => {
    const { material } = stone([seat(0, 0)], ctx, SPEC);
    // `gem` ships 1.4 em, tuned for a volume the size of a letter; at that thickness a stone this
    // size absorbs almost everything and renders black.
    expect(material.thickness).toBeCloseTo(0.5 * girdleWidth(0.024, 0.25), 6);
    expect(material.thickness).toBeLessThan(0.1);
  });

  it('takes its tint from the spec', () => {
    const pale = stone([seat(0, 0)], ctx, { ...SPEC, tint: 0.12 });
    expect(pale.material.thickness).toBeCloseTo(0.12 * girdleWidth(0.024, 0.25), 6);
  });

  it('costs one geometry whatever the seat count, and a matrix per seat', () => {
    const one = stone([seat(0, 0)], ctx, SPEC);
    const three = stone([seat(0, 0), seat(0.1, 0), seat(0.2, 0)], ctx, SPEC);
    expect(one.geometry.getAttribute('position').count).toBe(90);
    expect(three.geometry.getAttribute('position').count).toBe(90);
    expect(three.matrices).toHaveLength(3);
    expect(three.matrices[1]?.elements[12]).toBeCloseTo(0.1, 6);
  });

  it('cuts a four-facet stone corner to corner on the seat', () => {
    const { geometry } = stone([seat(0, 0)], ctx, { ...SPEC, facets: 4 });
    expect(geometry.getAttribute('position').count).toBe(42);
  });
});
