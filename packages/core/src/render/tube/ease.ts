import type * as THREE from 'three';
import { cornersByBend, vertexBends } from './bend.js';

/** How far under the floor a corner may sit and still be eased rather than cut, as a fraction. */
export const EASE_MARGIN = 0.1;
/** Vertices either side of a corner's stretch that the easing may move. */
const REACH = 3;
const ROUNDS = 60;

/**
 * Smooths the hard corners that sit only just under `rhoMin` until they clear it, moving points in
 * place. Such a corner lies inside a stretch that is already curving, so there are no straight legs
 * for a fillet to be tangent to, and fitting one there kinks the junction. Returns how many it
 * eased; a corner whose easing would move any point further than `drift` is left alone.
 */
export function easeShallowCorners(
  points: THREE.Vector3[],
  closed: boolean,
  rhoMin: number,
  drift: number,
): number {
  const n = points.length;
  let eased = 0;
  for (const corner of cornersByBend(points, closed, rhoMin, rhoMin)) {
    if (!corner.hard || corner.rho < rhoMin * (1 - EASE_MARGIN)) continue;
    const lo = corner.index - corner.groupBefore - REACH;
    const hi = corner.index + corner.groupAfter + REACH;
    if (!closed && (lo < 1 || hi > n - 2)) continue;
    if (hi - lo + 1 >= n) continue;
    const window = Array.from({ length: hi - lo + 1 }, (_, k) => (lo + k + n) % n);
    const at = window.map((i) => points[i] as THREE.Vector3);
    const start = at.map((p) => p.clone());
    // The window's own ends stay put, and their neighbors outside it are in the triples measured.
    const clears = () => {
      const ring = [lo - 1, ...window.map((_, k) => lo + k), hi + 1].map(
        (i) => points[(i + n) % n] as THREE.Vector3,
      );
      return vertexBends(ring, false).every((b) => b.rho >= rhoMin);
    };
    const set = (to: readonly THREE.Vector3[]) => {
      for (const [k, p] of at.entries()) p.copy(to[k] as THREE.Vector3);
    };
    let round = 0;
    while (!clears() && round++ < ROUNDS) {
      set(at.map((p, k) => (k === 0 || k === at.length - 1 ? p.clone() : laplace(at, k))));
    }
    if (clears() && at.every((p, k) => p.distanceTo(start[k] as THREE.Vector3) <= drift)) {
      eased++;
      continue;
    }
    set(start);
  }
  return eased;
}

/** Half way from a point to the midpoint of its neighbors. */
function laplace(at: readonly THREE.Vector3[], k: number): THREE.Vector3 {
  const mid = (at[k - 1] as THREE.Vector3).clone().lerp(at[k + 1] as THREE.Vector3, 0.5);
  return (at[k] as THREE.Vector3).clone().lerp(mid, 0.5);
}
