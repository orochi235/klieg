import * as THREE from 'three';
import type { Point2 } from './field.js';
import { pathLength, resample } from './resample.js';

export type SurfaceKind = 'front' | 'back' | 'wall' | 'connector';

export interface FaceSurface {
  kind: 'front' | 'back';
  z: number;
  /** Outer contour first, then holes — the polygons the field rasterises. */
  polygons: Point2[][];
}

export interface WallSurface {
  kind: 'wall';
  /** One contour's points, evenly spaced, not repeating the first point. */
  ring: Point2[];
  perimeter: number;
  depth: number;
}

export type Surface = FaceSurface | WallSurface;

/** Spacing used to walk a contour into the ring; fine enough that a wall reads as smooth. */
const RING_SPACING = 0.01;

function contourPoints(contour: THREE.Shape | THREE.Path): Point2[] {
  // getPoints subdivides per curve, so it is only used here to get *a* polygon; resample then
  // makes the spacing uniform and independent of how the font authored the glyph.
  const raw = contour.getPoints(24).map((p) => ({ x: p.x, y: p.y }));
  const first = raw[0];
  const last = raw[raw.length - 1];
  if (raw.length > 1 && first && last && Math.hypot(first.x - last.x, first.y - last.y) < 1e-9) {
    raw.pop();
  }
  // resample closes the loop itself; passing an already-closed ring would double the seam point.
  return resample(raw, RING_SPACING);
}

export function surfacesOf(shapes: readonly THREE.Shape[], depth: number): Surface[] {
  const polygons: Point2[][] = [];
  const walls: WallSurface[] = [];

  for (const shape of shapes) {
    for (const contour of [shape, ...shape.holes]) {
      const ring = contourPoints(contour);
      if (ring.length < 3) continue;
      polygons.push(ring);
      walls.push({
        kind: 'wall',
        ring,
        perimeter: pathLength([...ring, ring[0] as Point2]),
        depth,
      });
    }
  }

  if (polygons.length === 0) return [];
  return [{ kind: 'front', z: depth, polygons }, { kind: 'back', z: 0, polygons }, ...walls];
}

/**
 * A point on the wall from arc length and a 0..1 depth fraction. Arc length wraps: a generator
 * that let it clamp would produce a run jumping the width of the letter at the seam.
 */
export function wallPointAt(
  wall: WallSurface,
  along: number,
  depthFraction: number,
): THREE.Vector3 {
  const n = wall.ring.length;
  const wrapped = ((along % wall.perimeter) + wall.perimeter) % wall.perimeter;
  const t = (wrapped / wall.perimeter) * n;
  const i = Math.floor(t) % n;
  const frac = t - Math.floor(t);
  const a = wall.ring[i] as Point2;
  const b = wall.ring[(i + 1) % n] as Point2;
  return new THREE.Vector3(
    a.x + (b.x - a.x) * frac,
    a.y + (b.y - a.y) * frac,
    depthFraction * wall.depth,
  );
}
