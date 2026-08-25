import type * as THREE from 'three';
import { rng } from '../../rng.js';
import type { GeneratedPath } from './generators.js';

/** Cumulative arc length at each point, `cum[0] === 0`. */
function cumulativeLengths(points: THREE.Vector3[]): number[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1] as THREE.Vector3;
    cum.push((cum[i - 1] as number) + (points[i] as THREE.Vector3).distanceTo(prev));
  }
  return cum;
}

/**
 * Bends a face path's z gently along its length — x/y keep hugging the level set.
 *
 * This runs **before** the cut, not after. Wander is a bend like any other, so putting it ahead of
 * corner detection lets that stage see it and fillet or cut whatever it makes too tight; run after
 * the cut it had to carry a curvature cap of its own, and that cap bound hardest on exactly the
 * short runs a return-heavy letter is full of. It also means a contour wanders as one piece of
 * glass rather than each run guessing separately.
 *
 * A closed path uses a whole number of periods so its seam meets itself; an open one pins both ends.
 */
export function wanderPaths(paths: GeneratedPath[], amplitude: number, seed: number): void {
  if (amplitude === 0) return;

  paths.forEach((path, index) => {
    if (path.surface !== 'front' && path.surface !== 'back') return;
    const points = path.points;
    if (points.length < 3) return;

    const cum = cumulativeLengths(points);
    const total = cum[cum.length - 1] as number;
    if (total <= 0) return;

    const random = rng((Math.round(seed * 2654435761) ^ 0x9e3779b1 ^ index) >>> 0);
    // One or two slow undulations, never per-point noise — the path is swept as tube, and it has
    // to read as gently bent glass.
    const lobes = 1 + (random() < 0.5 ? 0 : 1);
    const sign = random() < 0.5 ? -1 : 1;
    const scale = 0.7 + random() * 0.3;
    const turns = path.closed ? 2 * Math.PI * lobes : Math.PI * lobes;

    for (let i = 0; i < points.length; i++) {
      const s = (cum[i] as number) / total;
      (points[i] as THREE.Vector3).z += amplitude * sign * scale * Math.sin(s * turns);
    }
  });
}
