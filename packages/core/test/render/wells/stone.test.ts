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
  girdleZ: PLANES.faceZ - 0.008,
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

// A look may inflate the solid as well as carve it, and then the pocket a stone sits in is not
// where the flat planes say. Riding the crown is what keeps the girdle in the metal.
describe('a stone set into a crowned face', () => {
  /** A ridge along x, so a stone's own width spans a real slope. */
  const lift = (x: number, _y: number) => 0.4 * x;
  const cell: [number, number][] = [
    [-0.02, -0.02],
    [0.02, -0.02],
    [0.02, 0.02],
    [-0.02, 0.02],
  ];

  const zOf = (geometry: THREE.BufferGeometry) => {
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    return Array.from({ length: pos.count }, (_, i) => ({
      x: pos.getX(i),
      y: pos.getY(i),
      z: pos.getZ(i),
    }));
  };

  it('rides a placed stone’s girdle on the metal, point by point', () => {
    const at = { ...seat(0.3, 0.1), outline: cell };
    const { geometry } = stone([at], { ...ctx, lift }, { ...SPEC, cutter: 'pave' });
    // The girdle is the cell itself: every one of its corners sits exactly on the crowned face.
    for (const corner of cell) {
      const [x, y] = [at.x + corner[0], at.y + corner[1]];
      const want = ctx.girdleZ + lift(x, y);
      const on = zOf(geometry).filter((p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6);
      expect(on.length).toBeGreaterThan(0);
      expect(Math.min(...on.map((p) => Math.abs(p.z - want)))).toBeLessThan(1e-6);
    }
  });

  // Take the crown back off every vertex and a tilted stone is the stone it was; a stone that
  // only translated is left leaning by the slope across its own width.
  it('tilts a placed stone with the metal rather than only lifting it', () => {
    const at = { ...seat(0.3, 0.1), outline: cell };
    const flat = zOf(stone([at], ctx, { ...SPEC, cutter: 'pave' }).geometry);
    const rode = zOf(stone([at], { ...ctx, lift }, { ...SPEC, cutter: 'pave' }).geometry);
    expect(rode).toHaveLength(flat.length);
    for (let i = 0; i < flat.length; i++) {
      const p = rode[i] as { x: number; y: number; z: number };
      expect(p.z - lift(p.x, p.y)).toBeCloseTo((flat[i] as { z: number }).z, 6);
    }
  });

  it('lifts an instanced stone onto the crown', () => {
    const { matrices } = stone([seat(0.3, 0.1)], { ...ctx, lift }, SPEC);
    const at = (matrices[0] as THREE.Matrix4).elements;
    // Column-major: the translation is 12..14.
    expect(at[14]).toBeCloseTo(lift(0.3, 0.1), 6);
  });
});
