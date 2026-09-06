import * as THREE from 'three';
import { type Field, signedDistanceField } from './tube/field.js';

/**
 * How a letter's front face stands proud of the flat cap.
 *
 * `t` is the fraction of `reach` a point sits inside the lid's own edge; the answer is the fraction
 * of `rise` it stands above. Every profile here has a **finite slope where it meets the cap**, and
 * that is a hard constraint rather than a preference: refinement is driven by how far a triangle's
 * chord falls from the profile, so a vertical tangent at the rim never converges. A circular arc
 * standing straight up off the seam costs 117,895 vertices and still misses by 1.00% of its rise,
 * where `cushion` — the same look with the arc meeting the cap tangentially — costs 7,130 for 0.79%.
 */
export type Profile = (t: number) => number;

export const PROFILES = {
  /** What ships. */
  flat: () => 0,
  /** A smoothstep: a pillow's look, with a slope the refinement can converge on. */
  cushion: (t: number) => t * t * (3 - 2 * t),
  dome: (t: number) => Math.sin((Math.PI * t) / 2),
  /** Linear, which creases each stroke down its spine and reads as folded channel. */
  ridge: (t: number) => t,
} satisfies Record<string, Profile>;

export type ProfileName = keyof typeof PROFILES;

export interface InflateOptions {
  profile: ProfileName;
  /** How far the crown stands above the flat cap, in em. */
  rise: number;
  /** How far in from the lid's edge the inflation reaches full height, in em. */
  reach: number;
  /** Chord-to-profile error a refined triangle is allowed, in em. */
  tolerance: number;
  /** Grid cells per side for the lid's own field. */
  resolution: number;
}

export const DEFAULT_INFLATE: InflateOptions = {
  profile: 'cushion',
  rise: 0.1,
  reach: 0.09,
  tolerance: 0.002,
  resolution: 384,
};

/** How many refinement passes before the mesh is taken as good as it gets. */
const PASSES = 12;

export interface Point {
  x: number;
  y: number;
}

/**
 * The extruder lays its lid faces down with the walls; a triangle is the front lid when it faces
 * +z and sits flat against the front plane. Split on geometry rather than on buffer order, which
 * survives a change in how three groups its output.
 */
function splitLid(geo: THREE.BufferGeometry, top: number) {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  const lid: Point[][] = [];
  const rest: number[] = [];
  const restNormal: number[] = [];
  for (let t = 0; t < pos.count; t += 3) {
    const flat = [0, 1, 2].every((k) => Math.abs(pos.getZ(t + k) - top) < 1e-6);
    const facing = [0, 1, 2].every((k) => nrm.getZ(t + k) > 0.999);
    if (flat && facing) {
      lid.push([0, 1, 2].map((k) => ({ x: pos.getX(t + k), y: pos.getY(t + k) })));
      continue;
    }
    for (let k = 0; k < 3; k++) {
      rest.push(pos.getX(t + k), pos.getY(t + k), pos.getZ(t + k));
      restNormal.push(nrm.getX(t + k), nrm.getY(t + k), nrm.getZ(t + k));
    }
  }
  return { lid, rest, restNormal };
}

/** Every edge used by exactly one triangle, chained into closed rings of vertex ids. */
export function boundaryRings(faces: readonly number[][]): number[][] {
  const seen = new Map<string, [number, number]>();
  for (const face of faces) {
    const [a, b, c] = face as [number, number, number];
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as [number, number][]) {
      const back = `${v},${u}`;
      if (seen.has(back)) seen.delete(back);
      else seen.set(`${u},${v}`, [u, v]);
    }
  }
  const next = new Map<number, number>();
  for (const [u, v] of seen.values()) next.set(u, v);
  const rings: number[][] = [];
  const done = new Set<number>();
  for (const start of next.keys()) {
    if (done.has(start)) continue;
    const ring: number[] = [];
    let at = start;
    while (!done.has(at)) {
      done.add(at);
      ring.push(at);
      const to = next.get(at);
      if (to === undefined) break;
      at = to;
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/** Bilinear, unlike `Field.sample`, which rounds — a nearest sample stairsteps the crown. */
function depthAt(field: Field, x: number, y: number): number {
  const { data, size, emPerCell, originX, originY } = field;
  const gx = Math.min(Math.max((x - originX) / emPerCell, 0), size - 1.0001);
  const gy = Math.min(Math.max((y - originY) / emPerCell, 0), size - 1.0001);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const d00 = data[y0 * size + x0] as number;
  const d10 = data[y0 * size + x0 + 1] as number;
  const d01 = data[(y0 + 1) * size + x0] as number;
  const d11 = data[(y0 + 1) * size + x0 + 1] as number;
  return (d00 * (1 - fx) + d10 * fx) * (1 - fy) + (d01 * (1 - fx) + d11 * fx) * fy;
}

export interface Inflated {
  geometry: THREE.BufferGeometry;
  /** Whether refinement reached the tolerance rather than running out of passes. */
  converged: boolean;
  /** Lid triangles before and after, which is what an inflation actually costs. */
  before: number;
  after: number;
}

/**
 * How far a point stands above the flat cap, and zero on the rings it was measured from.
 *
 * The rings are the **lid's**, never the glyph's outline. The lid is the outline inset by the
 * bevel, so measuring from the outline lifts the crown's rim off the bevel it is supposed to meet —
 * a step all the way around the letter.
 */
export type Crown = (x: number, y: number) => number;

/** Nothing to displace: a flat profile, no rise, or no boundary to measure from. */
export function crownOf(rings: readonly (readonly Point[])[], opts: InflateOptions): Crown | null {
  if (opts.profile === 'flat' || opts.rise === 0 || rings.length === 0) return null;
  const profile = PROFILES[opts.profile];
  // Named, the way an unregistered cutter or fill is. `profile` is typed, but klieg ships to
  // JavaScript too, and `profile is not a function` names neither the value nor where it came from.
  if (!profile) {
    throw new Error(
      `klieg: no inflation profile named '${opts.profile}' — one of ${Object.keys(PROFILES).join(', ')}`,
    );
  }
  const field = signedDistanceField(
    rings.map((ring) => ring.map((p) => ({ x: p.x, y: p.y }))),
    { resolution: opts.resolution, pad: 0.05 },
  );
  return (x, y) =>
    opts.rise * profile(Math.min(Math.max(-depthAt(field, x, y) / opts.reach, 0), 1));
}

/** A triangle soup welded into an indexed mesh, so an edge is split once for both its faces. */
export function weld(tris: readonly (readonly Point[])[]): {
  points: Point[];
  faces: number[][];
} {
  const points: Point[] = [];
  const ids = new Map<string, number>();
  const idOf = (p: Point) => {
    const k = `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;
    let id = ids.get(k);
    if (id === undefined) {
      id = points.length;
      points.push({ x: p.x, y: p.y });
      ids.set(k, id);
    }
    return id;
  };
  const faces = tris.map((tri) => tri.map(idOf));
  return { points, faces };
}

/**
 * The lid refined where a triangle's chord falls further from the profile than `tolerance`.
 *
 * `points` is grown in place with every midpoint the refinement introduces, and the faces that
 * replace the ones handed in are returned. `freeze` withholds the boundary: an edge no second face
 * walks is shared with a surface this does not own, and bisecting it leaves that surface facing a
 * vertex it has no vertex for. `inflate` leaves it open, because its lid's rim meets the bevel on a
 * plane where the crown is flat and a collinear extra vertex is invisible; a shell cannot, because
 * a shell is closed or it is not.
 */
export function refineCap(
  points: Point[],
  input: readonly number[][],
  z: (p: Point) => number,
  tolerance: number,
  freeze = false,
): { faces: number[][]; converged: boolean } {
  let faces = input as number[][];
  const ek = (u: number, v: number) => (u < v ? `${u},${v}` : `${v},${u}`);
  const held = new Set<string>();
  if (freeze) {
    const walked = new Map<string, number>();
    for (const f of input) {
      const [a, b, c] = f as [number, number, number];
      for (const [u, v] of [
        [a, b],
        [b, c],
        [c, a],
      ] as [number, number][]) {
        walked.set(ek(u, v), (walked.get(ek(u, v)) ?? 0) + 1);
      }
    }
    for (const [k, n] of walked) if (n === 1) held.add(k);
  }
  const frozen = (f: number[]) => {
    const [a, b, c] = f as [number, number, number];
    return held.has(ek(a, b)) || held.has(ek(b, c)) || held.has(ek(c, a));
  };

  /**
   * Every edge already bisected, and where. Refinement only ever splits a face into four, whose
   * children's edges lie inside its own — the two-triangle "green" split is not nested that way, so
   * a green child refined again in a later pass leaves a hanging node its neighbour never sees.
   * Greens are therefore not part of the hierarchy at all: this loop refines the four-way mesh, and
   * the closure at the end resolves however many edges each surviving face ended up sharing.
   */
  const bisected = new Map<string, number>();
  const midOf = (u: number, v: number) => {
    const k = ek(u, v);
    let id = bisected.get(k);
    if (id === undefined) {
      id = points.length;
      const p = points[u] as Point;
      const q = points[v] as Point;
      points.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
      bisected.set(k, id);
    }
    return id;
  };

  const edgesOf = (f: number[]): [number, number][] => {
    const [a, b, c] = f as [number, number, number];
    return [
      [a, b],
      [b, c],
      [c, a],
    ];
  };

  /**
   * How many times each face has been split. Refinement is kept balanced against it: a face may
   * only split if its neighbours are no coarser, so a single edge never faces more than two.
   * Without it an edge bisected once and its halves bisected again leave an unsplit neighbour
   * facing four segments, and one closure triangle can only ever answer two of them.
   */
  let level = faces.map(() => 0);
  let converged = false;
  for (let pass = 0; pass < PASSES; pass++) {
    /**
     * Faces are marked by their own error, not edges. Marking edges and promoting any face that
     * holds one propagates through every shared edge and refines the whole letter uniformly;
     * marking only where two edges already hang leaves a coarse mesh stuck, because a face there
     * almost always has exactly one edge over tolerance and nothing ever splits.
     */
    const split = new Set<number>();
    for (let i = 0; i < faces.length; i++) {
      if (frozen(faces[i] as number[])) continue;
      for (const [u, v] of edgesOf(faces[i] as number[])) {
        if (bisected.has(ek(u, v)) || held.has(ek(u, v))) continue;
        const p = points[u] as Point;
        const q = points[v] as Point;
        const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        if (Math.abs(z(mid) - (z(p) + z(q)) / 2) > tolerance) {
          split.add(i);
          break;
        }
      }
    }
    if (split.size === 0) {
      converged = true;
      break;
    }

    // Closure. A face left with two hanging nodes splits too, and so does one coarser than a
    // neighbour that is splitting — the balance rule. One hanging node is left to the closure at
    // the end, which is two triangles and cascades no further.
    const owners = new Map<string, number[]>();
    for (let i = 0; i < faces.length; i++) {
      for (const [u, v] of edgesOf(faces[i] as number[])) {
        const k = ek(u, v);
        const at = owners.get(k);
        if (at) at.push(i);
        else owners.set(k, [i]);
      }
    }
    /**
     * Each half of an already-bisected edge, pointed back at the whole one. Without this the
     * balance rule never fires: once an edge is split, the coarse face still holds `(u, v)` while
     * its neighbours hold `(u, m)` and `(m, v)`, so nothing matches and the two sides stop being
     * neighbours at exactly the moment their levels start to diverge.
     */
    const halves = new Map<string, string>();
    for (const [k, m] of bisected) {
      const [u, v] = k.split(',').map(Number) as [number, number];
      halves.set(ek(u, m), k);
      halves.set(ek(m, v), k);
    }
    const across = (k: string): number[] => {
      const parent = halves.get(k);
      return [...(owners.get(k) ?? []), ...(parent ? (owners.get(parent) ?? []) : [])];
    };

    const hanging = new Set<string>();
    for (let grew = true; grew; ) {
      grew = false;
      for (const i of split) {
        for (const [u, v] of edgesOf(faces[i] as number[])) {
          const k = ek(u, v);
          hanging.add(k);
          for (const j of across(k)) {
            if (j === i || split.has(j)) continue;
            if ((level[j] as number) >= (level[i] as number)) continue;
            if (frozen(faces[j] as number[])) continue;
            split.add(j);
            grew = true;
          }
        }
      }
      for (let i = 0; i < faces.length; i++) {
        if (split.has(i) || frozen(faces[i] as number[])) continue;
        const on = edgesOf(faces[i] as number[]).filter(([u, v]) => hanging.has(ek(u, v))).length;
        if (on < 2) continue;
        split.add(i);
        grew = true;
      }
    }

    /**
     * A frozen face can never catch up, so the face beside it stops where it is. Growth only adds
     * and this only removes, so the pair terminates; what it leaves satisfies the balance rule
     * however the set was reached, and the closure below answers one, two or three hanging nodes
     * alike.
     */
    for (let shrank = true; shrank; ) {
      shrank = false;
      for (const i of split) {
        const coarser = edgesOf(faces[i] as number[]).some(([u, v]) =>
          across(ek(u, v)).some(
            (j) => !split.has(j) && (level[j] as number) < (level[i] as number),
          ),
        );
        if (!coarser) continue;
        split.delete(i);
        shrank = true;
      }
    }
    // Not converged: everything still over tolerance is held by a boundary and cannot move.
    if (split.size === 0) break;

    const out: number[][] = [];
    const depth: number[] = [];
    for (let i = 0; i < faces.length; i++) {
      const face = faces[i] as number[];
      if (!split.has(i)) {
        out.push(face);
        depth.push(level[i] as number);
        continue;
      }
      const [a, b, c] = face as [number, number, number];
      const ab = midOf(a, b);
      const bc = midOf(b, c);
      const ca = midOf(c, a);
      out.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
      for (let k = 0; k < 4; k++) depth.push((level[i] as number) + 1);
    }
    faces = out;
    level = depth;
  }

  /**
   * The closure. A face that survived refinement may still share one or two bisected edges with a
   * neighbour that split, and a vertex sitting on an edge nothing else walks is a T-junction — a
   * tear, not a shading artefact. Fanning the extra vertices in costs at most two triangles.
   */
  const closed: number[][] = [];
  for (const face of faces) {
    const es = edgesOf(face);
    const mid = es.map(([u, v]) => bisected.get(ek(u, v)));
    const on = mid.filter((m) => m !== undefined).length;
    const [a, b, c] = face as [number, number, number];
    const [ab, bc, ca] = mid;
    if (on === 0) {
      closed.push([a, b, c]);
    } else if (on === 3) {
      closed.push(
        [a, ab as number, ca as number],
        [ab as number, b, bc as number],
        [ca as number, bc as number, c],
        [ab as number, bc as number, ca as number],
      );
    } else {
      // Rotated so the untouched corner leads, which makes one and two the same two cases.
      const turns: [number, number, number, number | undefined, number | undefined][] = [
        [a, b, c, ab, bc],
        [b, c, a, bc, ca],
        [c, a, b, ca, ab],
      ];
      const pick = turns.find(([, , , m, n]) =>
        on === 1 ? m !== undefined && n === undefined : m !== undefined && n !== undefined,
      );
      if (!pick) throw new Error('klieg: a face was left with an unresolvable set of split edges');
      const [p, q, r, m, n] = pick;
      if (on === 1) {
        closed.push([p, m as number, r], [m as number, q, r]);
      } else {
        closed.push(
          [p, m as number, r],
          [m as number, n as number, r],
          [m as number, q, n as number],
        );
      }
    }
  }
  faces = closed;
  return { faces, converged };
}

/**
 * Crown normals averaged over the indexed mesh, before it is expanded. `computeVertexNormals` on a
 * triangle soup gives every face one constant normal — the crown comes back faceted, and a cushion
 * made of visible triangles is not a cushion.
 */
export function capNormals(
  points: readonly Point[],
  faces: readonly number[][],
  height: readonly number[],
): Float64Array {
  const vn = new Float64Array(points.length * 3);
  for (const face of faces) {
    const [i, j, k] = face as [number, number, number];
    const p = points[i] as Point;
    const q = points[j] as Point;
    const r = points[k] as Point;
    const ux = q.x - p.x;
    const uy = q.y - p.y;
    const uz = (height[j] as number) - (height[i] as number);
    const vx = r.x - p.x;
    const vy = r.y - p.y;
    const vz = (height[k] as number) - (height[i] as number);
    // Unnormalised, so a face weights by its own area — a sliver cannot outvote the mesh.
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const at of [i, j, k]) {
      vn[at * 3] = (vn[at * 3] as number) + nx;
      vn[at * 3 + 1] = (vn[at * 3 + 1] as number) + ny;
      vn[at * 3 + 2] = (vn[at * 3 + 2] as number) + nz;
    }
  }

  return vn;
}

/**
 * A letter's flat lid refined where it misses the profile, then displaced into a crown.
 *
 * Refining the extruder's own lid rather than meshing the field afresh, because **the crown has to
 * end where the lid ends**. A heightfield drops any cell the boundary crosses, so its crown stops
 * short of the lid — 0.0029 em on a 384 grid — and the bevel shows through the gap all the way
 * round. Inheriting the lid's own edge measures exactly zero. Stacked iso-contours have the edge
 * but terrace: every band is flat, and twenty of them read as a contour map rather than a cushion.
 *
 * The field is built from the **lid's** rings, not the glyph's outline. The lid is the outline
 * inset by the bevel, so measuring from the outline lifts the crown's rim off the bevel it is
 * supposed to meet — a step all the way around the letter.
 */
export function inflate(
  geo: THREE.BufferGeometry,
  top: number,
  opts: InflateOptions = DEFAULT_INFLATE,
): Inflated {
  const { lid: lidTris, rest, restNormal } = splitLid(geo, top);
  const flat = (): Inflated => ({
    geometry: geo,
    converged: true,
    before: lidTris.length,
    after: lidTris.length,
  });
  if (lidTris.length === 0) return flat();

  const { points, faces: coarse } = weld(lidTris);
  const crown = crownOf(
    boundaryRings(coarse).map((ring) => ring.map((id) => points[id] as Point)),
    opts,
  );
  if (!crown) return flat();
  const z = (p: Point) => top + crown(p.x, p.y);

  // The rim is left open: the lid's boundary meets the bevel on a plane where the crown is flat, so
  // a vertex the wall does not share is collinear and invisible. A shell freezes it instead.
  const { faces, converged } = refineCap(points, coarse, z, opts.tolerance);
  const height = points.map(z);
  const vn = capNormals(points, faces, height);

  // Back to a soup, because the rest of the body is one and the two are concatenated. The walls
  // keep the normals the extruder gave them: recomputing those welds the bevel's own crease into a
  // smooth ramp, and the bevel highlight is what every look reads by.
  const position = [...rest];
  const normal = [...restNormal];
  for (const face of faces) {
    for (const id of face) {
      const p = points[id] as Point;
      position.push(p.x, p.y, height[id] as number);
      const nx = vn[id * 3] as number;
      const ny = vn[id * 3 + 1] as number;
      const nz = vn[id * 3 + 2] as number;
      const len = Math.hypot(nx, ny, nz) || 1;
      normal.push(nx / len, ny / len, nz / len);
    }
  }
  const built = new THREE.BufferGeometry();
  built.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  built.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  built.computeBoundingBox();
  return { geometry: built, converged, before: lidTris.length, after: faces.length };
}
