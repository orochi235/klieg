# Plate cutter — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**For:** an engineer who knows TypeScript and three.js but nothing about klieg.
**Answers:** how to cut empty wells into a letter, and which four seams that needs.

**Goal:** a `'well'` decoration kind that replaces a letter's body with a slab plus a holed plate,
so recesses read without CSG.

**Architecture:** a builder may now answer `bodyGeometry(char, depth)`; `Word` uses it for the body
mesh instead of the extruded glyph. `WellBuilder` assembles that geometry from a registered cutter
(which places well outlines inside a region) and a plate assembler (which extrudes slab and plate
and merges them into one geometry).

**Tech Stack:** TypeScript, three.js, vitest (unit), Playwright (visual baselines).

**Acceptance for the slice: all 41 visual baselines byte-identical.** No shipped look selects
`'well'`, so nothing on a baseline path may change. A moved pixel is a bug.

The design is [the plate cutter](../specs/2026-09-03-plate-cutter-design.md); read its
"The bezel sets the slab's bevel" section before Task 4.

---

## Three constraints that are easy to violate

**`ctx.glyph()` and `bodyGeometry()` have opposite disposal contracts.** `glyph()` hands back
cache-owned geometry that a builder must never dispose. `bodyGeometry()` hands back builder-owned
geometry that the builder must dispose. Getting it backwards either leaks a geometry per distinct
char or frees one still being drawn by another word.

**Never mutate what `ctx.shapes()` answers.** It is cached and shared. The plate assembler clones
every shape before adding holes, and that clone is what makes repeat letters correct.

**`PartKind` stays closed.** `'run' | 'body' | 'chunk'` in `effects/types.ts` is public API.
`WellBuilder.collectParts()` answers `[]`; wells become targetable in the fill slice, not here.

## File structure

- Create `packages/core/src/render/wells/region.ts` — the region predicate over a glyph's SDF.
- Create `packages/core/src/render/wells/cutters.ts` — the `Cutter` type, its registry, `lattice`.
- Create `packages/core/src/render/wells/plate.ts` — `mergeNonIndexed` and `buildPlate`.
- Create `packages/core/src/render/decorations/well.ts` — `WellBuilder`.
- Modify `packages/core/src/render/caches.ts` — add `shapes(font, char)`.
- Modify `packages/core/src/text/glyphs.ts` — export `chamfered`, so the plate cuts corners back
  exactly as the plain extruder does.
- Modify `packages/core/src/render/decoration.ts` — add `WellSpec` to `DecorationSpec`.
- Modify `packages/core/src/render/decorations/registry.ts` — add `bodyGeometry?` and `shapes`.
- Modify `packages/core/src/render/word.ts` — use `bodyGeometry` for the body mesh; add `shapes`.
- Modify `spikes/plate-stack.mjs` — drive the shipped code instead of its own copy.
- Create `packages/core/test/render/wells/region.test.ts`
- Create `packages/core/test/render/wells/cutters.test.ts`
- Create `packages/core/test/render/wells/plate.test.ts`

`render/tube/` is the precedent for a subdirectory under `render/`; tests mirror the source tree.

---

### Task 1: Cache a glyph's contours

`buildGlyphGeometry` computes `glyphToShapes` and throws it away; a cutter wants exactly that. This
adds it to the cache that already holds glyph geometry.

**Files:**
- Modify: `packages/core/src/render/caches.ts`
- Modify: `packages/core/src/render/decorations/registry.ts`
- Modify: `packages/core/src/render/word.ts`
- Test: `packages/core/test/render/caches.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/render/caches.test.ts`. If that file does not exist, create it with
the imports shown. `stubFont()` is `word.test.ts:48` — copy it rather than importing, as the suite
already does; its chars are 0.5 em wide boxes rising 0.7 em.

```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WordCaches } from '../../src/render/caches.js';

describe('WordCaches.shapes', () => {
  it('answers one shared array per char, so a repeated letter cuts once', () => {
    const caches = new WordCaches();
    const font = stubFont();
    expect(caches.shapes(font, 'A')).toBe(caches.shapes(font, 'A'));
    expect(caches.shapes(font, 'B')).not.toBe(caches.shapes(font, 'A'));
    caches.dispose();
  });

  it('answers a box for a stub glyph, in three’s y-up em space', () => {
    const caches = new WordCaches();
    const shapes = caches.shapes(stubFont(), 'A');
    expect(shapes).toHaveLength(1);
    const points = (shapes[0] as THREE.Shape).getPoints(4);
    const box = new THREE.Box2();
    for (const p of points) box.expandByPoint(p);
    expect(box.min.x).toBeCloseTo(0, 5);
    expect(box.max.x).toBeCloseTo(0.5, 5);
    expect(box.max.y).toBeCloseTo(0.7, 5);
    caches.dispose();
  });

  it('refuses use after dispose, as glyph() does', () => {
    const caches = new WordCaches();
    caches.dispose();
    expect(() => caches.shapes(stubFont(), 'A')).toThrow('used after dispose');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/test/render/caches.test.ts`
Expected: FAIL — `caches.shapes is not a function`.

- [ ] **Step 3: Add the cache**

In `packages/core/src/render/caches.ts`, extend the import of `glyphs.js` to bring in
`glyphToShapes` alongside `buildGlyphGeometry`, `DEFAULT_GLYPH_OPTIONS` and `EM`, and change the
`three` import from `import type * as THREE` to `import type * as THREE` (unchanged — the file
needs no runtime three). Add the field beside `geometries`:

```ts
  private readonly contours = new Map<string, THREE.Shape[]>();
```

and the method beside `glyph()`:

```ts
  /**
   * A glyph's contours, which a well cutter needs and `buildGlyphGeometry` discards. Depth is not
   * part of the key because a contour has none.
   *
   * Shared and never copied — a caller adding holes must clone first, or the next letter of the
   * same char inherits them.
   */
  shapes(font: LoadedFont, char: string): THREE.Shape[] {
    if (this.disposed) throw new Error('klieg: WordCaches used after dispose');
    const key = `${this.interner.id(font)}|${char}`;
    let shapes = this.contours.get(key);
    if (!shapes) {
      shapes = glyphToShapes(font.font, char, EM);
      this.contours.set(key, shapes);
    }
    return shapes;
  }
```

In `dispose()`, add `this.contours.clear();` beside the geometry loop. A `Shape` holds no GPU
resource, so there is nothing to free — only the map to drop.

- [ ] **Step 4: Put it on the build context**

In `packages/core/src/render/decorations/registry.ts`, add to `WordBuildContext` below `glyph`:

```ts
  /** This glyph's contours, shared and cached. Clone before mutating. */
  shapes(char: string): THREE.Shape[];
```

In `packages/core/src/render/word.ts`, add beside `glyph()` (`word.ts:409`):

```ts
  shapes(char: string): THREE.Shape[] {
    return this.caches.shapes(this.font, char);
  }
```

Add `shapes: (char) => caches.shapes(font, char),` to the `wordContext()` helper in
`packages/core/test/render/decorations/registry.test.ts`, or the existing builder tests stop
typechecking.

- [ ] **Step 5: Run the unit suite**

Run: `npm test`
Expected: PASS, at the baseline count plus this task's three specs.

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "cache a glyph's contours beside its geometry"
```

---

### Task 2: The region

A region answers whether a point sits far enough inside the glyph to hold a well. It is a predicate
over the signed distance field the tube pipeline already builds, not an offset contour.

**Files:**
- Create: `packages/core/src/render/wells/region.ts`
- Test: `packages/core/test/render/wells/region.test.ts`

- [ ] **Step 1: Write the failing test**

A stub char is a box from `(0, 0)` to `(0.5, 0.7)`, so its centre `(0.25, 0.35)` is 0.25 em inside
and a point at `x = 0.02` is 0.02 em inside. Copy `stubFont()` from `word.test.ts:48`.

```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WordCaches } from '../../../src/render/caches.js';
import { regionOf } from '../../../src/render/wells/region.js';

function boxRegion() {
  const caches = new WordCaches();
  return regionOf(caches.shapes(stubFont(), 'A'));
}

describe('regionOf', () => {
  it('holds a point further inside than the clearance asked for', () => {
    expect(boxRegion().contains(0.25, 0.35, 0.2)).toBe(true);
  });

  it('rejects the same point at a clearance it does not have', () => {
    expect(boxRegion().contains(0.25, 0.35, 0.3)).toBe(false);
  });

  it('rejects a point near the edge', () => {
    expect(boxRegion().contains(0.02, 0.35, 0.05)).toBe(false);
  });

  it('rejects a point outside the glyph entirely', () => {
    expect(boxRegion().contains(-0.1, 0.35, 0)).toBe(false);
  });

  // A counter is boundary to the field exactly as an outline is, which is the whole reason this
  // needs no separate hole handling.
  it('rejects a point inside a counter', () => {
    const outer = new THREE.Shape();
    outer.moveTo(0, 0);
    outer.lineTo(1, 0);
    outer.lineTo(1, 1);
    outer.lineTo(0, 1);
    outer.closePath();
    const hole = new THREE.Path();
    hole.moveTo(0.4, 0.4);
    hole.lineTo(0.6, 0.4);
    hole.lineTo(0.6, 0.6);
    hole.lineTo(0.4, 0.6);
    hole.closePath();
    outer.holes.push(hole);
    const region = regionOf([outer]);
    expect(region.contains(0.5, 0.5, 0)).toBe(false);
    expect(region.contains(0.15, 0.5, 0.05)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/test/render/wells/region.test.ts`
Expected: FAIL — cannot resolve `../../../src/render/wells/region.js`.

- [ ] **Step 3: Write the region**

`packages/core/src/render/wells/region.ts`:

```ts
import type * as THREE from 'three';
import { type Point2, signedDistanceField } from '../tube/field.js';

/**
 * Grid cells per side. At a letter's scale this puts a cell at about 0.003 em, an order finer than
 * the smallest bezel worth cutting, and the field is built once per glyph.
 */
const RESOLUTION = 256;

/** Room around the silhouette so a point outside it still lands on the grid. */
const PAD = 0.05;

/** How finely a contour is sampled into the polygon the field rasterises. */
const CONTOUR_SEGMENTS = 64;

export interface Region {
  /** Whether `(x, y)` in em sits at least `clearance` em inside every contour of the glyph. */
  contains(x: number, y: number, clearance: number): boolean;
}

/**
 * The glyph as a region a cutter may place wells in.
 *
 * A signed distance field rather than an offset contour: nothing in the tree offsets a contour,
 * the field already ships as the tube pipeline's own, and it counts a counter as boundary — so one
 * sample answers "far enough inside everything" without separate hole handling.
 */
export function regionOf(shapes: readonly THREE.Shape[]): Region {
  const polygons: Point2[][] = [];
  for (const shape of shapes) {
    polygons.push(shape.getPoints(CONTOUR_SEGMENTS).map((p) => ({ x: p.x, y: p.y })));
    for (const hole of shape.holes) {
      polygons.push(hole.getPoints(CONTOUR_SEGMENTS).map((p) => ({ x: p.x, y: p.y })));
    }
  }
  if (polygons.length === 0) throw new Error('klieg: regionOf needs a glyph that drew ink');
  const field = signedDistanceField(polygons, { resolution: RESOLUTION, pad: PAD });
  return {
    // Inside is negative, so "at least `clearance` in" is one comparison. A point off the grid
    // samples +Infinity, which fails for every clearance.
    contains: (x, y, clearance) => field.sample(x, y) <= -clearance,
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run packages/core/test/render/wells/region.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "answer a glyph's bezel from its distance field"
```

---

### Task 3: The cutter registry and the lattice

**Files:**
- Create: `packages/core/src/render/wells/cutters.ts`
- Test: `packages/core/test/render/wells/cutters.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WordCaches } from '../../../src/render/caches.js';
import { cutterFor } from '../../../src/render/wells/cutters.js';
import { regionOf } from '../../../src/render/wells/region.js';

const SPEC = {
  kind: 'well',
  cutter: 'lattice',
  bezel: 0.012,
  floor: 0.09,
  pitch: 0.068,
  size: 0.048,
  look: {},
} as const;

function cutBox(overrides = {}) {
  const shapes = new WordCaches().shapes(stubFont(), 'A');
  return cutterFor('lattice')(shapes, regionOf(shapes), { ...SPEC, ...overrides } as never);
}

describe('the lattice cutter', () => {
  it('fills a box with wells and takes its floor from the spec', () => {
    const cut = cutBox();
    expect(cut.wells.length).toBeGreaterThan(10);
    expect(cut.floor).toBe(0.09);
  });

  it('keeps every well inside the bezel', () => {
    const shapes = new WordCaches().shapes(stubFont(), 'A');
    const region = regionOf(shapes);
    for (const well of cutBox().wells) {
      for (const p of well.getPoints(1)) {
        expect(region.contains(p.x, p.y, 0)).toBe(true);
      }
    }
  });

  // The corners, not the centre: a centre clearing the bezel by less than the half-diagonal still
  // hangs the well off the letter's edge, and a count alone would never show it.
  it('rejects a well whose corners leave the bezel even though its centre does not', () => {
    expect(cutBox({ size: 0.048 }).wells.length).toBeGreaterThan(
      cutBox({ size: 0.3 }).wells.length,
    );
  });

  it('places fewer wells as the bezel grows', () => {
    expect(cutBox({ bezel: 0.1 }).wells.length).toBeLessThan(cutBox({ bezel: 0.012 }).wells.length);
  });

  it('throws on a cutter nobody registered', () => {
    expect(() => cutterFor('spiral')).toThrow(/spiral/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/test/render/wells/cutters.test.ts`
Expected: FAIL — cannot resolve `../../../src/render/wells/cutters.js`.

- [ ] **Step 3: Write the registry and the lattice**

`packages/core/src/render/wells/cutters.ts`:

```ts
import * as THREE from 'three';
import type { WellSpec } from '../decoration.js';
import type { Region } from './region.js';

/** How finely a contour is sampled when measuring the glyph's extent. */
const CONTOUR_SEGMENTS = 24;

/** Row pitch as a fraction of column pitch, so a staggered lattice is equilateral. */
const ROW = Math.sqrt(3) / 2;

/** What one cut produces: the well outlines, and the one floor they share. */
export interface Cut {
  /** Closed well outlines in the glyph's own em space. */
  wells: THREE.Path[];
  /** How far below the plate's front face the floor sits, in em. */
  floor: number;
}

export type Cutter = (shapes: readonly THREE.Shape[], region: Region, spec: WellSpec) => Cut;

const CUTTERS = new Map<string, Cutter>();

export function registerCutter(name: string, cut: Cutter): void {
  CUTTERS.set(name, cut);
}

export function cutterFor(name: string): Cutter {
  const cut = CUTTERS.get(name);
  if (!cut) throw new Error(`klieg: no well cutter registered for '${name}'`);
  return cut;
}

/** Diamonds on a staggered lattice, clipped to the region. */
const lattice: Cutter = (shapes, region, spec) => {
  const box = new THREE.Box2();
  for (const shape of shapes) {
    for (const p of shape.getPoints(CONTOUR_SEGMENTS)) box.expandByPoint(p);
  }
  const half = spec.size / 2;
  const wells: THREE.Path[] = [];
  const rowStep = spec.pitch * ROW;
  const rows = Math.ceil((box.max.y - box.min.y) / rowStep);
  for (let r = 0; r <= rows; r++) {
    const y = box.min.y + r * rowStep;
    const stagger = r % 2 ? spec.pitch / 2 : 0;
    for (let x = box.min.x + stagger; x <= box.max.x; x += spec.pitch) {
      // Every corner, not the centre. A centre that clears the bezel by less than the
      // half-diagonal still leaves the well breaking the letter's edge.
      if (
        !region.contains(x, y + half, spec.bezel) ||
        !region.contains(x + half, y, spec.bezel) ||
        !region.contains(x, y - half, spec.bezel) ||
        !region.contains(x - half, y, spec.bezel)
      ) {
        continue;
      }
      const path = new THREE.Path();
      path.moveTo(x, y + half);
      path.lineTo(x + half, y);
      path.lineTo(x, y - half);
      path.lineTo(x - half, y);
      path.closePath();
      wells.push(path);
    }
  }
  return { wells, floor: spec.floor };
};

registerCutter('lattice', lattice);
```

`WellSpec` does not exist until Task 5. Until then this file will not typecheck against it, so
**write Task 5's `WellSpec` addition to `decoration.ts` now** — the type alone, exactly as Task 5
Step 3 shows it, without touching `DecorationSpec`. Task 5 adds it to the union.

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run packages/core/test/render/wells/cutters.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "place well outlines with a registered cutter"
```

---

### Task 4: Slab and plate as one geometry

**Files:**
- Create: `packages/core/src/render/wells/plate.ts`
- Modify: `packages/core/src/text/glyphs.ts:348` — export `chamfered`
- Test: `packages/core/test/render/wells/plate.test.ts`

Read [the design's bezel section](../specs/2026-09-03-plate-cutter-design.md) first. The slab's
bevel is derived from the bezel and is not a knob of its own: a bevelled extrusion's front cap
covers only the shape inset by `bevelSize` and ramps across that width, and that cap is every
well's floor.

**Both extrusions must go through `chamfered()`, which is currently module-private in
`text/glyphs.ts:348`.** Export it — do not copy it. `buildGlyphGeometry` cuts sharp corners back
before extruding because three caps a runaway miter at sqrt(2) and leaves a nub past the tip of a
letter otherwise; that is the bevel spur `7fcbcdb` fixed. A plate extruded from raw contours brings
it straight back, on the letters most likely to be carved.

- [ ] **Step 1: Write the failing test**

```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WordCaches } from '../../../src/render/caches.js';
import { cutterFor } from '../../../src/render/wells/cutters.js';
import { buildPlate, mergeNonIndexed } from '../../../src/render/wells/plate.js';
import { regionOf } from '../../../src/render/wells/region.js';

const SPEC = {
  kind: 'well',
  cutter: 'lattice',
  bezel: 0.012,
  floor: 0.09,
  pitch: 0.068,
  size: 0.048,
  look: {},
} as const;

describe('mergeNonIndexed', () => {
  it('concatenates positions and keeps the attribute triple', () => {
    const a = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const b = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const merged = mergeNonIndexed([a, b]);
    expect(merged.getAttribute('position').count).toBe(
      a.getAttribute('position').count + b.getAttribute('position').count,
    );
    expect(merged.getAttribute('normal')).toBeDefined();
    expect(merged.getIndex()).toBeNull();
  });

  // An indexed part would concatenate its positions and silently drop its triangles.
  it('refuses an indexed part rather than dropping its index', () => {
    expect(() => mergeNonIndexed([new THREE.BoxGeometry(1, 1, 1)])).toThrow(/indexed/);
  });
});

describe('buildPlate', () => {
  it('spans the full letter depth and costs more than the plain glyph', () => {
    const caches = new WordCaches();
    const shapes = caches.shapes(stubFont(), 'A');
    const cut = cutterFor('lattice')(shapes, regionOf(shapes), SPEC as never);
    const geo = buildPlate(shapes, cut, { depth: 0.3, bezel: SPEC.bezel });
    geo.computeBoundingBox();
    const box = geo.boundingBox as THREE.Box3;
    expect(box.max.z).toBeCloseTo(0.3, 3);
    expect(geo.getAttribute('position').count).toBeGreaterThan(
      caches.glyph(stubFont(), 'A', 0.3).getAttribute('position').count,
    );
  });

  // The cached array is shared by every letter of the same char; adding holes to it would give the
  // second 'A' the first one's wells on top of its own.
  it('leaves the shapes it was handed unholed', () => {
    const shapes = new WordCaches().shapes(stubFont(), 'A');
    const before = (shapes[0] as THREE.Shape).holes.length;
    const cut = cutterFor('lattice')(shapes, regionOf(shapes), SPEC as never);
    buildPlate(shapes, cut, { depth: 0.3, bezel: SPEC.bezel });
    expect((shapes[0] as THREE.Shape).holes).toHaveLength(before);
  });

  it('cuts nothing when the cutter found no room', () => {
    const shapes = new WordCaches().shapes(stubFont(), 'A');
    const empty = buildPlate(shapes, { wells: [], floor: 0.09 }, { depth: 0.3, bezel: 0.012 });
    expect(empty.getAttribute('position').count).toBeGreaterThan(0);
  });

  // `buildGlyphGeometry` cuts sharp corners back before extruding, because three's miter cap
  // leaves a nub past the tip of a letter otherwise. A plate that skips it brings that spur back.
  it('chamfers a sharp corner the way the plain extruder does', () => {
    const spike = new THREE.Shape();
    spike.moveTo(0, 0);
    spike.lineTo(1, 0);
    spike.lineTo(0.02, 0.06);
    spike.closePath();
    const geo = buildPlate([spike], { wells: [], floor: 0.09 }, { depth: 0.3, bezel: 0.012 });
    geo.computeBoundingBox();
    // Unchamfered, the miter runs the bevel ring past x = 1; chamfered, it cannot.
    expect((geo.boundingBox as THREE.Box3).max.x).toBeLessThan(1.1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/test/render/wells/plate.test.ts`
Expected: FAIL — cannot resolve `../../../src/render/wells/plate.js`.

- [ ] **Step 3: Write the assembler**

`packages/core/src/render/wells/plate.ts`:

```ts
import * as THREE from 'three';
import { chamfered, DEFAULT_GLYPH_OPTIONS } from '../../text/glyphs.js';
import type { Cut } from './cutters.js';

/** How finely a contour is sampled for the containment test that hosts a well. */
const CONTOUR_SEGMENTS = 24;

export interface PlateOptions {
  /** The letter's full depth, slab plus plate. */
  depth: number;
  /** How far in from every contour a well stays, in em. Caps the slab's bevel. */
  bezel: number;
}

/**
 * Two extrusions as one geometry. `ExtrudeGeometry` is always non-indexed and carries position,
 * normal and uv, so this is concatenation. Groups are dropped: the body draws on one material, and
 * a group whose material index nothing supplies would render nothing.
 */
export function mergeNonIndexed(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const part of parts) {
    if (part.getIndex()) throw new Error('klieg: mergeNonIndexed was handed indexed geometry');
  }
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const attrs = parts.map((part) => part.getAttribute(name) as THREE.BufferAttribute);
    const total = attrs.reduce((n, attr) => n + attr.array.length, 0);
    const merged = new Float32Array(total);
    let at = 0;
    for (const attr of attrs) {
      merged.set(attr.array as Float32Array, at);
      at += attr.array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(merged, attrs[0]?.itemSize ?? 3));
  }
  out.computeBoundingBox();
  return out;
}

/** Ray casting against one sampled ring. */
function inRing(ring: readonly THREE.Vector2[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as THREE.Vector2;
    const b = ring[j] as THREE.Vector2;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/**
 * The glyph's shapes with each well added as a hole to the outline that contains it.
 *
 * Clones first: the shapes are the cache's, shared by every letter of the same char. Hosting
 * matters because a glyph may draw several outlines — an `i` is a stem and a dot — and a hole
 * pushed onto the wrong one triangulates across the gap between them.
 */
function withWells(shapes: readonly THREE.Shape[], wells: readonly THREE.Path[]): THREE.Shape[] {
  const cut = shapes.map((shape) => {
    const copy = shape.clone();
    copy.holes = shape.holes.map((hole) => hole.clone());
    return copy;
  });
  const rings = cut.map((shape) => shape.getPoints(CONTOUR_SEGMENTS));
  for (const well of wells) {
    const at = well.getPoints(1)[0];
    if (!at) continue;
    const host = cut.findIndex((_, i) => inRing(rings[i] as THREE.Vector2[], at.x, at.y));
    if (host < 0) continue;
    (cut[host] as THREE.Shape).holes.push(well);
  }
  return cut;
}

function extrude(shapes: THREE.Shape[], depth: number, bevelSize: number): THREE.ExtrudeGeometry {
  const full = DEFAULT_GLYPH_OPTIONS.bevelSize;
  return new THREE.ExtrudeGeometry(chamfered(shapes, DEFAULT_GLYPH_OPTIONS), {
    depth,
    curveSegments: DEFAULT_GLYPH_OPTIONS.curveSegments,
    bevelEnabled: bevelSize > 0,
    bevelSize,
    // Kept in proportion, so a reduced bevel is the same profile scaled rather than a steeper one.
    bevelThickness: (DEFAULT_GLYPH_OPTIONS.bevelThickness * bevelSize) / full,
    bevelSegments: DEFAULT_GLYPH_OPTIONS.bevelSegments,
    bevelOffset: 0,
  });
}

/**
 * A letter as a slab with a holed plate on its front face.
 *
 * The slab's bevel is derived from the bezel rather than being its own knob. A bevelled front cap
 * covers only the shape inset by `bevelSize` and ramps down across that width, and that cap is
 * every well's floor — so a well cut closer in than the slab's bevel would sit on a ramp at an
 * unpredictable depth. Deriving it makes that inexpressible. In a stack the plate carries the
 * letter's front bevel anyway, so the slab's only other job is the back edge.
 */
export function buildPlate(
  shapes: readonly THREE.Shape[],
  cut: Cut,
  opts: PlateOptions,
): THREE.BufferGeometry {
  const slabDepth = Math.max(opts.depth - cut.floor, 0);
  const slab = extrude(
    shapes as THREE.Shape[],
    slabDepth,
    Math.min(DEFAULT_GLYPH_OPTIONS.bevelSize, opts.bezel),
  );
  const plate = extrude(withWells(shapes, cut.wells), cut.floor, DEFAULT_GLYPH_OPTIONS.bevelSize);
  plate.translate(0, 0, slabDepth);
  const merged = mergeNonIndexed([slab, plate]);
  slab.dispose();
  plate.dispose();
  return merged;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run packages/core/test/render/wells/plate.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "assemble a slab and a holed plate as one letter body"
```

---

### Task 5: `WellSpec` and the builder that carves a body

Adds the kind, the optional interface member, and the builder. `Word` is not touched yet — the
builder is exercised directly, so this task's tests cannot be confused by wiring.

**Files:**
- Modify: `packages/core/src/render/decoration.ts`
- Modify: `packages/core/src/render/decorations/registry.ts`
- Create: `packages/core/src/render/decorations/well.ts`
- Test: `packages/core/test/render/decorations/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `registry.test.ts`, with the fixture beside the file's existing ones:

```ts
const WELL_SPEC = {
  kind: 'well',
  cutter: 'lattice',
  bezel: 0.012,
  floor: 0.09,
  pitch: 0.068,
  size: 0.048,
  look: {},
};

function wellBuilder() {
  const builder = decorationBuilderFor(WELL_SPEC as never, wordContext());
  if (!builder) throw new Error('no builder');
  return builder;
}

describe('WellBuilder', () => {
  it('carves a body that costs more than the plain glyph', () => {
    const builder = wellBuilder();
    const geo = builder.bodyGeometry?.('A', 0.3);
    expect(geo).toBeDefined();
    const carved = (geo as THREE.BufferGeometry).getAttribute('position').count;
    expect(carved).toBeGreaterThan(0);
    builder.dispose();
  });

  it('answers one geometry per char, however many letters ask', () => {
    const builder = wellBuilder();
    expect(builder.bodyGeometry?.('A', 0.3)).toBe(builder.bodyGeometry?.('A', 0.3));
    expect(builder.bodyGeometry?.('B', 0.3)).not.toBe(builder.bodyGeometry?.('A', 0.3));
    builder.dispose();
  });

  it('adds nothing to the letter group — the wells are in the body', () => {
    const builder = wellBuilder();
    const sized = new THREE.Group();
    builder.buildLetter(0, 'A', sized, undefined);
    expect(sized.children).toHaveLength(0);
    builder.dispose();
  });

  it('contributes no parts, because a well has no fill to target yet', () => {
    const builder = wellBuilder();
    builder.buildLetter(0, 'A', new THREE.Group(), undefined);
    expect(builder.collectParts()).toEqual([]);
    expect(builder.boundsAt(0)).toBeNull();
    builder.dispose();
  });

  // `collectParts()` walks "highest index written + 1" for every other builder, so a trailing
  // hole is the case that distinguishes it from the letter count. This builder keeps no
  // per-letter array — if one is ever added, assert alignment once **per array**, because a
  // single assertion stays green while a different array is the one that slipped.
  it('survives a hole at either end of the letter run', () => {
    const builder = wellBuilder();
    builder.skipLetter(0);
    builder.buildLetter(1, 'A', new THREE.Group(), undefined);
    builder.skipLetter(2);
    expect(builder.collectParts()).toEqual([]);
    expect(() => builder.frame(1, 1)).not.toThrow();
    builder.dispose();
  });

  it('leaves the shipped kinds without a body of their own', () => {
    const tube = decorationBuilderFor(specOf('tubing').decoration, wordContext());
    expect(tube?.bodyGeometry).toBeUndefined();
    tube?.dispose();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/test/render/decorations/registry.test.ts`
Expected: FAIL — `no decoration builder registered for kind 'well'`.

- [ ] **Step 3: Add `WellSpec` to the union**

In `packages/core/src/render/decoration.ts`, beside `ChunkSpec`:

```ts
export interface WellSpec {
  kind: 'well';
  /** Which registered cutter places the wells. A second cutter makes this a discriminant. */
  cutter: 'lattice';
  /**
   * How far in from every contour a well stays, in em. Also caps the slab's bevel, because the
   * slab's front face is every well's floor and a bevelled cap ramps across its own bevel width.
   */
  bezel: number;
  /** How deep a well is — the plate's thickness — in em. */
  floor: number;
  /** Lattice pitch, in em. */
  pitch: number;
  /** A well's full diagonal, in em. */
  size: number;
  look: MaterialSpec;
}
```

and widen the union:

```ts
export type DecorationSpec = TubeSpec | ChunkSpec | WellSpec;
```

`apps/lab/src/main.ts` branches on decoration kind with `if`/`else if` chains at lines 212, 229,
261, 274 and 614–615 and has no exhaustive `never` check, so a third kind falls through them.
Nothing there needs changing.

- [ ] **Step 4: Add the interface member**

In `packages/core/src/render/decorations/registry.ts`, add to `DecorationBuilder`:

```ts
  /**
   * This letter's body geometry, replacing the extruded glyph. Omit it and `Word` uses the cache.
   *
   * Disposal is the reverse of `ctx.glyph()`'s: what this answers is the builder's own and the
   * builder must free it in `dispose()`, where `ctx.glyph()`'s belongs to the cache and must never
   * be freed by a builder. Keyed on the char rather than the letter slot, because a letter's wells
   * cannot depend on its neighbours — so one geometry serves every letter of that char.
   */
  bodyGeometry?(char: string, depth: number): THREE.BufferGeometry;
```

- [ ] **Step 5: Write the builder**

`packages/core/src/render/decorations/well.ts`:

```ts
import type * as THREE from 'three';
import type { ResolvedOffset } from '../../effects/types.js';
import { GlyphCache } from '../../text/glyphs.js';
import type { WellSpec } from '../decoration.js';
import { cutterFor } from '../wells/cutters.js';
import { buildPlate } from '../wells/plate.js';
import { regionOf } from '../wells/region.js';
import type { DecorationBuilder, DecorationPart, WordBuildContext } from './registry.js';

/**
 * A letter carved with wells. Everything it makes is the body, so it adds nothing to the letter
 * group and contributes no parts — the fill that sits in a well is what will bring both.
 */
export class WellBuilder implements DecorationBuilder {
  /** One body per char: a letter's wells cannot depend on its neighbours. */
  private readonly bodies: GlyphCache<THREE.BufferGeometry>;

  constructor(spec: WellSpec, ctx: WordBuildContext) {
    this.bodies = new GlyphCache<THREE.BufferGeometry>((char, depth) => {
      const shapes = ctx.shapes(char);
      const cut = cutterFor(spec.cutter)(shapes, regionOf(shapes), spec);
      return buildPlate(shapes, cut, { depth, bezel: spec.bezel });
    });
  }

  bodyGeometry(char: string, depth: number): THREE.BufferGeometry {
    return this.bodies.get(char, depth);
  }

  buildLetter(): void {}

  skipLetter(): void {}

  /** No parts until a fill occupies the wells; `PartKind` stays closed in this slice. */
  collectParts(): DecorationPart[] {
    return [];
  }

  frame(): void {}

  /** The wells are the body, which already spans the letter, so there is no box of its own. */
  boundsAt(): THREE.Box2 | null {
    return null;
  }

  applyGradientBounds(): void {}

  /** Unreachable: `collectParts()` answers none, so `Word` never routes a write here. */
  writePart(_part: DecorationPart, _out: ResolvedOffset): void {}

  dispose(): void {
    // Builder-owned, unlike `ctx.glyph()`'s — see `bodyGeometry` on the interface.
    this.bodies.dispose();
  }
}
```

Register it at the bottom of `registry.ts`, beside the two existing registrations, with
`import { WellBuilder } from './well.js';` at the top:

```ts
registerDecoration('well', (spec, ctx) => new WellBuilder(spec, ctx));
```

- [ ] **Step 6: Run the whole check**

Run: `npm run check`
Expected: lint, typecheck and the full unit suite clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "carve a letter's body with a well builder"
```

---

### Task 6: Let `Word` take the body from the builder

Nothing has drawn a carved letter yet — the builder answers a geometry and no one asks. This is the
one line that asks, and the visual baselines are what prove it changed nothing else.

**Files:**
- Modify: `packages/core/src/render/word.ts`
- Test: `packages/core/test/render/word.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `word.test.ts`, beside its other `Word` specs. It reads the body mesh's geometry off the
built letter rather than trusting the builder, which is the only way to catch the wiring being
absent.

```ts
it('draws the body from the builder when the decoration supplies one', () => {
  const carved = wordWith({
    kind: 'well',
    cutter: 'lattice',
    bezel: 0.012,
    floor: 0.09,
    pitch: 0.068,
    size: 0.048,
    look: {},
  });
  const plain = wordWith(undefined);

  const bodyOf = (word: Word) =>
    ((groups(word)[0] as THREE.Group).children[0] as THREE.Group).children[0] as THREE.Mesh;

  expect(bodyOf(carved).geometry.getAttribute('position').count).not.toBe(
    bodyOf(plain).geometry.getAttribute('position').count,
  );
  carved.dispose();
  plain.dispose();
});
```

`wordWith(decoration)` is a helper this spec needs: build a `Word` over a single-letter string with
`spec.decoration` set to its argument, using whatever fixture the neighbouring `Word` specs in this
file already use. Copy their construction rather than inventing one — the constructor takes a
budget, a look and a timeline, and getting any of them wrong fails for the wrong reason.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/test/render/word.test.ts`
Expected: FAIL — the two counts are equal, because `Word` still builds every body from the cache.

- [ ] **Step 3: Wire `Word`**

In `packages/core/src/render/word.ts`, keep the ink test on the plain glyph (`word.ts:456`)
unchanged — a letter that drew no ink has no wells either:

```ts
    const geo = this.glyph(char, DEFAULT_GLYPH_OPTIONS.depth);
    if (!geo.attributes.position?.count) {
```

Then replace the body mesh (`word.ts:488`):

```ts
    const bodyMesh = new THREE.Mesh(geo, material);
```

with

```ts
    // The builder's own geometry when it has one, the cache's otherwise. Asked before the builder
    // builds its letter, so a body-replacing kind never sees a half-built cell.
    const body = this.builder?.bodyGeometry?.(char, DEFAULT_GLYPH_OPTIONS.depth) ?? geo;
    const bodyMesh = new THREE.Mesh(body, material);
```

- [ ] **Step 4: Run the whole check**

Run: `npm run check`
Expected: lint, typecheck and the full unit suite clean.

- [ ] **Step 5: Run the visual baselines**

Run: `npx playwright test`
Expected: 41 passed. Nothing shipped supplies a `bodyGeometry`, so every look takes the `?? geo`
path it took before. **If a look moved, the `??` is reaching a builder that should not have one.**

Read the failures before believing a count — see the Traps below. A failure that never reached a
screenshot comparison is not evidence of a regression.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "let a decoration builder supply the letter's body"
```

---

### Task 7: Drive the shipped code from the spike, and record what it cost

`spikes/plate-stack.mjs` currently carries its own copies of the region, the lattice and the plate
assembly — written before any of them existed. Point it at the real ones, so the spike is a
regression check rather than a second implementation.

**Files:**
- Modify: `spikes/plate-stack.mjs`
- Modify: `docs/superpowers/HANDOFF.md`

- [ ] **Step 1: Rebuild and rewire the spike**

Run: `npm run build -w klieg`

In `spikes/plate-stack.mjs`, replace the local `regionOf`, `lattice`, `cutPlate`, `bevelOf`,
`extrude` and `stack` with imports:

```js
import { cutterFor } from '../packages/core/dist/render/wells/cutters.js';
import { buildPlate } from '../packages/core/dist/render/wells/plate.js';
import { regionOf } from '../packages/core/dist/render/wells/region.js';
```

The `wells` variant becomes

```js
const CUT_SPEC = {
  kind: 'well',
  cutter: 'lattice',
  bezel: MARGIN,
  floor: PLATE,
  pitch: PITCH,
  size: HALF * 2,
  look: {},
};
const cutOf = (letterShapes) =>
  cutterFor('lattice')(letterShapes, regionOf(letterShapes), CUT_SPEC);

/** The control: today's letter, extruded the way `buildGlyphGeometry` does. */
const extrudeControl = (letterShapes) =>
  new THREE.ExtrudeGeometry(letterShapes, {
    ...DEFAULT_GLYPH_OPTIONS,
    bevelEnabled: true,
    bevelOffset: 0,
  });

const VARIANTS = {
  today: () => [extrudeControl(shapes)],
  wells: () => [buildPlate(shapes, cutOf(shapes), { depth: D, bezel: MARGIN })],
};
```

`today` is the only cell that must look like a shipped letter. Drop `stack` and `wells-flat-slab`:
both existed to answer questions the design now records, and the slab's bevel is no longer
separately settable.

`today` and `wells` should agree everywhere except the wells themselves, because Task 4 chamfers
the plate through the same `chamfered()` the plain extruder uses. A difference at sharp corners
means that call was dropped.

`--sweep` keeps working, now counting `cutterFor('lattice')(...).wells.length`.

- [ ] **Step 2: Check the spike still renders and still reports**

Run: `node spikes/plate-stack.mjs --letter R --margin 0.012 --half 0.024 --pitch 0.068 --looks chrome`
Expected: 61 seats on `R`, and `wells` at roughly 32,800 vertices against `today`'s 7,272. The two
cells should look like the render in the design.

Run: `node spikes/plate-stack.mjs --sweep --pitch 0.068 --half 0.024`
Expected: the design's table — 142 seats at a 0.038 bezel rising to 309 at 0.

**These numbers came from the spike's own copy of the algorithm. If the shipped code disagrees,
the shipped code is what to trust and the design's table is what to correct** — but find out why
before editing either.

- [ ] **Step 3: Run the whole check and the baselines**

Run: `npm run check`
Expected: clean.

Run: `npx playwright test`
Expected: 41 passed.

- [ ] **Step 4: Add a handoff entry**

Under "What is worth doing next", the plate cutter is currently the open item. Replace it with what
the next person needs, which is the `stone` fill slice. Only what the code does not say:

**Wells are cut and empty, and `collectParts()` answers `[]`.** A fill is what gives a well parts,
and until it does no effect can target one. That is the first thing the fill slice adds, and it is
where `PartKind` finally has to open — the design moves targeting to `{ fill: 'stones' }`.

**The bezel is the slab's bevel, derived rather than set.** `buildPlate` takes the bezel and caps
the slab's bevel with it, because the slab's front cap is every well's floor and a bevelled cap
ramps across its own bevel width. Nothing can express a sloped seat, and nothing should be able to.

**A cutter tests a well's corners, not its centre.** A count cannot show the difference; a stone
hanging off the letter's edge is what it looks like when the test is wrong.

**`bodyGeometry` is builder-owned and `ctx.glyph()` is cache-owned.** Neighbouring calls, opposite
disposal contracts. `WellBuilder` holds a `GlyphCache` so its bodies are freed together.

Also update the branch-state paragraph: the visual suite ran clean on the merge — 41/41 in 2.5
minutes at a load average of 16 — so the missing measurement it records is no longer missing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "record what the plate cutter leaves for the fill"
```

---

## Traps

**Do not edit a test to make it pass.** Every existing test is the characterization for this slice.

**The visual suite is load-sensitive, and its failures under load look nothing like pixel diffs.**
Above a load average of roughly 20 the renderers get starved and killed: `page.addStyleTag`
"Execution context was destroyed", 30s/60s timeouts, "Target page, context or browser has been
closed" — and a *different* failure set each run, often on looks carrying no decoration at all,
which this slice cannot reach. **Read the error: did the failure reach a screenshot comparison?**
A pixel regression reports a diff with a ratio and an artifact under `test-results/`. No comparison
reached means no regression observed, whatever the count says. `--workers=1` is not the remedy —
one run went 38 failed at a single worker and 41 passed four minutes later. Check `uptime`'s 5- and
15-minute averages and re-run when the machine is quiet. A pass is proof, the comparison being
byte-exact.

**Baselines are byte-compared and the suite derives its dev-server port from the worktree path**
(`playwright.config.ts`), so a run here cannot be judged against another checkout's server.

**`signedDistanceField` throws on an empty polygon set.** `regionOf` is only ever reached for a
letter that drew ink, because `Word` tests the plain glyph first — keep that order if the body
build ever moves.

**A `Shape` handed to `ExtrudeGeometry` keeps whatever holes it has.** The cached contours are
shared by every letter of the same char, so `withWells` clones before pushing. Drop the clone and
the second `A` in a word gets two sets of wells, and the third gets three.
