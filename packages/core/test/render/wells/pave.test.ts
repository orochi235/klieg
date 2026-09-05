import type { Font, PathCommand } from 'opentype.js';
import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WordCaches } from '../../../src/render/caches.js';
import { createMaterial } from '../../../src/render/looks.js';
import { cutterFor } from '../../../src/render/wells/cutters.js';
import { fillFor } from '../../../src/render/wells/fills.js';
import { regionOf } from '../../../src/render/wells/region.js';
import { area, type Ring } from '../../../src/render/wells/rings.js';
import {
  buildShell,
  DEFAULT_SHELL,
  openEdges,
  shellPlanes,
} from '../../../src/render/wells/shell.js';
import type { LoadedFont } from '../../../src/text/font.js';

const UPEM = 1000;

function box(x: number, w: number, top: number, bottom: number): PathCommand[] {
  return [
    { type: 'M', x, y: -bottom },
    { type: 'L', x: x + w, y: -bottom },
    { type: 'L', x: x + w, y: -top },
    { type: 'L', x, y: -top },
    { type: 'Z' },
  ];
}

/** `A` is one 0.5 em box; `i` is two, a stem and a dot, which is the two-piece region. */
function stubFont(): LoadedFont {
  const font = {
    charToGlyph: (char: string) => ({
      advanceWidth: 600,
      getPath: (_x: number, _y: number, size: number) => ({
        commands:
          char === 'i'
            ? [
                ...box(0, 0.18 * size, 0.5 * size, 0),
                ...box(0, 0.18 * size, 0.72 * size, 0.58 * size),
              ]
            : box(0, 0.5 * size, 0.7 * size, 0),
        toPathData: () => 'M0 0',
      }),
    }),
  } as unknown as Font;
  return {
    font,
    unitsPerEm: UPEM,
    key: '/f.ttf',
    family: 'klieg-test-pave',
    metrics: { advanceOf: () => 600, kernOf: () => 0 },
    bytes: new ArrayBuffer(0),
  };
}

const SPEC = {
  kind: 'well',
  cutter: 'pave',
  bezel: 0.02,
  floor: 0.09,
  pitch: 0.055,
  size: 0.048,
  look: {},
} as const;

const OPTS = { ...DEFAULT_SHELL, depth: 0.3, bezel: SPEC.bezel };

function cutOf(char = 'A', overrides = {}) {
  const shapes = new WordCaches().shapes(stubFont(), char);
  const cut = cutterFor('pave')(shapes, regionOf(shapes), { ...SPEC, ...overrides } as never);
  return { shapes, cut };
}

const ringOf = (path: THREE.Path): Ring =>
  path.getPoints(1).map((p): [number, number] => [p.x, p.y]);

describe('the pave cutter', () => {
  it('shapes a cell to the outline instead of skipping it, so the stones are the surface', () => {
    const { cut } = cutOf();
    const paved = cut.wells.reduce((n, w) => n + area(ringOf(w)), 0);

    const shapes = new WordCaches().shapes(stubFont(), 'A');
    const lattice = cutterFor('lattice')(shapes, regionOf(shapes), {
      ...SPEC,
      cutter: 'lattice',
    } as never);
    const dotted = lattice.seats.reduce((n, s) => n + 2 * s.half * s.half, 0);

    // The letter is 0.5 x 0.7 em. At the same pitch, whole diamonds cover under a third of it and
    // leave gold between every one; pavé covers three fifths and leaves only the wall.
    const letter = 0.5 * 0.7;
    expect(dotted / letter).toBeLessThan(0.4);
    expect(paved / letter).toBeGreaterThan(0.55);
  });

  it('gives every seat the outline of its own cell', () => {
    const { cut } = cutOf();
    expect(cut.seats.length).toBe(cut.wells.length);
    for (const seat of cut.seats) expect((seat.outline ?? []).length).toBeGreaterThanOrEqual(3);
  });

  // Asking for the part of a cell inside each polygon separately answers nothing at all for a
  // letter whose bezel leaves two pieces, and every `i` and `j` is one.
  it('paves a letter the bezel leaves in two pieces', () => {
    const { cut } = cutOf('i');
    expect(cut.wells.length).toBeGreaterThan(2);
    const ys = cut.seats.map((s) => s.y);
    // Cells in the dot as well as the stem, not just the taller piece.
    expect(Math.max(...ys)).toBeGreaterThan(0.55);
    expect(Math.min(...ys)).toBeLessThan(0.3);
  });

  it('grades the cells toward the edge when asked, and does not otherwise', () => {
    const absorb = cutOf('A', { edge: 'absorb' }).cut;
    const grade = cutOf('A', { edge: 'grade' }).cut;
    const spread = (cut: typeof absorb) => {
      const areas = cut.wells.map((w) => area(ringOf(w))).sort((a, b) => a - b);
      return (areas[areas.length - 1] as number) / (areas[0] as number);
    };
    expect(spread(grade)).not.toBeCloseTo(spread(absorb), 1);
  });

  it('answers the same cells for the same seed, and different ones for a different seed', () => {
    const a = cutOf('A', { jitter: 0.4, seed: 1 }).cut;
    const b = cutOf('A', { jitter: 0.4, seed: 1 }).cut;
    const c = cutOf('A', { jitter: 0.4, seed: 2 }).cut;
    expect(a.seats.map((s) => s.x)).toEqual(b.seats.map((s) => s.x));
    expect(a.seats.map((s) => s.x)).not.toEqual(c.seats.map((s) => s.x));
  });

  it('re-derives a wider pocket at every growth rather than offsetting one', () => {
    const { cut } = cutOf();
    const grown = (cut.bead as NonNullable<typeof cut.bead>)([0.002, 0]);
    // One entry per pocket, and inside it one ring per growth.
    expect(grown).toHaveLength(cut.wells.length);
    for (const rings of grown) expect(rings).toHaveLength(2);
    const at = (k: number) =>
      grown.reduce((n, rings) => n + area(ringOf(rings[k] as THREE.Path)), 0);
    expect(at(0)).toBeGreaterThan(at(1));
  });
});

describe('a paved shell', () => {
  it('closes over a field of cells', () => {
    const { shapes, cut } = cutOf();
    const geo = buildShell(shapes, cut, { ...OPTS, rimBevel: 0.003, rimDrop: 0.003 });
    const pos = (geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    expect(cut.wells.length).toBeGreaterThan(20);
    expect(openEdges(pos)).toBe(0);
  });

  it('floors the cells it cut', () => {
    const { shapes, cut } = cutOf();
    const geo = buildShell(shapes, cut, { ...OPTS, rimBevel: 0.003, rimDrop: 0.003 });
    const planes = shellPlanes(OPTS.depth, SPEC.floor, SPEC.bezel);
    const pos = (geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    let floor = 0;
    for (let i = 0; i < pos.length; i += 9) {
      const zs = [pos[i + 2], pos[i + 5], pos[i + 8]] as number[];
      if (zs.some((z) => Math.abs(z - planes.floorZ) > 1e-4)) continue;
      const v = (k: number) => pos[i + k] as number;
      floor += Math.abs((v(3) - v(0)) * (v(7) - v(1)) - (v(6) - v(0)) * (v(4) - v(1))) / 2;
    }
    const want = cut.wells.reduce((n, w) => n + area(ringOf(w)), 0);
    expect(floor).toBeGreaterThan(want * 0.9);
  });
});

describe('the stone fill over paved cells', () => {
  const ctx = () => {
    const planes = shellPlanes(OPTS.depth, SPEC.floor, SPEC.bezel);
    return {
      // `createMaterial`, not a bare `MeshPhysicalMaterial`: `applyLook` writes flake uniforms
      // that only the former installs, and this is what `studioMaterial()` hands a builder.
      material: () => createMaterial(null),
      faceZ: planes.faceZ,
      floorZ: planes.floorZ,
      girdleZ: planes.faceZ - 0.003,
    };
  };

  it('merges one geometry holding every stone rather than instancing one shape', () => {
    const { cut } = cutOf();
    const filled = fillFor('stone')(cut.seats, ctx(), SPEC as never);
    expect(filled.placed).toBe(true);
    expect(filled.matrices).toHaveLength(0);
    expect(
      (filled.geometry.getAttribute('position') as THREE.BufferAttribute).count,
    ).toBeGreaterThan(cut.seats.length * 3);
  });

  // Deriving crown height from a cell's own width sinks the narrow cells below the metal, and the
  // narrow cells are the ones at the edges.
  it('sets every table on one plane whatever the cell’s width', () => {
    const { cut } = cutOf();
    const c = ctx();
    const filled = fillFor('stone')(cut.seats, c, SPEC as never);
    const pos = (filled.geometry.getAttribute('position') as THREE.BufferAttribute)
      .array as Float32Array;
    let top = Number.NEGATIVE_INFINITY;
    let count = 0;
    for (let i = 2; i < pos.length; i += 3) top = Math.max(top, pos[i] as number);
    for (let i = 2; i < pos.length; i += 3) if (Math.abs((pos[i] as number) - top) < 1e-6) count++;
    // Every stone contributes its whole table at the same height, so the plane is well populated.
    expect(count).toBeGreaterThan(cut.seats.length * 3);
    expect(top).toBeGreaterThan(c.faceZ);
  });

  it('keeps every culet above the floor of its pocket', () => {
    const { cut } = cutOf();
    const c = ctx();
    const filled = fillFor('stone')(cut.seats, c, SPEC as never);
    const pos = (filled.geometry.getAttribute('position') as THREE.BufferAttribute)
      .array as Float32Array;
    let low = Number.POSITIVE_INFINITY;
    for (let i = 2; i < pos.length; i += 3) low = Math.min(low, pos[i] as number);
    expect(low).toBeGreaterThan(c.floorZ);
  });
});
