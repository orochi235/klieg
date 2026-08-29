import * as THREE from 'three';
import { biarcBlend, type Corner } from './bend.js';

/**
 * How a hairpin turns the tube around outside an apex a fillet would cut off.
 *
 * `bisector` is the major arc of the circle of radius `rhoMin` inscribed in the wedge opposite the
 * corner — the construction a bender describes, and tangent to both legs by definition. Its
 * footprint is `rhoMin / cos(turn/2) + rhoMin`, which runs away as the corner sharpens.
 *
 * `uturn` lays a U of diameter `2 rhoMin` on the corner's own axis with its tip a fixed distance
 * past the apex, and blends each end back onto a leg. Its footprint is that overshoot whatever the
 * corner does; it pays for that sideways, being `2 rhoMin` wide where the legs may be closer.
 */
export type HairpinShape = 'bisector' | 'uturn';

export const HAIRPIN_SHAPES: readonly HairpinShape[] = ['bisector', 'uturn'];
export const DEFAULT_HAIRPIN: HairpinShape = 'uturn';

/** How far past the apex a `uturn` puts its tip, in multiples of `rhoMin`. */
const TIP = 0.5;
/** Distances back along each leg a `uturn` tries to blend from, in multiples of `rhoMin`. */
const REACH_LADDER = [1, 1.5, 2, 3, 4, 6];

export interface Hairpin {
  /** From where the tube leaves the incoming leg to where it rejoins the outgoing one. */
  points: THREE.Vector3[];
  /** How far back along each leg, in em, the hairpin takes over. */
  reach: number;
  /** How far past the apex the tube stands, in em. */
  proud: number;
}

function proudOf(points: THREE.Vector3[], apex: THREE.Vector3): number {
  let proud = 0;
  for (const q of points) proud = Math.max(proud, q.distanceTo(apex));
  return proud;
}

function arcPoints(
  centre: THREE.Vector3,
  from: THREE.Vector3,
  axis: THREE.Vector3,
  sweep: number,
  step: number,
): THREE.Vector3[] {
  const radial = from.clone().sub(centre);
  const steps = Math.max(8, Math.ceil((sweep * radial.length()) / step));
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    out.push(centre.clone().add(radial.clone().applyAxisAngle(axis, (i / steps) * sweep)));
  }
  return out;
}

function bisectorHairpin(
  apex: THREE.Vector3,
  u: THREE.Vector3,
  v: THREE.Vector3,
  turn: number,
  rhoMin: number,
  spacing: number,
): Hairpin | null {
  const setback = rhoMin * Math.tan(turn / 2);
  const entry = apex.clone().addScaledVector(u, setback);
  const exit = apex.clone().addScaledVector(v, -setback);
  // The internal bisector carries a fillet's centre; the hairpin's is the same distance the other
  // way, which is what puts the arc outside the apex rather than across it.
  const bisector = v.clone().sub(u).normalize();
  const centre = apex.clone().addScaledVector(bisector, -rhoMin / Math.cos(turn / 2));

  const radial = entry.clone().sub(centre);
  const axis = radial.clone().cross(u);
  if (axis.lengthSq() < 1e-18) return null;
  axis.normalize();
  // The major arc: the minor one is a fillet's own sweep reflected, and cuts the apex off again.
  const sweep = 2 * Math.PI - radial.angleTo(exit.clone().sub(centre));
  const points = arcPoints(centre, entry, axis, sweep, spacing / 2);
  return { points, reach: -setback, proud: proudOf(points, apex) };
}

/** The bend a path takes at `mid`, in em, as `runs.ts` measures a junction. */
function bendThrough(a: THREE.Vector3, mid: THREE.Vector3, b: THREE.Vector3): number {
  const into = mid.clone().sub(a);
  const outOf = b.clone().sub(mid);
  if (into.lengthSq() < 1e-18 || outOf.lengthSq() < 1e-18) return Number.POSITIVE_INFINITY;
  const turn = into.clone().normalize().angleTo(outOf.clone().normalize());
  if (turn < 1e-9) return Number.POSITIVE_INFINITY;
  return Math.min(into.length(), outOf.length()) / (2 * Math.sin(turn / 2));
}

/** The leg vertex nearest `reach` of arc length from the apex, walking outward from it. */
function vertexAt(leg: THREE.Vector3[], step: 1 | -1, reach: number): number {
  const from = step === 1 ? 0 : leg.length - 1;
  let along = 0;
  for (let i = from + step; i >= 0 && i < leg.length; i += step) {
    along += (leg[i] as THREE.Vector3).distanceTo(leg[i - step] as THREE.Vector3);
    if (along >= reach) return i;
  }
  return -1;
}

function uturnHairpin(
  before: THREE.Vector3[],
  after: THREE.Vector3[],
  apex: THREE.Vector3,
  u: THREE.Vector3,
  v: THREE.Vector3,
  rhoMin: number,
  spacing: number,
): Hairpin | null {
  const axis = new THREE.Vector3(0, 0, 1);
  const outward = v.clone().sub(u).normalize().negate();
  const across = outward.clone().cross(axis).normalize();
  const tip = apex.clone().addScaledVector(outward, rhoMin * TIP);
  const centre = tip.clone().addScaledVector(outward, -rhoMin);

  // The U is entered from the side the tube arrives on, which is behind the apex along `u`.
  const sign = Math.sign(across.dot(u.clone().negate())) || 1;
  const entry = centre.clone().addScaledVector(across, rhoMin * sign);
  const exit = centre.clone().addScaledVector(across, -rhoMin * sign);
  // Both rotations land on `exit`; only one bulges through the tip, and that one is the U.
  const turnaround = [1, -1]
    .map((way) => arcPoints(centre, entry, axis.clone().multiplyScalar(way), Math.PI, spacing / 2))
    .sort(
      (a, b) =>
        (a[a.length >> 1] as THREE.Vector3).distanceTo(tip) -
        (b[b.length >> 1] as THREE.Vector3).distanceTo(tip),
    )[0] as THREE.Vector3[];

  // Blend from the leg's own vertices, never from a point on the leg *line*: the contour is only
  // approximately straight there, and a blend that starts beside the path rather than on it leaves a
  // junction the bend floor does not survive. Measured at 0.52 of the floor before this.
  for (const factor of REACH_LADDER) {
    const reach = rhoMin * factor;
    const iFrom = vertexAt(before, -1, reach);
    const iTo = vertexAt(after, 1, reach);
    if (iFrom < 1 || iTo < 1) continue;
    const from = before[iFrom] as THREE.Vector3;
    const to = after[iTo] as THREE.Vector3;
    const into = biarcBlend(from, u, entry, outward, rhoMin, spacing);
    const outOf = biarcBlend(exit, outward.clone().negate(), to, v, rhoMin, spacing);
    if (!into || !outOf) continue;
    // The vertices the blend hands back to are not part of it, so their junctions are unchecked.
    const before1 = before[iFrom - 1] as THREE.Vector3 | undefined;
    const after1 = after[iTo + 1] as THREE.Vector3 | undefined;
    if (before1 && bendThrough(before1, from, into[1] as THREE.Vector3) < rhoMin) continue;
    const last = outOf[outOf.length - 2] as THREE.Vector3;
    if (after1 && bendThrough(last, to, after1) < rhoMin) continue;
    // The blends already start and end on the path's own vectors; keep those, not the copies.
    into[0] = from;
    outOf[outOf.length - 1] = to;
    const points = into.concat(turnaround.slice(1), outOf.slice(1));
    return { points, reach, proud: proudOf(points, apex) };
  }
  return null;
}

/**
 * The hairpin for `corner`, whose legs arrive along `u` and leave along `v`. Null where the shape
 * cannot be built — a `uturn` finds no reach whose blends both clear `rhoMin`, or the legs are
 * straight or fully reversed and there is no apex to turn around.
 *
 * `reach` is negative for `bisector`, whose tangent points sit *past* the apex rather than back
 * along the legs: it takes over no leg at all, where a `uturn` takes over `reach` of each.
 */
export function hairpinAt(
  before: THREE.Vector3[],
  after: THREE.Vector3[],
  u: THREE.Vector3,
  v: THREE.Vector3,
  shape: HairpinShape,
  rhoMin: number,
  spacing: number,
): Hairpin | null {
  const apex = before[before.length - 1] as THREE.Vector3 | undefined;
  if (!apex) return null;
  const turn = u.angleTo(v);
  if (turn < 1e-6 || turn > Math.PI - 1e-6) return null;
  return shape === 'bisector'
    ? bisectorHairpin(apex, u, v, turn, rhoMin, spacing)
    : uturnHairpin(before, after, apex, u, v, rhoMin, spacing);
}

/** How much of the apex a fillet at `rhoMin` would cut away — what a hairpin is offered against. */
export function apexLoss(corner: Corner, rhoMin: number): number {
  const turn = Math.min(corner.turn, Math.PI * 0.98);
  return 2 * rhoMin * Math.tan(turn / 2) - rhoMin * corner.turn;
}
