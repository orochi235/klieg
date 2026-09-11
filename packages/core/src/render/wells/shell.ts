import * as THREE from 'three';
import { chamfered, DEFAULT_GLYPH_OPTIONS } from '../../text/glyphs.js';
import {
  type Crown,
  capNormals,
  crownOf,
  DEFAULT_INFLATE,
  type InflateOptions,
  refineCap,
  weld,
} from '../inflate.js';
import { type Field, isoContours, signedDistanceField } from '../tube/field.js';
import type { Cut } from './cutters.js';
import {
  area,
  fromPoints,
  type Nested,
  nest,
  orient,
  type Point,
  type Ring,
  resample,
  shrink,
  signedArea,
  smooth,
  toPoints,
} from './rings.js';

/** Grid cells per side for the letter's own field, and the room left around its silhouette. */
const RESOLUTION = 512;
const PAD = 0.05;

/** How coarsely a level's outline is walked, in em. Below the field's own cell it is all staircase. */
const SPACING = 0.006;

/** How finely a glyph contour is sampled into the polygon the field rasterises. */
const SEGMENTS = 48;

export interface ShellOptions {
  /** The letter's full depth, slab plus plate. */
  depth: number;
  /** How far in from every contour a well stays, in em. Caps the back chamfer. */
  bezel: number;
  /** The bead around a well's rim, in em. Separate from the letter's own chamfer, which is why. */
  rimBevel: number;
  /** How far a rim's bead falls as it narrows, in em. */
  rimDrop: number;
  /** Bevel segments on both the letter's chamfer and every rim bead. */
  segments: number;
  /** Radius the reflex corners are rounded to — junctions between strokes, inside a counter. */
  round: number;
  /** Radius the convex corners are rounded to — outer corners, tips, a leg's point. */
  roundOuter: number;
  /**
   * Faces meeting at less than this many degrees share an averaged normal. 0 leaves the shell flat,
   * which is what it has always been. See `creaseSmooth`.
   */
  crease: number;
  /**
   * The shape of the solid itself: how far the letter's front face stands proud of the flat cap,
   * as a profile over its own distance field. Absent is flat, which is what every shell was.
   */
  inflate?: Partial<InflateOptions>;
}

export const DEFAULT_SHELL: Omit<ShellOptions, 'depth' | 'bezel'> = {
  rimBevel: 0.008,
  rimDrop: 0.008,
  segments: 3,
  round: 0,
  roundOuter: 0,
  crease: 0,
};

/**
 * One step of a bevel: how far the ring stands out from the plane's own outline, and how far it
 * sits from that plane. Both profiles below are the same quarter ellipse `ExtrudeGeometry` walks,
 * run in opposite directions, because a chamfer opens away from its cap and a bead opens toward it.
 */
interface Step {
  out: number;
  dz: number;
}

/** The letter's own edge: flush with the cap at `k = 0`, standing `size` proud at the wall. */
const chamferSteps = (size: number, thick: number, segs: number): Step[] =>
  Array.from({ length: segs + 1 }, (_, k) => {
    const t = k / segs;
    return {
      out: size * Math.sin((t * Math.PI) / 2),
      dz: thick * (1 - Math.cos((t * Math.PI) / 2)),
    };
  });

/** A well's rim: `size` wider than the pocket at the face, back to the pocket `thick` below it. */
const beadSteps = (size: number, thick: number, segs: number): Step[] =>
  Array.from({ length: segs + 1 }, (_, k) => {
    const t = k / segs;
    return { out: size * Math.cos((t * Math.PI) / 2), dz: thick * Math.sin((t * Math.PI) / 2) };
  });

const clean = (ring: Ring): Ring => smooth(resample(ring, SPACING), 3);

/** The glyph's rings as one field. */
function fieldOf(rings: Ring[]): Field {
  return signedDistanceField(rings.map(toPoints), { resolution: RESOLUTION, pad: PAD });
}

/**
 * The metal at one iso level, as regions — negative erodes it, positive grows it.
 *
 * Rings smaller than a few of the field's own cells are dropped. Where a gap between two strokes
 * pinches shut at the level being read, marching squares answers with a loop of no area — an `M`
 * grown by its own chamfer comes back as three rings of which two are zero, and a `4` as
 * twenty-three of which twenty-one are. They are not features of the letter, they are the level
 * passing exactly through a pinch, and left in they make every band above disagree on ring count.
 */
function metalAt(field: Field, level: number): Nested[] {
  const floor = 4 * field.emPerCell * field.emPerCell;
  const rings = isoContours(field, level)
    .map((r) => clean(fromPoints(r)))
    .filter((r) => r.length >= 3 && area(r) > floor);
  return nest(rings).map((poly) => ({
    outer: orient(poly[0] as Ring, true),
    holes: poly.slice(1).map((h) => orient(h, false)),
  }));
}

const flatten = (regions: Nested[]): Ring[] => regions.flatMap((g) => [g.outer, ...g.holes]);

/**
 * A radius rolled along the outline, which rounds a corner without having to find one. Growing the
 * metal and shrinking it back fills every reflex corner to the radius and leaves the convex ones;
 * the other order rounds the convex ones instead.
 *
 * It cannot be done by shifting one field's levels. The distance field of a grown shape equals the
 * original minus the radius only on the outside, and the inside is exactly where a filled corner
 * changes which edge is nearest — so each half rebuilds the field, and the radius is a real one.
 */
function roll(rings: Ring[], r: number, outward: boolean): Ring[] {
  const grown = flatten(metalAt(fieldOf(rings), outward ? r : -r));
  return flatten(metalAt(fieldOf(grown), outward ? -r : r));
}

/** Every directed edge walked once in each direction, which is the only check a render cannot make. */
export function openEdges(position: Float32Array): number {
  // Quantised, not printed. Two vertices meant to coincide can differ by float noise — the plane
  // where the back chamfer meets the wall lands on -1e-18 from one side and 0 from the other,
  // because `1 - Math.cos(PI / 2)` is not 1 — and `toFixed` keeps that sign, so every edge across
  // the plane hashes two ways and reads as open. A micro-em is far below anything geometric here.
  const fix = (v: number) => Math.round(v * 1e6);
  const key = (i: number) =>
    `${fix(position[i] as number)},${fix(position[i + 1] as number)},${fix(position[i + 2] as number)}`;
  const seen = new Map<string, number>();
  for (let i = 0; i < position.length; i += 9) {
    const v = [key(i), key(i + 3), key(i + 6)];
    for (let e = 0; e < 3; e++) {
      const a = v[e] as string;
      const b = v[(e + 1) % 3] as string;
      if (a === b) continue;
      seen.set(`${a}|${b}`, (seen.get(`${a}|${b}`) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const [edge, n] of seen) {
    const [a, b] = edge.split('|');
    if (n === (seen.get(`${b}|${a}`) ?? 0)) continue;
    open++;
  }
  return open;
}

/**
 * Accumulates triangles; every face in the shell is pushed through one of the writers.
 *
 * A crown is applied here rather than at each writer, and that is the whole of what makes a carved
 * letter ride one: the displacement is zero at the letter's own contour and outside it, so both
 * chamfers, the straight wall and the back cap stand exactly where they did, while the front cap,
 * every pocket's bead, its wall and its floor lift by however far the metal above them did.
 */
class Skin {
  readonly pos: number[] = [];
  /** Where the crowned face starts in `pos`, and the normals it computed for itself. */
  crownAt = -1;
  readonly crownNormals: number[] = [];

  constructor(private readonly lift: Crown | null = null) {}

  tri(a: readonly number[], b: readonly number[], c: readonly number[]): void {
    for (const p of [a, b, c]) {
      const x = p[0] as number;
      const y = p[1] as number;
      this.pos.push(x, y, (p[2] as number) + (this.lift ? this.lift(x, y) : 0));
    }
  }

  /**
   * A quad strip between two rings that need not correspond. Both are walked by their own arc
   * length and whichever is behind advances, so the strip closes whatever the point counts are.
   *
   * That is what lets every ring come off the field. A miter keeps the point count and so cannot
   * survive being asked for more than a corner's own radius — past that the offset has to invert.
   * An iso-contour never folds; it just does not correspond, and this is the correspondence.
   */
  stitch(lower: Ring, zLo: number, upper: Ring, zHi: number): void {
    const na = lower.length;
    const nb = upper.length;
    if (na < 3 || nb < 3) return;
    const arc = (ring: Ring): number[] => {
      const t = [0];
      for (let i = 1; i <= ring.length; i++) {
        const p = ring[i - 1] as Point;
        const q = ring[i % ring.length] as Point;
        t.push((t[i - 1] as number) + Math.hypot(q[0] - p[0], q[1] - p[1]));
      }
      const total = (t[t.length - 1] as number) || 1;
      return t.map((v) => v / total);
    };
    // Two iso levels start wherever marching squares happened to start them; without this the
    // strip is built with a twist in it and every quad crosses the letter.
    let off = 0;
    let best = Number.POSITIVE_INFINITY;
    const head = lower[0] as Point;
    for (let k = 0; k < nb; k++) {
      const u = upper[k] as Point;
      const d = Math.hypot(u[0] - head[0], u[1] - head[1]);
      if (d < best) {
        best = d;
        off = k;
      }
    }
    const b = upper.slice(off).concat(upper.slice(0, off));
    const A = (i: number) => {
      const p = lower[i % na] as Point;
      return [p[0], p[1], zLo];
    };
    const B = (j: number) => {
      const p = b[j % nb] as Point;
      return [p[0], p[1], zHi];
    };

    /**
     * Where each vertex of `lower` meets `upper`: the nearest point on it, taken with a pointer
     * that only ever moves forward, so the map is monotone and every edge of both rings is still
     * walked exactly once.
     *
     * Arc length is what this used to be, and it is a *global* fraction — each ring divided by its
     * own perimeter. Two iso levels of the same field do not lose length evenly: a corner closes
     * up while the straight runs beside it barely move, so the two parameters drift apart and the
     * quads skew along the band instead of spanning it. That is the stretch marks down a curved
     * edge, and the fan where a corner has closed. Nearest-point cannot drift, because it is not
     * measured along the ring at all.
     */
    const map = new Int32Array(na + 1);
    const d2 = (i: number, j: number): number => {
      const p = lower[i % na] as Point;
      const q = b[j % nb] as Point;
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      return dx * dx + dy * dy;
    };
    // Argmin over a forward window rather than "advance while the next one is closer". One-step
    // lookahead stalls for good the moment distance ticks up before it comes down — and a pointer
    // that never moves fans a whole ring off one vertex, which collapses the strip into the plane.
    const window = Math.max(8, Math.ceil((2 * nb) / na) + 4);
    let j = 0;
    for (let i = 0; i < na; i++) {
      let best = d2(i, j);
      let at = j;
      const limit = Math.min(j + window, nb);
      for (let k = j + 1; k <= limit; k++) {
        const d = d2(i, k);
        if (d < best) {
          best = d;
          at = k;
        }
      }
      j = at;
      map[i] = j;
    }
    // The last vertex is the first one come round again, and it has to land on `nb` however the
    // search left the pointer — otherwise the wedge of `upper` past it is never walked and the
    // strip is open along its own seam.
    map[na] = nb;

    for (let i = 0; i < na; i++) {
      const from = map[i] as number;
      const to = map[i + 1] as number;
      this.tri(A(i), A(i + 1), B(from));
      for (let k = from; k < to; k++) this.tri(A(i + 1), B(k + 1), B(k));
    }
  }

  /** A flat face, on one plane. */
  cap(contour: Ring, holes: Ring[], z: number, up: boolean): void {
    for (const tri of capFaces(contour, holes, up)) {
      const [a, b, c] = tri as [Point3, Point3, Point3];
      this.tri([a.x, a.y, z], [b.x, b.y, z], [c.x, c.y, z]);
    }
  }

  /** A flat face from every ring that lands on its plane, nested by containment. */
  capPlane(rings: Ring[], z: number, up: boolean): void {
    for (const group of nest(rings)) this.cap(group[0] as Ring, group.slice(1), z, up);
  }

  /**
   * The front face, refined where a triangle's chord falls off the crown and displaced onto it,
   * with its own averaged normals — a crown made of visible triangles is not a crown.
   *
   * The boundary is frozen: every edge of this face no second triangle walks is shared with the
   * band stitched to the same ring, and a vertex introduced on one is a vertex that band has no
   * answer for, which is an open shell. The rings arrive resampled at 0.006 em against a reach
   * measured in tenths, so what refinement is withheld along them is already inside tolerance —
   * measured on an `R`, freezing costs 0.0004 em of chord against a 0.002 em budget and spends a
   * quarter fewer triangles than letting the boundary move and re-stitching the bands to it.
   */
  crownFace(rings: Ring[], z: number, lift: Crown, tolerance: number): void {
    const tris: [Point3, Point3, Point3][] = [];
    for (const group of nest(rings)) {
      tris.push(...capFaces(group[0] as Ring, group.slice(1), true));
    }
    const { points, faces: coarse } = weld(tris);
    const { faces } = refineCap(points, coarse, (p) => lift(p.x, p.y), tolerance, true);
    const height = points.map((p) => lift(p.x, p.y));
    const vn = capNormals(points, faces, height);
    this.crownAt = this.pos.length;
    for (const face of faces) {
      for (const id of face) {
        const p = points[id] as Point3;
        this.pos.push(p.x, p.y, z + (height[id] as number));
        const nx = vn[id * 3] as number;
        const ny = vn[id * 3 + 1] as number;
        const nz = vn[id * 3 + 2] as number;
        const len = Math.hypot(nx, ny, nz) || 1;
        this.crownNormals.push(nx / len, ny / len, nz / len);
      }
    }
  }
}

/** A point the refinement can weld and displace; `Ring`'s own pairs carry no names. */
interface Point3 {
  x: number;
  y: number;
}

/**
 * A flat face, triangulated with holes and its facing asserted per triangle rather than inherited
 * from ring order: a lid facing into the solid is invisible and reads as a missing cap, which is a
 * long way to chase for a sign flip.
 */
function capFaces(contour: Ring, holes: Ring[], up: boolean): [Point3, Point3, Point3][] {
  const c = contour.map(([x, y]) => new THREE.Vector2(x, y));
  const hs = holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y)));
  const all = [c, ...hs].flat();
  const out: [Point3, Point3, Point3][] = [];
  for (const face of THREE.ShapeUtils.triangulateShape(c, hs)) {
    const a = all[face[0] as number] as THREE.Vector2;
    const b = all[face[1] as number] as THREE.Vector2;
    const d = all[face[2] as number] as THREE.Vector2;
    const ccw = (b.x - a.x) * (d.y - a.y) - (d.x - a.x) * (b.y - a.y) > 0;
    out.push(ccw === up ? [a, b, d] : [d, b, a]);
  }
  return out;
}

/**
 * What a band between two levels is made of: the rings that answer each other, and the rings that
 * do not. A ring with no answer is where a gap between two strokes closes over — the level passed
 * through the pinch — and it is closed with a lid rather than stitched to something it is not.
 */
export interface Bands {
  pairs: [Ring, Ring][];
  loneLower: Ring[];
  loneUpper: Ring[];
}

/**
 * Which ring of one level answers which of the next.
 *
 * Two iso levels of the same letter run parallel, so a ring is answered by the one nearest it that
 * is also about the same size and going the same way round — a hole and an outline wind opposite
 * ways and can never be each other. Centroid alone is not enough, and an O is why: its outline and
 * its counter share a centre, so whichever came out marginally closer won and the outline of one
 * level was stitched to the counter of the next, which is a sheet of quads across the counter.
 * Cheapest pair first, so one ring's near miss cannot push every ring after it onto the wrong one.
 */
export function pair(a: Ring[], b: Ring[]): Bands {
  const of = (ring: Ring) => {
    let x = 0;
    let y = 0;
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const p = ring[i] as Point;
      const q = ring[j] as Point;
      x += p[0];
      y += p[1];
      area += q[0] * p[1] - p[0] * q[1];
    }
    return { x: x / ring.length, y: y / ring.length, area: area / 2 };
  };
  const ma = a.map(of);
  const mb = b.map(of);
  /** As a radius, so it is in em and adds to a distance rather than dwarfing it. */
  const radius = (m: { area: number }) => Math.sqrt(Math.abs(m.area) / Math.PI);
  const costs: [number, number, number][] = [];
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      const mi = ma[i] as { x: number; y: number; area: number };
      const mj = mb[j] as { x: number; y: number; area: number };
      const turn = Math.sign(mi.area) !== Math.sign(mj.area) ? 1e3 : 0;
      const gap = Math.hypot(mi.x - mj.x, mi.y - mj.y);
      costs.push([gap + Math.abs(radius(mi) - radius(mj)) + turn, i, j]);
    }
  }
  costs.sort((p, q) => p[0] - q[0]);
  const from = new Set<number>();
  const to = new Set<number>();
  const pairs: [Ring, Ring][] = [];
  for (const [cost, i, j] of costs) {
    if (from.has(i) || to.has(j) || cost >= 1e3) continue;
    from.add(i);
    to.add(j);
    pairs.push([a[i] as Ring, b[j] as Ring]);
  }
  return {
    pairs,
    loneLower: a.filter((_, i) => !from.has(i)),
    loneUpper: b.filter((_, j) => !to.has(j)),
  };
}

/**
 * A lid over each ring the band could not answer, at the level the ring itself sits on.
 *
 * Which way it faces follows from what the ring is and which side it was left on. A ring wound
 * metal-inside is a piece of the letter, so one that runs out going up is the top of an island and
 * faces up; one that only appears above is an island's underside and faces down. A ring wound
 * metal-outside is a void, and both readings invert: a gap that closes over is a ceiling, a gap
 * that opens is a floor.
 *
 * This is where a stroke closing up between two levels lands, and it is the honest surface rather
 * than a guess — the alternative is stitching a ring to one it is not, which is a sheet of quads
 * across the letter. What it approximates is the pinch itself: a gap that closes to a line gets a
 * flat lid a few thousandths of an em across instead of coming to a true edge. Seven of thirty-six
 * glyphs in the lab's own font need it, `G`, `S` and four digits among them.
 */
function capLone(skin: Skin, band: Bands, zLo: number, zHi: number): void {
  for (const ring of band.loneLower) skin.cap(ring, [], zLo, signedArea(ring) > 0);
  for (const ring of band.loneUpper) skin.cap(ring, [], zHi, signedArea(ring) <= 0);
}

/**
 * The two planes a fill has to sit between, and where the shell puts its own faces.
 *
 * The names are the plate's, and the front face and floor are exactly where the extruded plate had
 * them, so a fill written against `platePlanes` still lands. What differs is between them: the
 * plate's own wells were bevelled at the letter's chamfer, which folds a small hole through itself.
 */
export function shellPlanes(depth: number, floor: number, bezel: number) {
  const full = DEFAULT_GLYPH_OPTIONS.bevelSize;
  const slabDepth = Math.max(depth - floor, 0);
  const slabBevel = Math.min(full, bezel);
  const slabBevelZ = (DEFAULT_GLYPH_OPTIONS.bevelThickness * slabBevel) / full;
  return {
    slabDepth,
    slabBevel,
    slabBevelZ,
    backZ: -slabBevelZ,
    floorZ: slabDepth + slabBevelZ,
    faceZ: depth + DEFAULT_GLYPH_OPTIONS.bevelThickness,
  };
}

/**
 * A carved letter, and the crown its front side was displaced onto — `null` where the look asked
 * for none. Whatever is set into that side has to ride the same one, so the shell hands it back
 * rather than leaving a fill to rebuild it off a field of its own and disagree in the third
 * decimal place.
 */
export interface Shell {
  geometry: THREE.BufferGeometry;
  crown: Crown | null;
}

/**
 * A letter carved with wells, stitched ring by ring rather than extruded.
 *
 * Every ring in the outer skin is an iso-contour of the letter's own distance field at the level
 * that ring sits at, so nothing is offset and nothing can fold. The wells come from the cutter,
 * because only it knows where they are; their rim beads come from the cutter too when it can
 * re-derive them, and are shrunk here when it cannot.
 */
/**
 * Average the normals of faces meeting at a vertex where they meet at less than `crease` degrees.
 *
 * The shell is one soup, so `computeVertexNormals` gives every triangle its own constant normal.
 * On the broad quads of a bevel that is what the look reads by; on a band of slivers — where a
 * chamfer's inner ring has lost length that its outer ring still has — it is a stripe per triangle,
 * which reads as stretch marks down a curved edge. An angle limit keeps both: the crease between
 * face and bevel is far past any sane threshold and stays hard, while a bevel's own steps average.
 *
 * Positions are untouched and the buffer stays non-indexed, so nothing downstream sees a change.
 * Vertices at or past `crownFrom` keep the normals the crown fitted for them.
 */
function creaseSmooth(geo: THREE.BufferGeometry, crease: number, crownFrom: number): void {
  const position = (geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
  const normal = (geo.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array;
  const faces = position.length / 9;
  const faceN = new Float32Array(faces * 3);
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let f = 0; f < faces; f++) {
    const t = f * 9;
    ab.set(
      (position[t + 3] as number) - (position[t] as number),
      (position[t + 4] as number) - (position[t + 1] as number),
      (position[t + 5] as number) - (position[t + 2] as number),
    );
    ac.set(
      (position[t + 6] as number) - (position[t] as number),
      (position[t + 7] as number) - (position[t + 1] as number),
      (position[t + 8] as number) - (position[t + 2] as number),
    );
    n.crossVectors(ab, ac).normalize();
    faceN.set([n.x, n.y, n.z], f * 3);
  }

  // A grid quantised well below the ring spacing: two rings that meet along an edge were built
  // from the same points, so they land in the same bucket without a tolerance search.
  const GRID = 1e5;
  const at = new Map<string, number[]>();
  const vertices = position.length / 3;
  for (let v = 0; v < vertices; v++) {
    const k = `${Math.round((position[v * 3] as number) * GRID)},${Math.round((position[v * 3 + 1] as number) * GRID)},${Math.round((position[v * 3 + 2] as number) * GRID)}`;
    const list = at.get(k);
    if (list) list.push(v);
    else at.set(k, [v]);
  }

  const limit = Math.cos((crease * Math.PI) / 180);
  const sum = new THREE.Vector3();
  const own = new THREE.Vector3();
  for (const group of at.values()) {
    for (const v of group) {
      // The crown fitted its own; leaving them is what keeps a domed face from picking up the
      // chamfer it meets.
      if (crownFrom >= 0 && v * 3 >= crownFrom) continue;
      const f = Math.floor(v / 3) * 3;
      own.set(faceN[f] as number, faceN[f + 1] as number, faceN[f + 2] as number);
      sum.set(0, 0, 0);
      for (const w of group) {
        if (crownFrom >= 0 && w * 3 >= crownFrom) continue;
        const g = Math.floor(w / 3) * 3;
        n.set(faceN[g] as number, faceN[g + 1] as number, faceN[g + 2] as number);
        if (n.dot(own) >= limit) sum.add(n);
      }
      if (sum.lengthSq() === 0) sum.copy(own);
      sum.normalize();
      normal.set([sum.x, sum.y, sum.z], v * 3);
    }
  }
  (geo.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true;
}

export function buildShell(shapes: readonly THREE.Shape[], cut: Cut, opts: ShellOptions): Shell {
  const full = DEFAULT_GLYPH_OPTIONS.bevelSize;
  const planes = shellPlanes(opts.depth, cut.floor, opts.bezel);

  let rings: Ring[] = [];
  for (const shape of chamfered(shapes as THREE.Shape[], DEFAULT_GLYPH_OPTIONS)) {
    rings.push(orient(fromPoints(shape.getPoints(SEGMENTS)), true));
    for (const hole of shape.holes) {
      rings.push(orient(fromPoints(hole.getPoints(SEGMENTS)), false));
    }
  }
  if (opts.round > 0) rings = roll(rings, opts.round, true);
  if (opts.roundOuter > 0) rings = roll(rings, opts.roundOuter, false);
  const field = fieldOf(rings);

  // The straight wall is the glyph grown by the letter's own chamfer, and each cap is the glyph
  // itself — which is the silhouette `ExtrudeGeometry` produces, without the doubled band that
  // stacking a bevelled slab and a bevelled plate put down the letter's side.
  const front = chamferSteps(full, DEFAULT_GLYPH_OPTIONS.bevelThickness, opts.segments);
  const back = chamferSteps(planes.slabBevel, planes.slabBevelZ, opts.segments);
  const skinAt = (out: number) => flatten(metalAt(field, out));

  const frontRings = front.map((s) => skinAt(s.out));
  // Measured from the face's own ring, so the crown is zero exactly where the chamfer takes over.
  const puff = opts.inflate ? { ...DEFAULT_INFLATE, ...opts.inflate } : null;
  const lift = puff
    ? crownOf(
        (frontRings[0] as Ring[]).map((ring) => ring.map(([x, y]) => ({ x, y }))),
        puff,
      )
    : null;
  const skin = new Skin(lift);
  const backRings = back.map((s) => skinAt(full - planes.slabBevel + s.out));
  const wallLo = planes.backZ + planes.slabBevelZ;
  const wallHi = planes.faceZ - (front[front.length - 1] as Step).dz;

  const run = (levels: Ring[][], zAt: (k: number) => number) => {
    for (let k = 0; k < levels.length - 1; k++) {
      const band = pair(levels[k] as Ring[], levels[k + 1] as Ring[]);
      for (const [lo, hi] of band.pairs) skin.stitch(lo, zAt(k), hi, zAt(k + 1));
      capLone(skin, band, zAt(k), zAt(k + 1));
    }
  };

  // Back cap, up its chamfer, straight to the front chamfer, and in to the front face.
  run(backRings, (k) => planes.backZ + (back[k] as Step).dz);
  const wall = backRings[backRings.length - 1] as Ring[];
  const top = frontRings[frontRings.length - 1] as Ring[];
  const straight = pair(wall, top);
  for (const [lo, hi] of straight.pairs) skin.stitch(lo, wallLo, hi, wallHi);
  capLone(skin, straight, wallLo, wallHi);
  run([...frontRings].reverse(), (k) => planes.faceZ - (front[front.length - 1 - k] as Step).dz);

  // The wells: the rim bead narrowing away from the face, then a straight wall down to the floor.
  const bead = beadSteps(opts.rimBevel, opts.rimDrop, opts.segments);
  const beads = pocketBeads(cut, bead);
  const rim = beads.map((steps) => steps[0] as Ring);
  const seat = beads.map((steps) => steps[steps.length - 1] as Ring);
  for (const steps of beads) {
    for (let k = 0; k < steps.length - 1; k++) {
      skin.stitch(
        steps[k + 1] as Ring,
        planes.faceZ - (bead[k + 1] as Step).dz,
        steps[k] as Ring,
        planes.faceZ - (bead[k] as Step).dz,
      );
    }
  }
  const seatZ = planes.faceZ - (bead[bead.length - 1] as Step).dz;
  for (const ring of seat) skin.stitch(ring, planes.floorZ, ring, seatZ);

  skin.capPlane(backRings[0] as Ring[], planes.backZ, false);
  const face = [...(frontRings[0] as Ring[]), ...rim];
  if (lift && puff) skin.crownFace(face, planes.faceZ, lift, puff.tolerance);
  else skin.capPlane(face, planes.faceZ, true);
  skin.capPlane(seat, planes.floorZ, true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(skin.pos), 3));
  geo.computeVertexNormals();
  if (opts.crease > 0) creaseSmooth(geo, opts.crease, skin.crownAt);
  // The crown's own, over the range it wrote. `computeVertexNormals` on a soup gives every face one
  // constant normal, and the rest of the shell wants exactly that — the bevel highlight is what
  // every look reads by, and welding its crease smooth is what takes it away.
  if (skin.crownAt >= 0) {
    const normal = geo.getAttribute('normal') as THREE.BufferAttribute;
    const into = normal.array as Float32Array;
    into.set(skin.crownNormals, skin.crownAt);
    normal.needsUpdate = true;
  }
  geo.computeBoundingBox();
  return { geometry: geo, crown: lift };
}

/**
 * Each well as the rings its bead steps through, widest at the face and the well's own outline at
 * the floor. The cutter supplies these when it can re-derive its pockets; a convex pocket is shrunk
 * here instead, which is exact for one and wrong for a clipped cell.
 */
function pocketBeads(cut: Cut, bead: Step[]): Ring[][] {
  const ring = (path: THREE.Path) => orient(fromPoints(path.getPoints(SEGMENTS)), false);
  if (cut.bead) return cut.bead(bead.map((step) => step.out)).map((rings) => rings.map(ring));
  const out: Ring[][] = [];
  for (const well of cut.wells) {
    // Shrunk while wound metal-inside, because `shrink` reads its normals off the winding; a
    // negative distance then grows the pocket, which is what a bead does toward the face.
    const base = orient(fromPoints(well.getPoints(SEGMENTS)), true);
    const rings = bead
      .map((step) => shrink(base, -step.out))
      .filter((r) => r.length >= 3)
      .map((r) => orient(r, false));
    if (rings.length === bead.length) out.push(rings);
  }
  return out;
}
