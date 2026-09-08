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
  return { cut, geo: buildShell(shapes, cut, { ...OPTS, ...overrides }).geometry };
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

  // A stroke closing up between two levels, which the shell lids rather than stitching a ring to
  // one it is not. Naming the leftover is what lets it be lidded on the right side.
  it('names the ring a level has no answer for rather than forcing a pairing', () => {
    const band = pair([square(0, 0, 1, true)], [square(0, 0, 1, true), square(5, 5, 1, true)]);
    expect(band.pairs).toHaveLength(1);
    expect(band.loneLower).toHaveLength(0);
    expect(band.loneUpper).toHaveLength(1);
    expect((band.loneUpper[0] as number[][])[0]?.[0]).toBeCloseTo(4, 6);
  });

  // An O's outline and its counter share a centre, so a centroid alone picks whichever came out
  // marginally closer and stitches an outline to a counter — a sheet of quads across the counter.
  it('answers a concentric outline and counter by size and winding, not by centre', () => {
    const lower = [square(0, 0, 1, true), square(0, 0, 0.4, false)];
    const upper = [square(0, 0, 0.95, true), square(0, 0, 0.45, false)];
    const { pairs, loneLower, loneUpper } = pair(lower, upper);
    expect(loneLower).toHaveLength(0);
    expect(loneUpper).toHaveLength(0);
    for (const [lo, hi] of pairs) {
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
    const geo = buildShell([spike], { wells: [], seats: [], floor: 0.09 }, OPTS).geometry;
    // Chamfered this tip reaches 1.020; unchamfered the miter runs it to 1.054, which is as far
    // as three's sqrt(2) cap allows. A looser bound than that passes either way.
    expect((geo.boundingBox as THREE.Box3).max.x).toBeLessThan(1.03);
  });

  // A `C`'s gap, narrower than twice the letter's own chamfer: growing the metal closes it, so the
  // grown level has a counter the ungrown one does not and the band has a ring with no answer.
  // Seven of the lab font's thirty-six glyphs do this — `G`, `M`, `S` and four digits — and
  // refusing them is refusing to set GOLD.
  it('lids a counter the chamfer closes over rather than refusing the letter', () => {
    const c = new THREE.Shape();
    // A square ring opened on the right by a 0.06 em slot, against a 0.038 em chamfer either side.
    for (const [x, y] of [
      [0, 0],
      [0.5, 0],
      [0.5, 0.22],
      [0.35, 0.22],
      [0.35, 0.15],
      [0.15, 0.15],
      [0.15, 0.35],
      [0.35, 0.35],
      [0.35, 0.28],
      [0.5, 0.28],
      [0.5, 0.5],
      [0, 0.5],
    ] as [number, number][]) {
      if (x === 0 && y === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
    const geo = buildShell([c], { wells: [], seats: [], floor: 0.09 }, OPTS).geometry;
    expect(openEdges(positionsOf(geo))).toBe(0);
  });

  it('costs more than a letter with nothing cut out of it', () => {
    const plain = shellOf({}, { bezel: 0.4 }).geo;
    const carved = shellOf().geo;
    expect(positionsOf(carved).length).toBeGreaterThan(positionsOf(plain).length);
  });
});

// A look may ask for the shape of the solid and for what is carved out of it at once. The crown is
// zero at the letter's own contour and outside it, so the walls, both chamfers and the back cap
// stand exactly where they did and only the front side rides.
describe('the wells are a real hollow', () => {
  /** Signed volume of a closed mesh, by the divergence theorem. Meaningless if it is not closed. */
  const volumeOf = (pos: Float32Array) => {
    let v = 0;
    for (let t = 0; t < pos.length; t += 9) {
      const ax = pos[t] as number;
      const ay = pos[t + 1] as number;
      const az = pos[t + 2] as number;
      const bx = pos[t + 3] as number;
      const by = pos[t + 4] as number;
      const bz = pos[t + 5] as number;
      const cx = pos[t + 6] as number;
      const cy = pos[t + 7] as number;
      const cz = pos[t + 8] as number;
      v += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
    }
    return Math.abs(v);
  };

  const solidOf = () => {
    const shapes = shapesOf();
    return buildShell(shapes, { wells: [], seats: [], floor: SPEC.floor }, OPTS).geometry;
  };

  // A pocket whose wall collapses into the plane leaves the letter solid while every edge is still
  // walked once and every test above still passes — the render just shows a flat plate where the
  // wells were. Volume is what says the hollow is there, and it needs the shell to be closed to
  // mean anything, which `openEdges` asserts separately.
  // The gate the pocket test above cannot be, and the one a stub font cannot give: a wall that
  // collapses into its own plane leaves the ring walked, so `openEdges` still reads 0, while the
  // counter it bounded has been filled in. Only a real glyph's rings reproduce it — the stall
  // wants a ring dense and curved enough for the nearest point to recede before it approaches.
  it('keeps a counter a hole all the way through', async () => {
    const { default: opentype } = await import('opentype.js');
    const { readFileSync } = await import('node:fs');
    const buf = readFileSync(new URL('../../../../../apps/lab/public/font.ttf', import.meta.url));
    const parsed = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const font = {
      font: parsed,
      unitsPerEm: parsed.unitsPerEm,
      key: '/f.ttf',
      family: 'shell-counter',
      metrics: { advanceOf: () => 600, kernOf: () => 0 },
      bytes: new ArrayBuffer(0),
    } as never;

    const shapes = new WordCaches().shapes(font, 'R');
    const hole = (shapes[0] as THREE.Shape).holes[0] as THREE.Path;
    const box = new THREE.Box2();
    for (const p of hole.getPoints(64)) box.expandByPoint(p);
    const at = box.getCenter(new THREE.Vector2());

    const pos = positionsOf(
      buildShell(shapes, { wells: [], seats: [], floor: SPEC.floor }, OPTS).geometry,
    );
    expect(openEdges(pos)).toBe(0);

    // Straight down z through the middle of the counter. A through-hole is hit by nothing; a
    // filled one is hit by its front cap and its back.
    let hits = 0;
    for (let t = 0; t < pos.length; t += 9) {
      const [x0, x1, x2] = [pos[t] as number, pos[t + 3] as number, pos[t + 6] as number];
      const [y0, y1, y2] = [pos[t + 1] as number, pos[t + 4] as number, pos[t + 7] as number];
      const d = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (Math.abs(d) < 1e-12) continue;
      const w0 = ((x1 - at.x) * (y2 - at.y) - (x2 - at.x) * (y1 - at.y)) / d;
      const w1 = ((x2 - at.x) * (y0 - at.y) - (x0 - at.x) * (y2 - at.y)) / d;
      const w2 = 1 - w0 - w1;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) hits++;
    }
    expect(hits).toBe(0);
  });

  it('takes metal out, in proportion to the pockets it cut', () => {
    const { cut, geo } = shellOf();
    expect(cut.wells.length).toBeGreaterThan(0);
    const carved = volumeOf(positionsOf(geo));
    const solid = volumeOf(positionsOf(solidOf()));
    expect(carved).toBeLessThan(solid);

    // A well is a diamond sunk `floor` deep, tapering from the bead's opening at the face to
    // `size` at the seat — so what it removes is bracketed by the two, and the bracket is what a
    // collapsed wall cannot satisfy: it removes nothing at all.
    const prism = (across: number) => cut.wells.length * ((across * across) / 2) * SPEC.floor;
    expect(solid - carved).toBeGreaterThan(prism(SPEC.size));
    expect(solid - carved).toBeLessThan(prism(SPEC.size + 2 * DEFAULT_SHELL.rimBevel));
  });
});

describe('crease smoothing', () => {
  const normalsOf = (geo: THREE.BufferGeometry) =>
    (geo.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array;
  /** Triangles whose three vertices disagree about the normal — i.e. that shade smoothly. */
  const smoothTris = (n: Float32Array) => {
    let count = 0;
    for (let t = 0; t < n.length; t += 9) {
      const same =
        Math.abs((n[t] as number) - (n[t + 3] as number)) < 1e-6 &&
        Math.abs((n[t + 1] as number) - (n[t + 4] as number)) < 1e-6 &&
        Math.abs((n[t + 2] as number) - (n[t + 5] as number)) < 1e-6;
      if (!same) count++;
    }
    return count;
  };

  it('leaves the shell flat at 0, which is what it has always been', () => {
    expect(smoothTris(normalsOf(shellOf({ crease: 0 }).geo))).toBe(0);
  });

  it('smooths a bevel at 40 and moves not one vertex', () => {
    const flat = shellOf({ crease: 0 }).geo;
    const soft = shellOf({ crease: 40 }).geo;
    expect(smoothTris(normalsOf(soft))).toBeGreaterThan(0);
    // The whole claim: this is a shading pass. A geometry change here would move a baseline.
    expect(positionsOf(soft)).toEqual(positionsOf(flat));
  });

  // The crease between a letter's face and its chamfer is a right angle at the cap; averaging
  // across it rounds the letter's own edge off, which is what the flat shell was protecting.
  it('keeps a face-to-bevel crease hard', () => {
    const n = normalsOf(shellOf({ crease: 40 }).geo);
    const pos = positionsOf(shellOf({ crease: 40 }).geo);
    let flatFacing = 0;
    for (let t = 0; t < pos.length; t += 9) {
      // A triangle lying in the front cap points straight down +z; if the crease leaked, its
      // normal would tilt toward the chamfer beside it.
      const isCap =
        Math.abs((pos[t + 2] as number) - (pos[t + 5] as number)) < 1e-9 &&
        Math.abs((pos[t + 2] as number) - (pos[t + 8] as number)) < 1e-9;
      if (isCap && (n[t + 2] as number) > 0.999) flatFacing++;
    }
    expect(flatFacing).toBeGreaterThan(0);
  });
});

describe('a crowned shell', () => {
  const CROWN = { profile: 'cushion' as const, rise: 0.06, reach: 0.08 };
  const planes = shellPlanes(OPTS.depth, SPEC.floor, SPEC.bezel);

  it('stands the front face proud by the rise it was given, and no further', () => {
    const { geo } = shellOf({ inflate: CROWN });
    const box = geo.boundingBox as THREE.Box3;
    expect(box.max.z).toBeCloseTo(planes.faceZ + CROWN.rise, 3);
    expect(box.min.z).toBeCloseTo(planes.backZ, 3);
  });

  it('leaves the letter’s own edge exactly where it was', () => {
    const flat = (shellOf().geo.boundingBox as THREE.Box3).clone();
    const crowned = shellOf({ inflate: CROWN }).geo.boundingBox as THREE.Box3;
    expect(crowned.min.x).toBeCloseTo(flat.min.x, 6);
    expect(crowned.max.x).toBeCloseTo(flat.max.x, 6);
    expect(crowned.min.y).toBeCloseTo(flat.min.y, 6);
    expect(crowned.max.y).toBeCloseTo(flat.max.y, 6);
  });

  it('stays closed', () => {
    const { cut, geo } = shellOf({ inflate: CROWN });
    expect(cut.wells.length).toBeGreaterThan(0);
    expect(openEdges(positionsOf(geo))).toBe(0);
  });

  it('closes over a letter with nothing cut out of it', () => {
    const { geo } = shellOf({ inflate: CROWN }, { bezel: 0.4 });
    expect(openEdges(positionsOf(geo))).toBe(0);
  });

  // A pocket that did not ride would be swallowed: the metal rises by the rise and the rim stays,
  // so the deepest well on the letter would be the shallowest place on it.
  it('carries every pocket up with the metal, keeping its own depth', () => {
    const { geo } = shellOf({ inflate: CROWN });
    const pos = positionsOf(geo);
    let deepest = Number.NEGATIVE_INFINITY;
    let shallowest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pos.length; i += 9) {
      // A pocket's own floor: three vertices on one plane, below the letter's flat face.
      const zs = [pos[i + 2], pos[i + 5], pos[i + 8]] as number[];
      const z = zs[0] as number;
      if (zs.some((v) => Math.abs(v - z) > 1e-6)) continue;
      if (z < planes.floorZ - 1e-6 || z > planes.faceZ - 1e-3) continue;
      deepest = Math.max(deepest, z);
      shallowest = Math.min(shallowest, z);
    }
    // No floor sinks, and the ones under the middle of a stroke ride the full rise.
    expect(shallowest).toBeGreaterThanOrEqual(planes.floorZ - 1e-6);
    expect(deepest).toBeCloseTo(planes.floorZ + CROWN.rise, 4);
  });

  it('refines the crown rather than facetting one triangle across the letter', () => {
    const flat = positionsOf(shellOf({}, { bezel: 0.4 }).geo).length;
    const crowned = positionsOf(shellOf({ inflate: CROWN }, { bezel: 0.4 }).geo).length;
    expect(crowned).toBeGreaterThan(flat * 1.5);
  });
});
