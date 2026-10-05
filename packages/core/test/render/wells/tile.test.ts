import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createMaterial } from '../../../src/render/looks.js';
import { cutterFor } from '../../../src/render/wells/cutters.js';
import { fillFor } from '../../../src/render/wells/fills.js';
import type { Region } from '../../../src/render/wells/region.js';
import { area, insideRing, type Point, type Ring } from '../../../src/render/wells/rings.js';
import {
  buildShell,
  DEFAULT_SHELL,
  openEdges,
  shellPlanes,
} from '../../../src/render/wells/shell.js';
import {
  hexagon,
  Outline,
  outlineRings,
  type TileOptions,
  tile,
} from '../../../src/render/wells/tile.js';
import { glyphToShapes } from '../../../src/text/glyphs.js';

const buf = readFileSync(new URL('../../../../../apps/lab/public/font.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const OPTS: TileOptions = { pitch: 0.055, wall: 0.009, bezel: 0.012, minArea: 0.1 };
const INNER = OPTS.pitch / 2 - OPTS.wall / 2;
const WHOLE = 2 * Math.sqrt(3) * INNER * INNER;

const SPEC = {
  kind: 'well',
  cutter: 'tile',
  bezel: OPTS.bezel,
  floor: 0.09,
  pitch: OPTS.pitch,
  wall: OPTS.wall,
  size: 0.048,
  look: {},
} as const;

const box = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const boundsOf = (rings: Ring[]): THREE.Box2 => {
  const b = new THREE.Box2();
  for (const ring of rings) for (const [x, y] of ring) b.expandByPoint(new THREE.Vector2(x, y));
  return b;
};

const tiled = (rings: Ring[], opts: Partial<TileOptions> = {}, bucketed = true) =>
  tile(new Outline(rings, bucketed ? OPTS.pitch : null), boundsOf(rings), { ...OPTS, ...opts });

function toSegment(p: Point, a: Point, b: Point): number {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const len2 = ex * ex + ey * ey || 1e-24;
  const t = Math.min(Math.max(((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / len2, 0), 1);
  return Math.hypot(p[0] - (a[0] + t * ex), p[1] - (a[1] + t * ey));
}

const toRing = (p: Point, ring: Ring) =>
  ring.reduce(
    (d, a, i) => Math.min(d, toSegment(p, a, ring[(i + 1) % ring.length] as Point)),
    Infinity,
  );

/** Closest approach of two rings that do not overlap. */
const gap = (a: Ring, b: Ring) =>
  Math.min(...a.map((p) => toRing(p, b)), ...b.map((p) => toRing(p, a)));

describe('the tile field', () => {
  const square = box(0, 0, 0.6, 0.6);

  it('keeps a cell clear of the outline as the plain hexagon, never worked', () => {
    const { pockets, whole } = tiled([square]);
    expect(whole).toBeGreaterThan(40);
    const kept = pockets.filter((p) => p.whole);
    expect(kept).toHaveLength(whole);
    for (const p of kept) expect(p.ring).toEqual(hexagon(p.cx, p.cy, INNER));
  });

  it('drops a cell wholly outside the letter', () => {
    for (const p of tiled([square]).pockets) {
      expect(insideRing(square, p.at[0], p.at[1])).toBe(true);
    }
  });

  it('clips a cell the outline crosses to less than itself, and stops at the bezel', () => {
    const { pockets, clipped } = tiled([square]);
    expect(clipped).toBeGreaterThan(10);
    // One marching-squares step is the field's own resolution.
    const step = OPTS.pitch / 24;
    for (const p of pockets.filter((q) => !q.whole)) {
      expect(area(p.ring)).toBeLessThan(WHOLE);
      for (const point of p.ring) {
        expect(insideRing(square, point[0], point[1])).toBe(true);
        expect(toRing(point, square)).toBeGreaterThan(OPTS.bezel - step);
      }
    }
  });

  // The spike shrank each hexagon toward its center, which leaves neighbors 0.87 of a wall apart;
  // pointy-top cells on flat-top spacing leave a triangle between every three.
  it('leaves exactly one wall between every pair of neighbors', () => {
    const kept = tiled([square]).pockets.filter((p) => p.whole);
    let pairs = 0;
    for (const a of kept) {
      for (const b of kept) {
        if (a === b || Math.abs(Math.hypot(a.cx - b.cx, a.cy - b.cy) - OPTS.pitch) > 1e-9) continue;
        expect(gap(a.ring, b.ring)).toBeCloseTo(OPTS.wall, 9);
        pairs++;
      }
    }
    expect(pairs).toBeGreaterThan(100);
  });

  it('answers the same pockets and beads from the bucketed outline as from the whole one', () => {
    for (const char of 'RSO&') {
      const rings = outlineRings(glyphToShapes(font, char, 1));
      const bucketed = tiled(rings);
      const whole = tiled(rings, {}, false);
      expect(bucketed.pockets.length).toBeGreaterThan(50);
      expect(bucketed.pockets.map((p) => p.ring)).toEqual(whole.pockets.map((p) => p.ring));
      expect(bucketed.bead([0.003, 0])).toEqual(whole.bead([0.003, 0]));
    }
  });

  it('drops a cell holding a hole rather than cutting a pocket around it', () => {
    // A counter smaller than a cell, sitting on the cell the lattice centers on the letter.
    const pinhole = box(0.295, 0.295, 0.305, 0.305).reverse();
    const { pockets, holed } = tiled([square, pinhole]);
    expect(holed).toBe(1);
    for (const p of pockets) expect(insideRing(p.ring, 0.3, 0.3)).toBe(false);
  });

  // A neck narrower than two bezels is gone at the pocket's level and back at the rim's, so the
  // two pieces either side of it share one rim, which no stitch can close.
  it('keeps one of two pieces the widest bead would join', () => {
    const dumbbell: Ring = [
      [-0.055, -0.03],
      [-0.005, -0.03],
      [-0.005, -0.01],
      [0.005, -0.01],
      [0.005, -0.03],
      [0.055, -0.03],
      [0.055, 0.03],
      [0.005, 0.03],
      [0.005, 0.01],
      [-0.005, 0.01],
      [-0.005, 0.03],
      [-0.055, 0.03],
    ];
    // Every piece counts here, however small: the rule is about which pieces meet.
    const centered = (rings: Ring[]) =>
      tiled(rings, { minArea: 0 }).pockets.filter((p) => Math.hypot(p.cx, p.cy) < 1e-9);
    expect(centered([dumbbell])).toHaveLength(1);
    // Cut the neck and the pieces never meet, so both stay.
    const apart = [box(-0.055, -0.03, -0.005, 0.03), box(0.005, -0.03, 0.055, 0.03)];
    expect(centered(apart)).toHaveLength(2);
  });

  it('grows every pocket at each bead step, and never so far that neighboring rims meet', () => {
    const tiling = tiled([square]);
    const grown = tiling.bead([0.003, 0.0015, 0]);
    expect(grown).toHaveLength(tiling.pockets.length);
    for (const [i, steps] of grown.entries()) {
      expect(steps).toHaveLength(3);
      expect(steps[2]).toEqual(tiling.pockets[i]?.ring);
      expect(area(steps[0] as Ring)).toBeGreaterThan(area(steps[1] as Ring));
      expect(area(steps[1] as Ring)).toBeGreaterThan(area(steps[2] as Ring));
    }
    // Asked for far more bead than the wall holds, the rims of two whole neighbors still part.
    const wide = tiling.bead([0.1]);
    const kept = tiling.pockets.flatMap((p, i) =>
      p.whole ? [{ p, ring: wide[i]?.[0] as Ring }] : [],
    );
    const first = kept[0] as (typeof kept)[number];
    const next = kept.find(
      (k) => Math.abs(Math.hypot(k.p.cx - first.p.cx, k.p.cy - first.p.cy) - OPTS.pitch) < 1e-9,
    ) as (typeof kept)[number];
    expect(gap(first.ring, next.ring)).toBeGreaterThan(0);
  });
});

describe('the tile cutter', () => {
  const shapes = glyphToShapes(font, 'R', 1);
  const cut = () => cutterFor('tile')(shapes, null as unknown as Region, SPEC as never);

  it('never reads the region it is handed', () => {
    const untouchable = new Proxy({} as Region, {
      get: () => {
        throw new Error('read the region');
      },
    });
    expect(() => cutterFor('tile')(shapes, untouchable, SPEC as never)).not.toThrow();
  });

  it('hands every seat the outline of its own pocket', () => {
    const { wells, seats } = cut();
    expect(seats).toHaveLength(wells.length);
    for (const [i, seat] of seats.entries()) {
      const points = (wells[i] as THREE.Path).getPoints();
      const outline = seat.outline ?? [];
      expect(outline.length).toBeGreaterThanOrEqual(3);
      const at = new Set(points.map((p) => `${p.x.toFixed(9)},${p.y.toFixed(9)}`));
      for (const [x, y] of outline) {
        expect(at.has(`${(x + seat.x).toFixed(9)},${(y + seat.y).toFixed(9)}`)).toBe(true);
      }
    }
  });

  // The open question the spike left: a clipped pocket is neither convex nor a hexagon, and a
  // stone that ignores its real extent overhangs the metal at every edge of every letter.
  it('seats no stone past the pocket it sits in', () => {
    const { wells, seats } = cut();
    const planes = shellPlanes(0.3, SPEC.floor, SPEC.bezel);
    const filled = fillFor('stone')(
      seats,
      {
        material: () => createMaterial(null),
        faceZ: planes.faceZ,
        floorZ: planes.floorZ,
        girdleZ: planes.faceZ - 0.003,
      },
      SPEC as never,
    );
    const rings = wells.map((w) => w.getPoints().map((p): Point => [p.x, p.y]));
    const pos = (filled.geometry.getAttribute('position') as THREE.BufferAttribute).array;
    let outside = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const p: Point = [pos[i] as number, pos[i + 1] as number];
      if (!rings.some((r) => insideRing(r, p[0], p[1]) || toRing(p, r) < 1e-7)) outside++;
    }
    expect(filled.placed).toBe(true);
    expect(outside).toBe(0);
  });

  it('builds a shell that closes over a letter with a counter', () => {
    const geo = buildShell(shapes, cut(), {
      ...DEFAULT_SHELL,
      depth: 0.3,
      bezel: SPEC.bezel,
      rimBevel: 0.003,
      rimDrop: 0.003,
    }).geometry;
    const pos = (geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    expect(openEdges(pos)).toBe(0);
  });
});
