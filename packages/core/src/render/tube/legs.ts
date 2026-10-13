import * as THREE from 'three';
import { type Corner, endsOf, type Fillet } from './bend.js';
import { minCurvatureRadius3 } from './resample.js';

/** @internal */
export function polyLength(points: THREE.Vector3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += (points[i] as THREE.Vector3).distanceTo(points[i - 1] as THREE.Vector3);
  }
  return total;
}

/**
 * Drops the tail of `span` back past the fillet's tangent point. Measured from the corner rather
 * than accumulated step by step: leaving a point *inside* the setback makes the path run forward to
 * it and then jump back to the tangent point, and that reversal reads as a tighter bend than the
 * corner it replaced.
 */
export function trimTail(span: THREE.Vector3[], back: number, corner: THREE.Vector3): void {
  span.length = keptByTail(span, back, corner);
}

/**
 * How many vertices `trimTail` would leave. Split out so a site can name the stretch about to go
 * without running the trim — the repair may be switched off, and the report has to be the same
 * either way.
 */
export function keptByTail(span: THREE.Vector3[], back: number, corner: THREE.Vector3): number {
  let keep = span.length;
  while (keep > 0 && (span[keep - 1] as THREE.Vector3).distanceTo(corner) < back) keep--;
  return keep;
}

/**
 * The first index in `span` at or past `from` that clears `back` of the corner, or `span.length`
 * when none does. Falling back to the last index instead would hand the arc a leg point it has
 * already passed, which is the reversal the trim exists to prevent.
 */
export function indexPast(
  span: THREE.Vector3[],
  from: number,
  back: number,
  corner: THREE.Vector3,
): number {
  for (let i = Math.max(1, from); i < span.length; i++) {
    if ((span[i] as THREE.Vector3).distanceTo(corner) >= back) return i;
  }
  return span.length;
}

/** Segments averaged into a leg's direction. Four spans twice the setback at the shipped spacing. */
const LEG_WINDOW = 4;

/**
 * A leg's direction, averaged over several segments rather than taken from the one segment next to
 * the corner. A corner keeps turning past the stretch that detection collapses it to — measured on
 * both the field-traced and the directly-traced contour, that shoulder reaches 20 degrees — and a
 * direction taken there tilts the virtual corner off the leg the fillet has to be tangent to.
 */
export function legDirection(
  span: THREE.Vector3[],
  at: number,
  step: 1 | -1,
): THREE.Vector3 | null {
  const dir = new THREE.Vector3();
  for (let k = 0; k < LEG_WINDOW; k++) {
    const i = step === 1 ? at + k : at - k - 1;
    const a = span[i] as THREE.Vector3 | undefined;
    const b = span[i + 1] as THREE.Vector3 | undefined;
    if (!a || !b) break;
    const d = b.clone().sub(a);
    if (d.lengthSq() < 1e-18) break;
    dir.add(d.normalize());
  }
  return dir.lengthSq() < 1e-18 ? null : dir.normalize();
}

/**
 * Where two leg lines meet, as the midpoint of their mutual perpendicular — the corner the path
 * would have had before resampling rounded it. Null when the legs are parallel and there is none.
 */
export function legIntersection(
  a: THREE.Vector3,
  u: THREE.Vector3,
  b: THREE.Vector3,
  v: THREE.Vector3,
): THREE.Vector3 | null {
  const uv = u.dot(v);
  const denom = 1 - uv * uv;
  if (Math.abs(denom) < 1e-9) return null;
  const w = a.clone().sub(b);
  const s = (uv * w.dot(v) - w.dot(u)) / denom;
  const t = w.dot(v) - uv * w.dot(u);
  const p = a.clone().addScaledVector(u, s);
  const q = b.clone().addScaledVector(v, t / denom);
  return p.add(q).multiplyScalar(0.5);
}

/** How far `point` sits from a tangent point along the leg leaving it. Negative when it is inside. */
export function legGap(
  point: THREE.Vector3 | undefined,
  tangent: THREE.Vector3,
  along: THREE.Vector3,
): number {
  return point ? point.clone().sub(tangent).dot(along) : Number.POSITIVE_INFINITY;
}

/**
 * How much leg a corner consumes either side of the vertex it was collapsed to — to the fillet's
 * tangent points when it fillets, and to the end of its stretch when it breaks. A break shortens
 * the leg for the corner at the other end of it just as a fillet does.
 */
export function eatenBy(
  corner: Corner,
  fillet: Fillet | null,
  before: THREE.Vector3[],
  after: THREE.Vector3[],
): { before: number; after: number } {
  const vertex = before[before.length - 1] as THREE.Vector3 | undefined;
  if (!vertex) return { before: 0, after: 0 };
  if (fillet) {
    const { entry, exit } = endsOf(fillet);
    return { before: vertex.distanceTo(entry), after: vertex.distanceTo(exit) };
  }
  return {
    before: polyLength(before.slice(Math.max(0, before.length - corner.groupBefore - 2))),
    after: polyLength(after.slice(0, corner.groupAfter + 2)),
  };
}

/** The bend the path takes at `mid`, in em. */
export function bendThrough(a: THREE.Vector3, mid: THREE.Vector3, b: THREE.Vector3): number {
  return minCurvatureRadius3([a, mid, b].map((p) => ({ x: p.x, y: p.y, z: p.z })));
}

/**
 * Where the leg resumes after a fillet: the last vertex whose own bend, taken across the junction
 * into the arc, still clears `rhoMin`.
 *
 * The fit reads the shoulder as straight where it is still turning, so the vertex nearest the
 * tangent point sits off the leg line the arc is tangent to — by up to half a sample step. That
 * offset is worst exactly there: the arc is sampled at half `spacing`, so a junction chord meets a
 * step half as long as its own, and the circumradius of the two is the junction chord over twice
 * the sine of the turn. Stepping back lengthens that chord faster than the offset grows.
 */
export function resumeAt(
  leg: THREE.Vector3[],
  from: number,
  step: 1 | -1,
  tangent: THREE.Vector3,
  second: THREE.Vector3,
  along: THREE.Vector3,
  rhoMin: number,
  spacing: number,
): number {
  for (let i = from; i >= 0 && i < leg.length; i += step) {
    const p = leg[i] as THREE.Vector3;
    const before = leg[i - step] as THREE.Vector3 | undefined;
    if (legGap(p, tangent, along) < spacing) continue;
    if (bendThrough(p, tangent, second) < rhoMin) continue;
    // Both vertices of the junction, not only the one on the arc: stepping back moves the residual
    // onto the leg, and a resume that clears at the tangent point can fail at itself.
    if (before && bendThrough(before, p, tangent) < rhoMin) continue;
    return i;
  }
  return step === 1 ? leg.length : -1;
}
