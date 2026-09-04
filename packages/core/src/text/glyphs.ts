import type { Font } from 'opentype.js';
import type { Polygon, Ring } from 'polygon-clipping';
// The ESM build's only export is the default; the shipped `.d.ts` declares named exports and no
// default. A namespace or named import type-checks and then resolves to nothing under a bundler.
import polygonClipping from 'polygon-clipping';
import * as THREE from 'three';

/** Glyphs are built at 1 em; the group scale does the fitting. */
export const EM = 1;

export interface GlyphOptions {
  depth: number;
  bevelThickness: number;
  bevelSize: number;
  bevelSegments: number;
  curveSegments: number;
}

export const DEFAULT_GLYPH_OPTIONS: GlyphOptions = {
  depth: 0.3,
  bevelThickness: 0.055,
  bevelSize: 0.038,
  bevelSegments: 5,
  curveSegments: 10,
};

type Buildable = { dispose(): void };

/**
 * Letters repeat heavily, so geometry is built once per (char, depth) and shared. Hold one cache
 * per (font, size, options) — the key discriminates what `build` varies, not what it captures.
 */
export class GlyphCache<T extends Buildable = THREE.ExtrudeGeometry> {
  private cache = new Map<string, T>();
  private disposed = false;

  constructor(private readonly build: (char: string, depth: number) => T) {}

  get size(): number {
    return this.cache.size;
  }

  get(char: string, depth: number): T {
    if (this.disposed) throw new Error('klieg: GlyphCache used after dispose');
    const key = `${char}|${depth}`;
    let g = this.cache.get(key);
    if (!g) {
      g = this.build(char, depth);
      this.cache.set(key, g);
    }
    return g;
  }

  dispose(): void {
    for (const g of this.cache.values()) g.dispose();
    this.cache.clear();
    this.disposed = true;
  }
}

const NESTING_SEGMENTS = 12;

/** opentype.js emits y-down path commands; three is y-up, so every y is negated. */
function contoursOf(font: Font, char: string, size: number): THREE.Shape[] {
  const path = font.charToGlyph(char).getPath(0, 0, size);
  const contours: THREE.Shape[] = [];
  let current: THREE.Shape | null = null;

  for (const cmd of path.commands) {
    switch (cmd.type) {
      case 'M':
        current = new THREE.Shape();
        current.moveTo(cmd.x, -cmd.y);
        contours.push(current);
        break;
      case 'L':
        current?.lineTo(cmd.x, -cmd.y);
        break;
      case 'Q':
        current?.quadraticCurveTo(cmd.x1, -cmd.y1, cmd.x, -cmd.y);
        break;
      case 'C':
        current?.bezierCurveTo(cmd.x1, -cmd.y1, cmd.x2, -cmd.y2, cmd.x, -cmd.y);
        break;
      case 'Z':
        // three closes a contour by reading its first curve; one that never drew throws.
        if (current?.curves.length) current.closePath();
        break;
    }
  }
  return contours;
}

function containsPoint(polygon: THREE.Vector2[], point: THREE.Vector2): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i] as THREE.Vector2;
    const b = polygon[j] as THREE.Vector2;
    const straddles = a.y > point.y !== b.y > point.y;
    if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

function signedArea(polygon: THREE.Vector2[]): number {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i] as THREE.Vector2;
    const b = polygon[j] as THREE.Vector2;
    sum += b.x * a.y - a.x * b.y;
  }
  return sum / 2;
}

/**
 * Which contours are holes, by winding rather than by nesting depth.
 *
 * A glyph fills under the non-zero rule, and a counter is marked by running the opposite way
 * round from its outline. Depth cannot stand in for that: a serif face draws a letter as
 * overlapping strokes wound the same way — Cinzel's `A` is five, two diagonals, a crossbar and
 * two feet, with no counter contour at all, its triangle being the gap the strokes leave. Reading
 * containment there demotes the crossbar to a hole in a diagonal and punches the letter open.
 *
 * The reference sign comes from the largest contour rather than the specification, so a font that
 * winds the other way round throughout still reads correctly. Order is never consulted: a font
 * may list a counter after an unrelated contour (Skia's `%` ends with two belonging to earlier
 * ones), so each hole goes to the smallest outline that contains it.
 */
function nest(contours: THREE.Shape[]): THREE.Shape[] {
  const drawn = contours
    .map((contour) => ({ contour, polygon: contour.getPoints(NESTING_SEGMENTS) }))
    .filter((c) => c.polygon.length >= 3)
    .map((c) => ({ ...c, area: signedArea(c.polygon), anchor: c.polygon[0] as THREE.Vector2 }));
  if (drawn.length === 0) return [];

  const largest = drawn.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a));
  const outward = Math.sign(largest.area);
  const outlines = drawn.filter((c) => Math.sign(c.area) === outward);
  // A hole no outline contains is a contour the glyph draws backwards on its own; keeping it as
  // a shape shows something rather than dropping it silently. Collected rather than appended to
  // `outlines`, which is the candidate list — one of these must not become another's container,
  // because then two of them would nest by file order, the thing winding is here to replace.
  const orphans: typeof drawn = [];

  for (const hole of drawn) {
    if (Math.sign(hole.area) === outward) continue;
    const container = outlines
      .filter((o) => containsPoint(o.polygon, hole.anchor))
      .reduce<(typeof outlines)[number] | undefined>(
        (best, o) => (best && Math.abs(best.area) <= Math.abs(o.area) ? best : o),
        undefined,
      );
    if (container) container.contour.holes.push(hole.contour);
    else orphans.push(hole);
  }
  return [...outlines, ...orphans].map((o) => o.contour);
}

/**
 * How far a chord may sit from the curve it replaces, in em.
 *
 * The union answers in points, so this is the whole fidelity budget for a glyph that goes through
 * it. At a 200px cap height 1e-4 em is 0.028px, and a quarter of that at the largest size klieg
 * has been shot at — small enough that the sampling is not what anyone sees. Sampling to a fixed
 * count instead spends the same points on a serif bracket as on a bowl: 16,311 across Cinzel's
 * capitals at 24 a curve, against 5,552 for this.
 */
const FLATNESS = 1e-4;

/** Subdivide until each chord sits within `flatness` of the curve. A straight edge stops at once. */
function flatten(curve: THREE.Curve<THREE.Vector2>, flatness: number): THREE.Vector2[] {
  const start = curve.getPoint(0);
  const points: THREE.Vector2[] = [start];
  const walk = (t0: number, t1: number, p0: THREE.Vector2, p1: THREE.Vector2, depth: number) => {
    const middle = (t0 + t1) / 2;
    const pm = curve.getPoint(middle);
    const chord = p1.clone().sub(p0);
    const length = chord.length();
    const off =
      length === 0
        ? pm.distanceTo(p0)
        : Math.abs((pm.x - p0.x) * chord.y - (pm.y - p0.y) * chord.x) / length;
    // Ten levels is 1024 segments for one curve, which no glyph outline has ever needed.
    if (off <= flatness || depth >= 10) {
      points.push(p1);
      return;
    }
    walk(t0, middle, p0, pm, depth + 1);
    walk(middle, t1, pm, p1, depth + 1);
  };
  walk(0, 1, start, curve.getPoint(1), 0);
  return points;
}

function ringOf(path: THREE.Path, flatness: number): Ring {
  const ring: Ring = [];
  for (const curve of path.curves)
    for (const p of flatten(curve, flatness)) {
      const last = ring[ring.length - 1];
      if (!last || last[0] !== p.x || last[1] !== p.y) ring.push([p.x, p.y]);
    }
  const first = ring[0];
  if (first) ring.push([first[0], first[1]]);
  return ring;
}

function polygonOf(shape: THREE.Shape, flatness: number): Polygon {
  return [ringOf(shape, flatness), ...shape.holes.map((hole) => ringOf(hole, flatness))];
}

function shapeOf(polygon: Polygon): THREE.Shape {
  const [outline, ...holes] = polygon;
  const toPath = (ring: Ring) => ring.map(([x, y]) => new THREE.Vector2(x, y));
  const shape = new THREE.Shape(toPath(outline ?? []));
  shape.holes = holes.map((hole) => new THREE.Path(toPath(hole)));
  return shape;
}

function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as [number, number];
    const b = ring[j] as [number, number];
    sum += b[0] * a[1] - a[0] * b[1];
  }
  return Math.abs(sum / 2);
}

function filledArea(polygons: Polygon[]): number {
  return polygons.reduce(
    (total, [outline, ...holes]) =>
      total + ringArea(outline ?? []) - holes.reduce((h, hole) => h + ringArea(hole), 0),
    0,
  );
}

/** A shape of the same size and nesting, whatever order the clipper returned them in. */
function sameShapeSet(before: Polygon[], after: Polygon[]): boolean {
  const rings = (polygons: Polygon[]) =>
    polygons
      .map((p) => p.length)
      .sort((a, b) => a - b)
      .join(',');
  if (before.length !== after.length || rings(before) !== rings(after)) return false;
  const area = filledArea(before);
  return Math.abs(filledArea(after) - area) <= area * 1e-9;
}

/**
 * One outline per region of ink, rather than one per contour the font happened to draw.
 *
 * A glyph is commonly several strokes laid over each other and left overlapping — a fill under the
 * non-zero rule unions them for free, so nothing downstream of a rasteriser ever has to. klieg
 * extrudes each contour as its own solid, which puts two coplanar caps at the same depth wherever
 * two strokes cross: on Cinzel's `N`, 69 of 228 front-cap triangles are drawn twice. Cinzel's
 * capitals go from 143 contours to 32 through here.
 *
 * The union can only answer in polylines, so it costs the shapes their curves. Where it provably
 * changed nothing the originals are returned instead, which is every face here but Cinzel and rye.
 */
function unionOf(shapes: THREE.Shape[]): THREE.Shape[] {
  if (shapes.length < 2) return shapes;
  const polygons = shapes.map((shape) => polygonOf(shape, FLATNESS));
  const first = polygons[0];
  if (!first) return shapes;
  const merged = polygonClipping.union(first, ...polygons.slice(1));
  if (merged.length === 0 || sameShapeSet(polygons, merged)) return shapes;
  return merged.map(shapeOf);
}

export function glyphToShapes(font: Font, char: string, size: number): THREE.Shape[] {
  return unionOf(nest(contoursOf(font, char, size)));
}

/**
 * Corners tighter than this get cut back before the bevel runs, and how far back they are cut,
 * as a fraction of `bevelSize`.
 *
 * three offsets a bevel ring by mitering each corner and caps a runaway miter at sqrt(2) units
 * (`getBevelVec`, "prevent crazy spikes"). At a right angle sqrt(2) is the exact answer and the
 * ring stands one bevel proud on each axis; the sharper the corner the more of that length points
 * along the stroke instead, until it leaves a nub standing past the tip of the letter. A symmetric
 * cut replaces the corner with a short flat and two corners of `90 + angle/2`, which no miter can
 * run away from however sharp the original was — so the setback is free to be small.
 */
const CHAMFER_BELOW_DEGREES = 60;
const CHAMFER_SETBACK = 0.5;

/** The neighbour of `i` in `direction` that is not sitting on top of it. */
function distinctNeighbour(
  ring: THREE.Vector2[],
  i: number,
  direction: 1 | -1,
): THREE.Vector2 | null {
  for (let step = 1; step < ring.length; step++) {
    const q = ring[
      (((i + direction * step) % ring.length) + ring.length) % ring.length
    ] as THREE.Vector2;
    if (q.distanceToSquared(ring[i] as THREE.Vector2) > 1e-20) return q;
  }
  return null;
}

/** Vertices a ring actually turns at, which is what a font's zero-area slivers do not have. */
function cornerCount(ring: THREE.Vector2[]): number {
  let n = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as THREE.Vector2;
    const b = ring[(i + 1) % ring.length] as THREE.Vector2;
    if (a.distanceToSquared(b) > 1e-20) n++;
  }
  return n;
}

function chamferRing(ring: THREE.Vector2[], setback: number): THREE.Vector2[] {
  // A ring enclosing nothing has no corner to cut, and cutting one collapses it onto a point,
  // which is a triangulation crash rather than a bad-looking letter.
  if (cornerCount(ring) < 3) return ring;
  const limit = Math.cos((CHAMFER_BELOW_DEGREES * Math.PI) / 180);
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < ring.length; i++) {
    const c = ring[i] as THREE.Vector2;
    const p = distinctNeighbour(ring, i, -1);
    const n = distinctNeighbour(ring, i, 1);
    if (!p || !n) {
      out.push(c);
      continue;
    }
    const toPrev = p.clone().sub(c).normalize();
    const toNext = n.clone().sub(c).normalize();
    // Both run away from the corner, so their dot rises as the corner closes.
    if (toPrev.dot(toNext) < limit) {
      out.push(c);
      continue;
    }
    const back = Math.min(setback, p.distanceTo(c) / 2, n.distanceTo(c) / 2);
    out.push(c.clone().addScaledVector(toPrev, back), c.clone().addScaledVector(toNext, back));
  }
  return out;
}

/**
 * The glyph as `ExtrudeGeometry` will read it anyway — it samples every shape at `curveSegments`
 * and uses nothing else — with sharp corners cut. Sampling here first is what lets the cut be
 * expressed as points; a line curve re-samples to its own endpoints, so nothing else moves.
 */
export function chamfered(shapes: THREE.Shape[], opts: GlyphOptions): THREE.Shape[] {
  const setback = opts.bevelSize * CHAMFER_SETBACK;
  return shapes.map((source) => {
    const points = source.extractPoints(opts.curveSegments);
    const shape = new THREE.Shape(chamferRing(points.shape, setback));
    shape.holes = points.holes.map((hole) => new THREE.Path(chamferRing(hole, setback)));
    return shape;
  });
}

export function buildGlyphGeometry(
  font: Font,
  char: string,
  size: number,
  opts: GlyphOptions,
): THREE.ExtrudeGeometry {
  const shapes = glyphToShapes(font, char, size);
  const geo = new THREE.ExtrudeGeometry(chamfered(shapes, opts), {
    depth: opts.depth,
    bevelEnabled: true,
    bevelThickness: opts.bevelThickness,
    bevelSize: opts.bevelSize,
    bevelOffset: 0,
    bevelSegments: opts.bevelSegments,
    curveSegments: opts.curveSegments,
  });
  geo.computeBoundingBox();
  return geo;
}
