import type { Font } from 'opentype.js';
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

  for (const hole of drawn) {
    if (Math.sign(hole.area) === outward) continue;
    const container = outlines
      .filter((o) => containsPoint(o.polygon, hole.anchor))
      .reduce<(typeof outlines)[number] | undefined>(
        (best, o) => (best && Math.abs(best.area) <= Math.abs(o.area) ? best : o),
        undefined,
      );
    // A hole no outline contains is a contour the glyph draws backwards on its own; keeping it
    // as a shape shows something rather than dropping it silently.
    if (container) container.contour.holes.push(hole.contour);
    else outlines.push(hole);
  }
  return outlines.map((o) => o.contour);
}

export function glyphToShapes(font: Font, char: string, size: number): THREE.Shape[] {
  return nest(contoursOf(font, char, size));
}

export function buildGlyphGeometry(
  font: Font,
  char: string,
  size: number,
  opts: GlyphOptions,
): THREE.ExtrudeGeometry {
  const shapes = glyphToShapes(font, char, size);
  const geo = new THREE.ExtrudeGeometry(shapes, {
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
