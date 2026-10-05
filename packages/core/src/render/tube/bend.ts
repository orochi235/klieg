import type * as THREE from 'three';

/**
 * The floor on `bend`, inherited from the sweep's old CLEARANCE of 0.8: a tube may occupy at most
 * that fraction of its path's curvature radius before the inner wall passes through itself.
 */
export const BEND_FLOOR = 1.25;
export const DEFAULT_BEND = 2;
/** `DEFAULT_CORNER = PI/6` restated as a bend radius, at the shipped spacing and radius. */
export const STYLE_FACTOR = 1.76;

/** Minimum bend radius in em. `bend` is a multiple of `radius`, so changing radius cannot break it. */
export function minBendRadius(radius: number, bend: number | undefined): number {
  return radius * Math.max(BEND_FLOOR, bend ?? DEFAULT_BEND);
}

export interface VertexBend {
  index: number;
  /** Direction change at this vertex, in radians. */
  turn: number;
  /** Bend radius the path takes here, in em. Infinite on a straight stretch. */
  rho: number;
  /** Mean of the two adjacent segment lengths — the `s` in `s / (2 sin(theta/2))`. */
  step: number;
}

export interface Corner extends VertexBend {
  /** Below `rhoMin`: the material physically cannot go round it. */
  hard: boolean;
  /**
   * Vertices in this corner's stretch before and after the one it was collapsed to. Arc-length
   * resampling splits a sharp corner across two vertices whenever a sample does not land on it, so
   * a corner is routinely a stretch; filleting only the tightest vertex leaves its neighbours
   * over-bent. `spikes/corner-width.mjs` measures this on a square with no distance field near it.
   */
  groupBefore: number;
  groupAfter: number;
}

/**
 * Every vertex's bend radius. A closed path tests every index, wrapping at the seam; an open path
 * never treats its own endpoints as corners, since they have no incoming or outgoing leg.
 */
export function vertexBends(points: THREE.Vector3[], closed: boolean): VertexBend[] {
  const n = points.length;
  if (n < 3) return [];
  const out: VertexBend[] = [];
  const count = closed ? n : n - 2;
  const first = closed ? 0 : 1;
  for (let k = 0; k < count; k++) {
    const i = first + k;
    const prev = points[(i - 1 + n) % n] as THREE.Vector3;
    const cur = points[i] as THREE.Vector3;
    const next = points[(i + 1) % n] as THREE.Vector3;
    const a = cur.clone().sub(prev);
    const b = next.clone().sub(cur);
    if (a.lengthSq() < 1e-18 || b.lengthSq() < 1e-18) continue;
    const step = (a.length() + b.length()) / 2;
    const turn = a.normalize().angleTo(b.normalize());
    const rho = turn < 1e-9 ? Number.POSITIVE_INFINITY : step / (2 * Math.sin(turn / 2));
    out.push({ index: i, turn, rho, step });
  }
  return out;
}

/**
 * Corners tighter than the detection threshold, each consecutive stretch collapsed to its tightest
 * vertex, and flagged `hard` below `rhoMin`.
 */
export function cornersByBend(
  points: THREE.Vector3[],
  closed: boolean,
  rhoMin: number,
  rhoStyle: number,
): Corner[] {
  // Detect at whichever threshold is higher. A corner below rhoMin is hard whatever rhoStyle says,
  // and one missed here is never fixed by any later stage — the invariant fails with no local cause.
  const detect = Math.max(rhoMin, rhoStyle);
  const hits = vertexBends(points, closed).filter((b) => b.rho < detect);
  if (hits.length === 0) return [];

  const groups: VertexBend[][] = [[hits[0] as VertexBend]];
  for (let k = 1; k < hits.length; k++) {
    const hit = hits[k] as VertexBend;
    const group = groups[groups.length - 1] as VertexBend[];
    const prev = group[group.length - 1] as VertexBend;
    if (hit.index === prev.index + 1) group.push(hit);
    else groups.push([hit]);
  }
  // A corner straddling a closed path's seam splits into a group ending at n-1 and one starting at
  // 0; they are adjacent by wraparound and are one corner.
  if (closed && groups.length > 1) {
    const head = groups[0] as VertexBend[];
    const tail = groups[groups.length - 1] as VertexBend[];
    if (head[0]?.index === 0 && tail[tail.length - 1]?.index === points.length - 1) {
      groups[0] = tail.concat(head);
      groups.pop();
    }
  }

  return groups.map((g) => {
    const tightest = g.reduce((a, b) => (b.rho < a.rho ? b : a));
    const j = g.indexOf(tightest);
    return {
      ...tightest,
      hard: tightest.rho < rhoMin,
      groupBefore: j,
      groupAfter: g.length - 1 - j,
    };
  });
}

export interface Fillet {
  /** Replacement points from the incoming tangent point to the outgoing one, inclusive. */
  points: THREE.Vector3[];
  /** Distance back along each leg to the tangent point. */
  setback: number;
  /** Index of the corner vertex these points replace. */
  index: number;
  /** The corner the setback is measured from — virtual, when the fillet spans a stretch. */
  corner: THREE.Vector3;
}

/**
 * A circular arc of radius `rhoMin` tangent to both legs at `index`, resampled at `spacing`.
 * Returns null when either leg is shorter than the setback — the caller falls back to a break.
 */
export function filletAt(
  points: THREE.Vector3[],
  closed: boolean,
  index: number,
  rhoMin: number,
  spacing: number,
): Fillet | null {
  const n = points.length;
  if (!closed && (index < 1 || index > n - 2)) return null;
  const prev = points[(index - 1 + n) % n] as THREE.Vector3 | undefined;
  const cur = points[index] as THREE.Vector3 | undefined;
  const next = points[(index + 1) % n] as THREE.Vector3 | undefined;
  if (!prev || !cur || !next) return null;

  const into = cur.clone().sub(prev);
  const outOf = next.clone().sub(cur);
  if (into.lengthSq() < 1e-18 || outOf.lengthSq() < 1e-18) return null;
  const u = into.clone().normalize();
  const v = outOf.clone().normalize();
  const turn = u.angleTo(v);
  // A straight join needs no fillet; a full reversal has no arc meeting both legs.
  if (turn < 1e-6 || turn > Math.PI - 1e-6) return null;

  const setback = rhoMin * Math.tan(turn / 2);
  if (setback > into.length() || setback > outOf.length()) return null;

  const start = cur.clone().addScaledVector(u, -setback);
  const end = cur.clone().addScaledVector(v, setback);
  // The centre sits off the corner along the internal bisector, at rhoMin / cos(turn/2).
  const bisector = v.clone().sub(u).normalize();
  const centre = cur.clone().addScaledVector(bisector, rhoMin / Math.cos(turn / 2));

  const radial = start.clone().sub(centre);
  const axis = radial.clone().cross(end.clone().sub(centre));
  if (axis.lengthSq() < 1e-18) return null;
  axis.normalize();

  const sweep = radial.angleTo(end.clone().sub(centre));
  // Half `spacing`, not `spacing`. The sweep smooths a run three times before measuring it, which
  // is calibrated for the distance field's staircase noise on straightish stretches; on a coarsely
  // sampled arc it shrinks the radius by around a tenth, enough to fail the invariant it checks.
  const steps = Math.max(4, Math.ceil((sweep * rhoMin) / (spacing / 2)));
  const arc: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    arc.push(centre.clone().add(radial.clone().applyAxisAngle(axis, (i / steps) * sweep)));
  }
  return { points: arc, setback, index, corner: cur.clone() };
}

/**
 * The bend a junction really carries, measured with its shorter step. Circumradius through a triple
 * is set by its longer side, so a leg stepped back from a fillet reads as straighter the further it
 * retreats — the invariant can be satisfied by walking away from the corner instead of fixing it.
 */
export function junctionRadius(
  prev: THREE.Vector3,
  mid: THREE.Vector3,
  next: THREE.Vector3,
): number {
  const into = mid.clone().sub(prev);
  const outOf = next.clone().sub(mid);
  if (into.lengthSq() < 1e-18 || outOf.lengthSq() < 1e-18) return Number.POSITIVE_INFINITY;
  const turn = into.clone().normalize().angleTo(outOf.clone().normalize());
  if (turn < 1e-9) return Number.POSITIVE_INFINITY;
  return Math.min(into.length(), outOf.length()) / (2 * Math.sin(turn / 2));
}

/** Samples the arc leaving `from` along `tangent` and ending at `to`, at `step`. */
function arcThrough(
  from: THREE.Vector3,
  tangent: THREE.Vector3,
  to: THREE.Vector3,
  step: number,
): { points: THREE.Vector3[]; radius: number } {
  const chord = to.clone().sub(from);
  const straight = { points: [from.clone(), to.clone()], radius: Number.POSITIVE_INFINITY };
  if (chord.lengthSq() < 1e-18) return straight;
  const perp = chord.clone().addScaledVector(tangent, -chord.dot(tangent));
  if (perp.lengthSq() < 1e-18) return straight;
  const phi = tangent.angleTo(chord);
  if (phi < 1e-9) return straight;

  const radius = chord.length() / (2 * Math.sin(phi));
  const centre = from.clone().addScaledVector(perp.normalize(), radius);
  const radial = from.clone().sub(centre);
  const axis = radial.clone().cross(to.clone().sub(centre));
  if (axis.lengthSq() < 1e-18) return straight;
  axis.normalize();

  const sweep = radial.angleTo(to.clone().sub(centre));
  const steps = Math.max(2, Math.ceil((sweep * radius) / step));
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    points.push(centre.clone().add(radial.clone().applyAxisAngle(axis, (i / steps) * sweep)));
  }
  return { points, radius };
}

/**
 * Two arcs meeting at a common tangent, leaving `p0` along `t0` and arriving at `p1` along `t1`.
 * Null when either arc would bend tighter than `rhoMin`.
 *
 * A blend between two directed points always exists, so the path meets it tangentially by
 * construction rather than by a fit that can be wrong. Equal tangent lengths pick one member of the
 * one-parameter family. Feasibility is not monotone in the room available: giving the blend more
 * path can lower its tightest radius as well as raise it, so a caller searching outward has to test
 * every candidate rather than stopping at the first failure.
 */
export function biarcBlend(
  p0: THREE.Vector3,
  t0: THREE.Vector3,
  p1: THREE.Vector3,
  t1: THREE.Vector3,
  rhoMin: number,
  spacing: number,
): THREE.Vector3[] | null {
  const u = t0.clone().normalize();
  const v = t1.clone().normalize();
  const d = p1.clone().sub(p0);
  if (d.lengthSq() < 1e-18) return null;

  const sum = u.clone().add(v);
  const a = 2 * u.dot(v) - 2;
  const b = -2 * d.dot(sum);
  const c = d.lengthSq();
  let alpha: number;
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) < 1e-12) return null;
    alpha = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const root = Math.sqrt(disc);
    alpha = Math.max((-b + root) / (2 * a), (-b - root) / (2 * a));
  }
  if (!(alpha > 0)) return null;

  const joint = p0
    .clone()
    .addScaledVector(u, alpha)
    .add(p1.clone().addScaledVector(v, -alpha))
    .multiplyScalar(0.5);

  // Half `spacing`, as filletAt samples, so the sweep's smoothing cannot shave the built radius.
  const step = spacing / 2;
  const first = arcThrough(p0, u, joint, step);
  const second = arcThrough(p1, v.clone().negate(), joint, step);
  if (Math.min(first.radius, second.radius) < rhoMin) return null;

  second.points.reverse();
  return first.points.concat(second.points.slice(1));
}

interface GridEntry {
  point: THREE.Vector3;
  path: number;
  /** Cumulative arc length along its own path, for the same-neighbourhood exclusion. */
  along: number;
}

/**
 * A uniform spatial hash over every path point, answering "what is the nearest piece of tube that is
 * not this piece". Cell size should be the query radius, so a query touches 27 cells.
 */
export class ClearanceGrid {
  private readonly cells = new Map<string, GridEntry[]>();

  constructor(private readonly cell: number) {}

  private key(x: number, y: number, z: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }

  add(points: THREE.Vector3[], path: number): void {
    let along = 0;
    for (let i = 0; i < points.length; i++) {
      const point = points[i] as THREE.Vector3;
      if (i > 0) along += point.distanceTo(points[i - 1] as THREE.Vector3);
      const k = this.key(point.x, point.y, point.z);
      const bucket = this.cells.get(k);
      if (bucket) bucket.push({ point, path, along });
      else this.cells.set(k, [{ point, path, along }]);
    }
  }

  /**
   * Distance to the nearest point that is either on another path, or far enough along this one to be
   * a genuinely different piece of tube. Infinite when nothing qualifies within one cell.
   */
  nearest(probe: THREE.Vector3, path: number, along: number, skip = 0.09): number {
    let best = Number.POSITIVE_INFINITY;
    const cx = Math.floor(probe.x / this.cell);
    const cy = Math.floor(probe.y / this.cell);
    const cz = Math.floor(probe.z / this.cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = this.cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!bucket) continue;
          for (const entry of bucket) {
            if (entry.path === path && Math.abs(entry.along - along) < skip) continue;
            best = Math.min(best, probe.distanceTo(entry.point));
          }
        }
      }
    }
    return best;
  }
}
