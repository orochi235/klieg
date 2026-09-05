import type { Font, PathCommand } from 'opentype.js';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WordCaches } from '../../../src/render/caches.js';
import { cutterFor } from '../../../src/render/wells/cutters.js';
import { regionOf } from '../../../src/render/wells/region.js';
import {
  buildShell,
  DEFAULT_SHELL,
  openEdges,
  pair,
  shellPlanes,
} from '../../../src/render/wells/shell.js';
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

/** Chars are 0.5 em wide boxes rising 0.7 em, as the plate tests use. */
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
    family: 'klieg-test-shell',
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
} as const;

const OPTS = { ...DEFAULT_SHELL, depth: 0.3, bezel: SPEC.bezel };

function shapesOf(char = 'A'): THREE.Shape[] {
  return new WordCaches().shapes(stubFont(), char);
}

function shellOf(overrides: Partial<typeof OPTS> = {}, specOverrides = {}) {
  const shapes = shapesOf();
  const cut = cutterFor('lattice')(shapes, regionOf(shapes), {
    ...SPEC,
    ...specOverrides,
  } as never);
  return { cut, geo: buildShell(shapes, cut, { ...OPTS, ...overrides }) };
}

const positionsOf = (geo: THREE.BufferGeometry) =>
  (geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;

describe('openEdges', () => {
  it('counts nothing on a closed tetrahedron', () => {
    const geo = new THREE.TetrahedronGeometry(1).toNonIndexed();
    expect(openEdges(positionsOf(geo))).toBe(0);
  });

  it('counts the boundary of a single unpaired triangle', () => {
    const lone = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(openEdges(lone)).toBe(3);
  });
});

describe('pair', () => {
  const square = (cx: number, cy: number, r: number, ccw: boolean) => {
    const ring: [number, number][] = [
      [cx - r, cy - r],
      [cx + r, cy - r],
      [cx + r, cy + r],
      [cx - r, cy + r],
    ];
    return ccw ? ring : ring.reverse();
  };

  it('refuses two levels that disagree on ring count', () => {
    expect(
      pair([square(0, 0, 1, true)], [square(0, 0, 1, true), square(5, 5, 1, true)]),
    ).toBeNull();
  });

  // An O's outline and its counter share a centre, so a centroid alone picks whichever came out
  // marginally closer and stitches an outline to a counter — a sheet of quads across the counter.
  it('answers a concentric outline and counter by size and winding, not by centre', () => {
    const lower = [square(0, 0, 1, true), square(0, 0, 0.4, false)];
    const upper = [square(0, 0, 0.95, true), square(0, 0, 0.45, false)];
    const pairs = pair(lower, upper);
    expect(pairs).not.toBeNull();
    for (const [lo, hi] of pairs as [number[][], number[][]][]) {
      const span = (r: number[][]) => Math.max(...r.map((p) => p[0] as number));
      // Each ring keeps its own scale: the big one answers the big one.
      expect(Math.abs(span(lo) - span(hi))).toBeLessThan(0.2);
    }
  });
});

describe('buildShell', () => {
  it('closes the shell over a letter full of wells', () => {
    const { cut, geo } = shellOf();
    expect(cut.wells.length).toBeGreaterThan(0);
    expect(openEdges(positionsOf(geo))).toBe(0);
  });

  it('closes the shell when the cutter found no room', () => {
    const { cut, geo } = shellOf({}, { bezel: 0.4 });
    expect(cut.wells).toHaveLength(0);
    expect(openEdges(positionsOf(geo))).toBe(0);
  });

  // A closed shell can still be a shell with nothing cut into it, and the edge count says nothing
  // either way. Area, never a triangle count: earcut bridges each hole with a pair of duplicated
  // vertices, so `n + 2h - 2` is not the count and reading it as one calls a correct cap broken.
  it('floors every pocket the cutter placed', () => {
    const { cut, geo } = shellOf();
    const planes = shellPlanes(OPTS.depth, SPEC.floor, SPEC.bezel);
    const pos = positionsOf(geo);
    let floor = 0;
    for (let i = 0; i < pos.length; i += 9) {
      const zs = [pos[i + 2] as number, pos[i + 5] as number, pos[i + 8] as number];
      if (zs.some((z) => Math.abs(z - planes.floorZ) > 1e-4)) continue;
      const [ax, ay, bx, by, cx, cy] = [
        pos[i],
        pos[i + 1],
        pos[i + 3],
        pos[i + 4],
        pos[i + 6],
        pos[i + 7],
      ] as number[];
      floor +=
        Math.abs(
          ((bx as number) - (ax as number)) * ((cy as number) - (ay as number)) -
            ((cx as number) - (ax as number)) * ((by as number) - (ay as number)),
        ) / 2;
    }
    // Each seat is a diamond of half-diagonal `half`, so its area is `2 * half²`.
    const want = cut.seats.reduce((n, seat) => n + 2 * seat.half * seat.half, 0);
    expect(want).toBeGreaterThan(0);
    expect(floor).toBeGreaterThan(want * 0.9);
    expect(floor).toBeLessThan(want * 1.1);
  });

  it('spans from the back chamfer to the front face', () => {
    const { geo } = shellOf();
    const planes = shellPlanes(OPTS.depth, SPEC.floor, SPEC.bezel);
    const box = geo.boundingBox as THREE.Box3;
    expect(box.min.z).toBeCloseTo(planes.backZ, 3);
    expect(box.max.z).toBeCloseTo(planes.faceZ, 3);
  });

  // The whole reason the body is stitched rather than extruded: one `ExtrudeGeometry` bevels the
  // outer contour and every hole at one size, and the letter's own chamfer folds a well this small
  // through itself. A bead an order smaller has to be expressible.
  it('beads a rim far smaller than the letter’s own chamfer', () => {
    const { geo } = shellOf({ rimBevel: 0.003, rimDrop: 0.003 });
    expect(openEdges(positionsOf(geo))).toBe(0);
  });

  it('leaves the shapes it was handed unholed', () => {
    const shapes = shapesOf();
    const cut = cutterFor('lattice')(shapes, regionOf(shapes), SPEC as never);
    buildShell(shapes, cut, OPTS);
    for (const shape of shapes) expect(shape.holes).toHaveLength(0);
  });

  // `buildGlyphGeometry` cuts sharp corners back before extruding, because three's miter cap
  // leaves a nub past the tip of a letter otherwise. A shell that skips it brings that spur back.
  it('chamfers a sharp corner the way the plain extruder does', () => {
    const spike = new THREE.Shape();
    spike.moveTo(0, 0);
    spike.lineTo(1, 0);
    spike.lineTo(0.02, 0.06);
    spike.closePath();
    const geo = buildShell([spike], { wells: [], seats: [], floor: 0.09 }, OPTS);
    // Chamfered this tip reaches 1.020; unchamfered the miter runs it to 1.054, which is as far
    // as three's sqrt(2) cap allows. A looser bound than that passes either way.
    expect((geo.boundingBox as THREE.Box3).max.x).toBeLessThan(1.03);
  });

  it('costs more than a letter with nothing cut out of it', () => {
    const plain = shellOf({}, { bezel: 0.4 }).geo;
    const carved = shellOf().geo;
    expect(positionsOf(carved).length).toBeGreaterThan(positionsOf(plain).length);
  });
});
