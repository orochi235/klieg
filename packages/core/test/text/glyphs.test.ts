import type { Font, PathCommand } from 'opentype.js';
import type * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  buildGlyphGeometry,
  DEFAULT_GLYPH_OPTIONS,
  GlyphCache,
  glyphToShapes,
} from '../../src/text/glyphs.js';

describe('GlyphCache', () => {
  it('builds a geometry once per distinct key', () => {
    const build = vi.fn((char: string) => ({ char, dispose: vi.fn() }));
    const cache = new GlyphCache(build);

    cache.get('A', 0.3);
    cache.get('A', 0.3);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('treats a different depth as a different geometry', () => {
    const build = vi.fn((char: string) => ({ char, dispose: vi.fn() }));
    const cache = new GlyphCache(build);

    cache.get('A', 0.3);
    cache.get('A', 0.5);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('reuses one geometry across repeated letters in a word', () => {
    const build = vi.fn((char: string) => ({ char, dispose: vi.fn() }));
    const cache = new GlyphCache(build);

    for (const ch of 'BONUS ROUND') cache.get(ch, 0.3);
    expect(build).toHaveBeenCalledTimes(new Set('BONUS ROUND').size);
  });

  it('disposes every cached geometry on dispose and empties itself', () => {
    const made: { dispose: ReturnType<typeof vi.fn> }[] = [];
    const cache = new GlyphCache((char: string) => {
      const g = { char, dispose: vi.fn() };
      made.push(g);
      return g;
    });

    cache.get('A', 0.3);
    cache.get('B', 0.3);
    cache.dispose();

    expect(made).toHaveLength(2);
    for (const g of made) expect(g.dispose).toHaveBeenCalled();
    expect(cache.size).toBe(0);
  });

  it('refuses to build after dispose instead of leaking an unowned geometry', () => {
    const build = vi.fn((char: string) => ({ char, dispose: vi.fn() }));
    const cache = new GlyphCache(build);

    cache.get('A', 0.3);
    cache.dispose();

    expect(() => cache.get('A', 0.3)).toThrow('klieg: GlyphCache used after dispose');
    expect(build).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0);
  });
});

/** A font whose only glyph draws the given commands, so contour nesting is exercised exactly. */
function fontDrawing(commands: PathCommand[]): Font {
  return { charToGlyph: () => ({ getPath: () => ({ commands }) }) } as unknown as Font;
}

/**
 * Shaped like what opentype 2.0 hands a fill path: the ring walks back to its start and no `Z`
 * follows, because `Glyph.getPath` forwards `Z` only when the path is stroked.
 */
function box(x: number, y: number, w: number, h: number): PathCommand[] {
  return [
    { type: 'M', x, y },
    { type: 'L', x: x + w, y },
    { type: 'L', x: x + w, y: y + h },
    { type: 'L', x, y: y + h },
    { type: 'L', x, y },
  ];
}

/**
 * The same ring walked the other way round, which is how a font marks a counter — the fill is
 * non-zero, so an equally-wound contour inside another is a second solid, not a hole.
 */
function counter(x: number, y: number, w: number, h: number): PathCommand[] {
  return [
    { type: 'M', x, y },
    { type: 'L', x, y: y + h },
    { type: 'L', x: x + w, y: y + h },
    { type: 'L', x: x + w, y },
    { type: 'L', x, y },
  ];
}

/** Enough to catch a curve's bulge; three samples a straight edge at its endpoints regardless. */
const SAMPLES = 16;

/** Extents of a contour's own outline, ignoring any holes hanging off it. */
function topOf(contour: THREE.Path): number {
  return Math.max(...contour.getPoints(SAMPLES).map((p) => p.y));
}

function bottomOf(contour: THREE.Path): number {
  return Math.min(...contour.getPoints(SAMPLES).map((p) => p.y));
}

function leftOf(contour: THREE.Path): number {
  return Math.min(...contour.getPoints(SAMPLES).map((p) => p.x));
}

describe('glyphToShapes', () => {
  it('negates y, because opentype paths are y-down and three is y-up', () => {
    const [shape] = glyphToShapes(fontDrawing(box(0, 0, 10, 10)), 'A', 1);

    expect(topOf(shape as THREE.Shape)).toBe(0);
    expect(bottomOf(shape as THREE.Shape)).toBe(-10);
  });

  it('negates the control point of a quadratic, not just its endpoints', () => {
    const [shape] = glyphToShapes(
      fontDrawing([
        { type: 'M', x: 0, y: 0 },
        { type: 'Q', x1: 5, y1: 10, x: 10, y: 0 },
      ]),
      'o',
      1,
    );

    expect(bottomOf(shape as THREE.Shape)).toBeLessThan(0);
    expect(topOf(shape as THREE.Shape)).toBeLessThanOrEqual(0);
  });

  it('negates both control points of a cubic', () => {
    const [shape] = glyphToShapes(
      fontDrawing([
        { type: 'M', x: 0, y: 0 },
        { type: 'C', x1: 3, y1: 10, x2: 7, y2: 10, x: 10, y: 0 },
      ]),
      'o',
      1,
    );

    expect(bottomOf(shape as THREE.Shape)).toBeLessThan(0);
    expect(topOf(shape as THREE.Shape)).toBeLessThanOrEqual(0);
  });

  it('nests a counter as a hole instead of a second solid shape', () => {
    const shapes = glyphToShapes(
      fontDrawing([...box(0, 0, 10, 10), ...counter(3, 3, 4, 4)]),
      'O',
      1,
    );

    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.holes).toHaveLength(1);
  });

  it('keeps disjoint contours as separate shapes', () => {
    const shapes = glyphToShapes(fontDrawing([...box(0, 0, 4, 4), ...box(10, 0, 4, 4)]), 'i', 1);

    expect(shapes).toHaveLength(2);
    expect(shapes.every((s) => s.holes.length === 0)).toBe(true);
  });

  it('attaches a counter to the contour containing it, not the one preceding it', () => {
    const shapes = glyphToShapes(
      fontDrawing([...box(0, 0, 10, 10), ...box(20, 0, 10, 10), ...counter(3, 3, 4, 4)]),
      '%',
      1,
    );

    expect(shapes).toHaveLength(2);
    const withHole = shapes.filter((s) => s.holes.length > 0);
    expect(withHole).toHaveLength(1);
    expect(topOf(withHole[0] as THREE.Shape)).toBe(0);
    expect(leftOf(withHole[0] as THREE.Shape)).toBe(0);
  });

  it('unions overlapping strokes into a single outline', () => {
    const shapes = glyphToShapes(fontDrawing([...box(0, 0, 10, 10), ...box(5, 5, 10, 10)]), 'A', 1);

    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.holes).toHaveLength(0);
  });

  it('spends points on a curve in proportion to how much it bends', () => {
    // Two glyphs identical but for the bulge of one edge, each with a second contour laid over it
    // so the union runs and has to answer in points. A fixed sampling gives both the same count.
    const wedge = (bulge: number): PathCommand[] => [
      { type: 'M', x: 0, y: 0 },
      { type: 'Q', x1: 0.5, y1: bulge, x: 1, y: 0 },
      { type: 'L', x: 1, y: 1 },
      { type: 'L', x: 0, y: 1 },
      { type: 'L', x: 0, y: 0 },
      { type: 'M', x: 0.4, y: 0.4 },
      { type: 'L', x: 1.4, y: 0.4 },
      { type: 'L', x: 1.4, y: 1.4 },
      { type: 'L', x: 0.4, y: 1.4 },
      { type: 'L', x: 0.4, y: 0.4 },
    ];
    const pointsOf = (bulge: number) =>
      glyphToShapes(fontDrawing(wedge(bulge)), 'D', 1).reduce(
        (n, shape) => n + shape.extractPoints(24).shape.length,
        0,
      );

    expect(pointsOf(0.01)).toBeLessThan(pointsOf(0.5));
  });

  it('leaves a glyph the union cannot change on its own curves', () => {
    // One outline and one counter: nothing to merge, so the shape keeps its quadratic rather than
    // being frozen into a polyline. `curves` is 1 per drawn command, many more once sampled.
    const [shape] = glyphToShapes(
      fontDrawing([
        { type: 'M', x: 0, y: 0 },
        { type: 'Q', x1: 5, y1: 10, x: 10, y: 0 },
        { type: 'L', x: 0, y: 0 },
      ]),
      'o',
      1,
    );

    expect(shape?.curves.some((c) => c.type === 'QuadraticBezierCurve')).toBe(true);
  });

  it('keeps overlapping strokes solid instead of making one a hole in another', () => {
    // A serif `A`: two diagonals crossed by a bar, all wound the same way, no counter contour.
    // The bar overlaps both diagonals, so the three merge into the one region of ink they fill.
    const shapes = glyphToShapes(
      fontDrawing([...box(0, 0, 4, 30), ...box(12, 0, 4, 30), ...box(2, 10, 12, 4)]),
      'A',
      1,
    );

    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.holes).toHaveLength(0);
    expect(leftOf(shapes[0] as THREE.Shape)).toBe(0);
    expect(topOf(shapes[0] as THREE.Shape)).toBeCloseTo(0, 10);
    expect(bottomOf(shapes[0] as THREE.Shape)).toBe(-30);
  });

  it('makes a contour nested two deep solid again', () => {
    const shapes = glyphToShapes(
      fontDrawing([...box(0, 0, 20, 20), ...counter(2, 2, 16, 16), ...box(6, 6, 8, 8)]),
      '@',
      1,
    );

    expect(shapes).toHaveLength(2);
  });

  it('gives a hole inside an island to the island, not to the outermost contour', () => {
    // Ordered so that attaching each hole to the most recently opened contour would be wrong.
    const shapes = glyphToShapes(
      fontDrawing([
        ...box(0, 0, 40, 40),
        ...box(10, 10, 20, 20),
        ...counter(14, 14, 12, 12),
        ...counter(4, 4, 32, 32),
      ]),
      '@',
      1,
    );

    expect(shapes).toHaveLength(2);
    const [outer, island] = [...shapes].sort((a, b) => leftOf(a) - leftOf(b));
    expect(leftOf(outer as THREE.Shape)).toBe(0);
    expect(leftOf(island as THREE.Shape)).toBe(10);
    expect((outer as THREE.Shape).holes.map(leftOf)).toEqual([4]);
    expect((island as THREE.Shape).holes.map(leftOf)).toEqual([14]);
  });

  it('drops a contour with no drawing commands after its move', () => {
    const shapes = glyphToShapes(
      fontDrawing([...box(0, 0, 10, 10), { type: 'M', x: 50, y: 50 }]),
      'A',
      1,
    );

    expect(shapes).toHaveLength(1);
    expect(leftOf(shapes[0] as THREE.Shape)).toBe(0);
  });

  it('closes a contour on Z, which a stroked or SVG-sourced path still emits', () => {
    const shapes = glyphToShapes(
      fontDrawing([
        { type: 'M', x: 0, y: 0 },
        { type: 'L', x: 10, y: 0 },
        { type: 'L', x: 10, y: 10 },
        { type: 'Z' },
      ]),
      'A',
      1,
    );

    expect(shapes).toHaveLength(1);
    expect(topOf(shapes[0] as THREE.Shape)).toBe(0);
    expect(bottomOf(shapes[0] as THREE.Shape)).toBe(-10);
  });

  it('skips a contour closed without drawing rather than letting three throw', () => {
    const commands: PathCommand[] = [
      ...box(0, 0, 10, 10),
      { type: 'M', x: 50, y: 50 },
      { type: 'Z' },
    ];

    const shapes = glyphToShapes(fontDrawing(commands), 'A', 1);
    expect(shapes).toHaveLength(1);
    expect(leftOf(shapes[0] as THREE.Shape)).toBe(0);
  });

  it('returns nothing for a glyph with no outline', () => {
    expect(glyphToShapes(fontDrawing([]), ' ', 1)).toEqual([]);
  });
});

/** A wedge with an 11.4-degree apex — far tighter than any miter can turn. */
function spike(): PathCommand[] {
  return [
    { type: 'M', x: 0, y: 100 },
    { type: 'L', x: 20, y: 100 },
    { type: 'L', x: 10, y: 0 },
    { type: 'L', x: 0, y: 100 },
  ];
}

describe('buildGlyphGeometry', () => {
  it('keeps a sharp apex within one bevel of the outline', () => {
    const geo = buildGlyphGeometry(fontDrawing(spike()), 'A', 1, DEFAULT_GLYPH_OPTIONS);

    // three caps a runaway miter at sqrt(2) units and offsets along the bisector anyway, which
    // stands the apex 1.41 bevels proud of a letter every other corner keeps to one.
    expect(geo.boundingBox?.max.y).toBeLessThanOrEqual(DEFAULT_GLYPH_OPTIONS.bevelSize + 1e-9);
  });

  it('survives a counter that encloses no area, which a font can draw', () => {
    // rye's `A` and `G` each carry one: a line out and back, enclosing nothing. Shorter than the
    // chamfer's own setback, so both cuts land on its midpoint and the ring has nowhere to go.
    const sliver: PathCommand[] = [
      { type: 'M', x: 10, y: 10 },
      { type: 'L', x: 10.001, y: 10.003 },
      { type: 'L', x: 10, y: 10 },
    ];

    expect(() =>
      buildGlyphGeometry(
        fontDrawing([...box(0, 0, 40, 40), ...sliver]),
        'A',
        1,
        DEFAULT_GLYPH_OPTIONS,
      ),
    ).not.toThrow();
  });

  it('leaves a right angle exactly one bevel proud', () => {
    const geo = buildGlyphGeometry(fontDrawing(box(0, 0, 10, 10)), 'A', 1, DEFAULT_GLYPH_OPTIONS);

    expect(geo.boundingBox?.max.y).toBeCloseTo(DEFAULT_GLYPH_OPTIONS.bevelSize, 7);
  });

  it('computes a bounding box, which callers use to center a word', () => {
    const geo = buildGlyphGeometry(fontDrawing(box(0, 0, 10, 10)), 'A', 1, DEFAULT_GLYPH_OPTIONS);

    expect(geo.boundingBox).not.toBeNull();
    expect(geo.boundingBox?.max.y).toBeGreaterThan(0);
  });

  it('leaves an empty bounding box for a glyph with no outline', () => {
    const geo = buildGlyphGeometry(fontDrawing([]), ' ', 1, DEFAULT_GLYPH_OPTIONS);

    expect(geo.attributes.position?.count).toBe(0);
    expect(geo.boundingBox?.isEmpty()).toBe(true);
    // Callers seeding a running max from 0 absorb this; assigning it straight does not.
    expect(geo.boundingBox?.max.y).toBe(Number.NEGATIVE_INFINITY);
  });
});
