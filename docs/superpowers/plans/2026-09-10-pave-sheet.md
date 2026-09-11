# Pavé by sheet — implementation plan

**Status: built** 2026-09-10 on branch `pave-compare`, commits `215beb7..9b78145`; the full-suite
gate in Task 9 has not run yet. The code departs from this text where review found problems: the
sheet has an ordinary-text floor, the stones hang off a carrier at the letter's origin, and the
body fades by dither. The code is the reference. The decision this builds, and what was ruled out,
is in [the handoff](../HANDOFF.md#pavé-by-sheet--2026-09-10).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pave` renders as one baked pavé sheet shown through each letter, front and back, under a
thin raised rim on the seam, built by a registered `'sheet'` decoration instead of carved wells.

**Architecture:** A new decoration kind, `'sheet'`, takes a well's numbers. Its builder asks
`WordCaches` for one baked sheet per spec: the plate and its stones over an em rectangle that
covers the word's widest glyphs, grown in 0.25 em steps and shared across fires. Each letter's body
is the plain extruded glyph. Its material is patched to discard both caps wherever the letter's
distance-field mask says the sheet shows. The sheet's metal and the rim hang off the body mesh on
that same material, told apart by a per-vertex `aSheet` attribute, so every write the body gets
(fade, lamp, tint) lands on them too. The stones are the one part the builder contributes, on a
per-letter material with its own mask. The back face is the same sheet and rim mirrored through
the letter's middle. Each sheet copy discards everything behind that middle plane, so the two
copies never overlap.

**Tech Stack:** TypeScript, three 0.185 (`onBeforeCompile` shader patching, half-float
`DataTexture`), `polygon-clipping` for the rim, vitest.

**Out of scope:** individual stones or cells as addressable effect parts. Each letter's stones
are one `'chunk'` part carrying `fill: 'stone'`, as `pave`'s are today. Inflated solids also stay
out: `tiara` keeps the carved `'well'` path, and a sheet refuses an inflated letter.

---

## Before you start

- Branch `pave-compare`, worktree `.claude/worktrees/pave-compare`. Run `git branch --show-current`
  first. Stage explicit paths; never `git add -A`.
- `npm` and `npx` are broken in this harness: use `command npm …` or `node_modules/.bin/<tool>`.
- **Run only the one test file you touched** while iterating, e.g.
  `node_modules/.bin/vitest run packages/core/test/render/wells/sheet.test.ts`. The full suite is
  Task 9's gate and nothing earlier.
- Lint each file you touch before committing: `node_modules/.bin/biome check --write <paths>`.
- Do not touch `apps/lab/test/looks.spec.ts` or any visual baseline. No baseline shoots `pave`.
- The prototype this replaces is `apps/lab/pave-compare/sheet.ts`. Read it once; Task 8 deletes it.

## File map

| File | Change | Responsibility |
|---|---|---|
| `packages/core/src/render/decoration.ts` | modify | `SheetSpec`, and the `DecorationSpec` union |
| `packages/core/src/render/wells/sheet.ts` | create | baking a sheet, a letter's mask and rim, the shader patch |
| `packages/core/src/render/caches.ts` | modify | one sheet per spec across fires; one mask + rim per (font, char) |
| `packages/core/src/render/decorations/sheet.ts` | create | `SheetBuilder`: body, sheet, rim and stones per letter |
| `packages/core/src/render/decorations/registry.ts` | modify | `prime` and `dressBody` hooks; register `'sheet'` |
| `packages/core/src/render/word.ts` | modify | call the two hooks |
| `packages/core/src/render/looks.ts` | modify | `pave` becomes `kind: 'sheet'` |
| `apps/lab/pave-compare/main.ts`, `apps/lab/pave-spin/main.ts` | modify | build both rows through `Word` |
| `apps/lab/pave-compare/sheet.ts` | delete | the prototype |

Tests: create `packages/core/test/render/wells/sheet.test.ts` and
`packages/core/test/render/decorations/sheet.test.ts`; extend `caches.test.ts`, `word.test.ts`,
`looks.test.ts` and `decorations/registry.test.ts`.

---

### Task 1: `SheetSpec` and baking a sheet

**Files:**
- Modify: `packages/core/src/render/decoration.ts:157-166`
- Create: `packages/core/src/render/wells/sheet.ts`
- Test: `packages/core/test/render/wells/sheet.test.ts`

- [ ] **Step 1: Add the spec type**

In `decoration.ts`, after the closing `}` of `WellSpec` (line 157), add:

```ts
/**
 * Pavé as one baked sheet shown through each letter under a thin rim, rather than wells carved into
 * it. Takes a well's numbers for the sheet itself; `insets` has no outline to measure and is unread.
 */
export interface SheetSpec extends Omit<WellSpec, 'kind' | 'cutter'> {
  kind: 'sheet';
  cutter: 'pave';
}
```

and change the union on line 166 to:

```ts
export type DecorationSpec = TubeSpec | ChunkSpec | WellSpec | SheetSpec;
```

- [ ] **Step 2: Write the failing tests**

Create `packages/core/test/render/wells/sheet.test.ts`:

```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { SheetSpec } from '../../../src/render/decoration.js';
import { bakeSheet, CLIP_Z, SHEET_ATTRIBUTE, SHEET_METAL } from '../../../src/render/wells/sheet.js';
import { DEFAULT_GLYPH_OPTIONS } from '../../../src/text/glyphs.js';

/** `pave`'s own numbers at twice the pitch, so a bake costs a quarter of the shipped one. */
const SPEC = {
  kind: 'sheet',
  cutter: 'pave',
  bezel: 0.026,
  floor: 0.07,
  pitch: 0.1,
  wall: 0.012,
  relax: 1,
  edge: 'absorb',
  size: 0.048,
  rimBevel: 0.003,
  rimDrop: 0.003,
  look: {},
  fill: 'stone',
  sink: 0.25,
  facets: 8,
} as const satisfies SheetSpec;

const BOX = new THREE.Box2(new THREE.Vector2(-0.25, -0.25), new THREE.Vector2(0.75, 0.75));

function lowestZ(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position');
  let low = Number.POSITIVE_INFINITY;
  for (let i = 0; i < position.count; i++) low = Math.min(low, position.getZ(i));
  return low;
}

describe('bakeSheet', () => {
  // The plate's own outer chamfer may stand a bevel's width past the box; nothing ever shows it.
  it('covers the box it was asked for', () => {
    const sheet = bakeSheet(BOX, SPEC);
    sheet.shell.computeBoundingBox();
    const box = sheet.shell.boundingBox as THREE.Box3;
    const slack = DEFAULT_GLYPH_OPTIONS.bevelSize + 1e-6;
    for (const [got, want] of [
      [box.min.x, BOX.min.x],
      [box.min.y, BOX.min.y],
    ] as const) {
      expect(got).toBeLessThanOrEqual(want + 1e-6);
      expect(got).toBeGreaterThanOrEqual(want - slack);
    }
    for (const [got, want] of [
      [box.max.x, BOX.max.x],
      [box.max.y, BOX.max.y],
    ] as const) {
      expect(got).toBeGreaterThanOrEqual(want - 1e-6);
      expect(got).toBeLessThanOrEqual(want + slack);
    }
    sheet.dispose();
  });

  it('marks every vertex of its metal as sheet', () => {
    const sheet = bakeSheet(BOX, SPEC);
    const marks = sheet.shell.getAttribute(SHEET_ATTRIBUTE);
    expect(marks.count).toBe(sheet.shell.getAttribute('position').count);
    expect(new Set(marks.array)).toEqual(new Set([SHEET_METAL]));
    sheet.dispose();
  });

  // The back face shows the same sheet turned over, and each copy is clipped at the letter's
  // middle so neither shows through the other. A stone reaching below that plane would be cut.
  it('sets every stone above the plane the sheet is clipped at', () => {
    const sheet = bakeSheet(BOX, SPEC);
    expect(sheet.stones).not.toBeNull();
    expect(lowestZ(sheet.stones as THREE.BufferGeometry)).toBeGreaterThan(CLIP_Z);
    expect(sheet.thickness).toBeGreaterThan(0);
    sheet.dispose();
  });

  it('refuses a floor deep enough to reach the clip plane', () => {
    expect(() => bakeSheet(BOX, { ...SPEC, floor: 0.2 })).toThrow(/floor/);
  });

  it('bakes no stones when no fill is named', () => {
    const { fill: _, ...bare } = SPEC;
    const sheet = bakeSheet(BOX, bare);
    expect(sheet.stones).toBeNull();
    expect(sheet.thickness).toBe(0);
    sheet.dispose();
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `node_modules/.bin/vitest run packages/core/test/render/wells/sheet.test.ts`
Expected: FAIL. The module `wells/sheet.js` does not exist.

- [ ] **Step 4: Write the module**

Create `packages/core/src/render/wells/sheet.ts`:

```ts
import * as THREE from 'three';
import { DEFAULT_GLYPH_OPTIONS } from '../../text/glyphs.js';
import type { SheetSpec, WellSpec } from '../decoration.js';
import { cutterFor } from './cutters.js';
import { fillFor } from './fills.js';
import { regionOf } from './region.js';
import { buildShell, DEFAULT_SHELL, shellPlanes } from './shell.js';

const DEPTH = DEFAULT_GLYPH_OPTIONS.depth;

/**
 * Which surface a vertex of a sheet letter's metal belongs to. The body, the sheet and the rim all
 * draw on the body's one material, so its shader tells them apart by this.
 */
export const SHEET_ATTRIBUTE = 'aSheet';
export const SHEET_BODY = 0;
export const SHEET_METAL = 1;
export const SHEET_RIM = 2;

/** Each copy of the sheet keeps only what is in front of this plane, in its own z. */
export const CLIP_Z = DEPTH / 2;

export function markSheet(geometry: THREE.BufferGeometry, role: number): void {
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute(
    SHEET_ATTRIBUTE,
    new THREE.BufferAttribute(new Float32Array(count).fill(role), 1),
  );
}

export interface BakedSheet {
  /** The em rectangle the sheet covers, in a letter's own space before any slide. */
  readonly box: THREE.Box2;
  /** The plate and its wells, every vertex marked `SHEET_METAL`. */
  readonly shell: THREE.BufferGeometry;
  /** Every stone as one geometry, or null where the spec names no fill. */
  readonly stones: THREE.BufferGeometry | null;
  /** The transmission thickness the fill chose for its stones. */
  readonly thickness: number;
  dispose(): void;
}

/**
 * A pavé plate over `box`, through the same cutter, shell and fill the carved wells use. Baked once
 * per spec and shared by every letter, each of which shows its own patch of it.
 */
export function bakeSheet(box: THREE.Box2, spec: SheetSpec): BakedSheet {
  const well: WellSpec = { ...spec, kind: 'well' };
  const planes = shellPlanes(DEPTH, well.floor, well.bezel);
  if (planes.floorZ <= CLIP_Z) {
    throw new Error(
      `klieg: a sheet's floor of ${well.floor} em reaches past the letter's middle, where it is clipped`,
    );
  }

  const shapes = [
    new THREE.Shape([
      new THREE.Vector2(box.min.x, box.min.y),
      new THREE.Vector2(box.max.x, box.min.y),
      new THREE.Vector2(box.max.x, box.max.y),
      new THREE.Vector2(box.min.x, box.max.y),
    ]),
  ];
  const cut = cutterFor(well.cutter)(shapes, regionOf(shapes, 'uniform'), well);
  const rimDrop = well.rimDrop ?? well.rimBevel ?? DEFAULT_SHELL.rimDrop;
  const shell = buildShell(shapes, cut, {
    ...DEFAULT_SHELL,
    depth: DEPTH,
    bezel: well.bezel,
    rimBevel: well.rimBevel ?? DEFAULT_SHELL.rimBevel,
    rimDrop,
    round: well.round ?? 0,
    roundOuter: well.roundOuter ?? 0,
    crease: well.crease ?? DEFAULT_SHELL.crease,
  }).geometry;
  markSheet(shell, SHEET_METAL);

  let stones: THREE.BufferGeometry | null = null;
  let thickness = 0;
  if (well.fill && cut.seats.length > 0) {
    const filled = fillFor(well.fill)(
      cut.seats,
      {
        material: () => new THREE.MeshPhysicalMaterial(),
        faceZ: planes.faceZ,
        floorZ: planes.floorZ,
        girdleZ: planes.faceZ - rimDrop,
      },
      well,
    );
    // Only the number is kept: every letter makes its own stone material, to carry its own mask.
    thickness = filled.material.thickness;
    filled.material.dispose();
    if (!filled.placed) {
      filled.geometry.dispose();
      shell.dispose();
      throw new Error(`klieg: a sheet needs a fill that places its stones; '${well.fill}' does not`);
    }
    stones = filled.geometry;
  }

  return {
    box: box.clone(),
    shell,
    stones,
    thickness,
    dispose() {
      shell.dispose();
      stones?.dispose();
    },
  };
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `node_modules/.bin/vitest run packages/core/test/render/wells/sheet.test.ts`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
node_modules/.bin/biome check --write packages/core/src/render/decoration.ts packages/core/src/render/wells/sheet.ts packages/core/test/render/wells/sheet.test.ts
git add packages/core/src/render/decoration.ts packages/core/src/render/wells/sheet.ts packages/core/test/render/wells/sheet.test.ts
git commit -m "bake a pavé sheet once over a box, through the wells' own cutter and fill"
```

---

### Task 2: a letter's mask and rim

**Files:**
- Modify: `packages/core/src/render/wells/sheet.ts`
- Test: `packages/core/test/render/wells/sheet.test.ts`

The mask is the glyph's signed distance field, negative inside, as a texture the fragment shader
samples. It is **half-float**, not the prototype's `FloatType`: linear filtering of 32-bit float
textures needs `OES_texture_float_linear`, which many phones lack. Without it the texture reads
0 everywhere and every letter silently renders as plain gold. Half-float filtering is core WebGL2.

- [ ] **Step 1: Write the failing tests**

Add these imports to the top of `sheet.test.ts`:

```ts
import { regionOf } from '../../../src/render/wells/region.js';
import { MASK, SHEET_RIM, sheetLetterOf } from '../../../src/render/wells/sheet.js';
```

(merge `MASK`, `SHEET_RIM` and `sheetLetterOf` into the existing `wells/sheet.js` import), and add
this after the existing `describe` block:

```ts
/** A 0.5 by 0.7 em box, the letter every stub font in these tests draws. */
function boxShapes(): THREE.Shape[] {
  return [
    new THREE.Shape([
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.5, 0),
      new THREE.Vector2(0.5, 0.7),
      new THREE.Vector2(0, 0.7),
    ]),
  ];
}

const FACE_Z = DEFAULT_GLYPH_OPTIONS.depth + DEFAULT_GLYPH_OPTIONS.bevelThickness;

describe('sheetLetterOf', () => {
  it('carries the glyph distance field as a half-float texture the shader can filter', () => {
    const letter = sheetLetterOf(boxShapes());
    expect(letter.mask.type).toBe(THREE.HalfFloatType);
    expect(letter.mask.format).toBe(THREE.RedFormat);
    expect(letter.mask.magFilter).toBe(THREE.LinearFilter);

    const { field } = regionOf(boxShapes(), 'uniform');
    const [originX, originY, emPerCell, size] = letter.xf.toArray();
    expect([originX, originY, emPerCell, size]).toEqual([
      field.originX,
      field.originY,
      field.emPerCell,
      field.size,
    ]);
    // The texel under the middle of the box: deep inside, so negative, and what the field holds.
    const ix = Math.round((0.25 - field.originX) / field.emPerCell);
    const iy = Math.round((0.35 - field.originY) / field.emPerCell);
    const texel = (letter.mask.image.data as Uint16Array)[iy * field.size + ix] as number;
    const depth = THREE.DataUtils.fromHalfFloat(texel);
    expect(depth).toBeLessThan(-0.2);
    expect(depth).toBeCloseTo(field.data[iy * field.size + ix] as number, 3);
    letter.dispose();
  });

  it('seats the rim on the seam between the letter face and the sheet', () => {
    const letter = sheetLetterOf(boxShapes());
    const { field } = regionOf(boxShapes(), 'uniform');
    const position = letter.rim.getAttribute('position');
    expect(position.count).toBeGreaterThan(0);
    for (let i = 0; i < position.count; i++) {
      // Within the bead's half-width and its rounding of the seam, which sits MASK em inside.
      expect(Math.abs(field.sample(position.getX(i), position.getY(i)) + MASK)).toBeLessThan(0.012);
    }
    letter.rim.computeBoundingBox();
    const box = letter.rim.boundingBox as THREE.Box3;
    // Its lower bevel buried in the face, its crown standing just proud of it.
    expect(box.min.z).toBeLessThan(FACE_Z);
    expect(box.max.z).toBeGreaterThan(FACE_Z);
    expect(box.max.z).toBeLessThan(FACE_Z + 0.02);
    letter.dispose();
  });

  it('marks every rim vertex as rim', () => {
    const letter = sheetLetterOf(boxShapes());
    expect(new Set(letter.rim.getAttribute(SHEET_ATTRIBUTE).array)).toEqual(new Set([SHEET_RIM]));
    letter.dispose();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node_modules/.bin/vitest run packages/core/test/render/wells/sheet.test.ts`
Expected: FAIL. `sheetLetterOf` and `MASK` are not exported.

- [ ] **Step 3: Implement**

In `wells/sheet.ts`, add these imports:

```ts
import polygonClipping from 'polygon-clipping';
import { type Field, isoContours } from '../tube/field.js';
import { fromPoints, nest, type Ring, resample, smooth } from './rings.js';
```

(check `Field` is exported from `tube/field.ts`; it is declared `export interface Field` there),
and append to the module:

```ts
/**
 * Where the sheet starts, in em in from the outline: just past the glyph's own rounded bevel. That
 * bevel is 0.038 em wide, wider than `pave`'s bezel, so a sheet starting any sooner floats over it.
 */
export const MASK = DEFAULT_GLYPH_OPTIONS.bevelSize + 0.004;
/** The rim's half-width either side of the seam, before its own bevel rounds it outward. */
const RIM_HALF = 0.002;
const RIM_BEVEL = 0.005;
const RIM_HEIGHT = 0.004;

export interface SheetLetter {
  /** The glyph's signed distance in em, negative inside. */
  readonly mask: THREE.DataTexture;
  /** originX, originY, emPerCell, size: where the mask's texel centers sit in the letter's em. */
  readonly xf: THREE.Vector4;
  /** The bead over the seam between the letter's own face and the sheet, marked `SHEET_RIM`. */
  readonly rim: THREE.BufferGeometry;
  dispose(): void;
}

/** A letter's mask and rim, from its contours. Built once per (font, char); see `WordCaches`. */
export function sheetLetterOf(shapes: readonly THREE.Shape[]): SheetLetter {
  const { field } = regionOf(shapes, 'uniform');
  const half = new Uint16Array(field.data.length);
  for (let i = 0; i < half.length; i++) {
    half[i] = THREE.DataUtils.toHalfFloat(field.data[i] as number);
  }
  const mask = new THREE.DataTexture(
    half,
    field.size,
    field.size,
    THREE.RedFormat,
    THREE.HalfFloatType,
  );
  mask.magFilter = THREE.LinearFilter;
  mask.minFilter = THREE.LinearFilter;
  mask.needsUpdate = true;
  const rim = rimOf(field);
  return {
    mask,
    xf: new THREE.Vector4(field.originX, field.originY, field.emPerCell, field.size),
    rim,
    dispose() {
      mask.dispose();
      rim.dispose();
    },
  };
}

const clean = (ring: { x: number; y: number }[]): Ring => smooth(resample(fromPoints(ring), 0.006), 3);

/** The letter inset by `by` em, as the multipolygon `polygon-clipping` takes. */
function insetOf(field: Field, by: number): Ring[][] {
  return nest(isoContours(field, -by).map(clean));
}

/** The band between two insets either side of the seam, extruded thin and beveled round. */
function rimOf(field: Field): THREE.BufferGeometry {
  const band = polygonClipping.difference(
    insetOf(field, MASK - RIM_HALF) as never,
    insetOf(field, MASK + RIM_HALF) as never,
  );
  const shapes: THREE.Shape[] = [];
  for (const poly of band) {
    const [outer, ...holes] = poly as number[][][];
    if (!outer) continue;
    const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
    shape.holes = holes.map((h) => new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
    shapes.push(shape);
  }
  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth: RIM_HEIGHT,
    bevelEnabled: true,
    bevelThickness: RIM_BEVEL,
    bevelSize: RIM_BEVEL * 0.8,
    bevelSegments: 4,
    curveSegments: 1,
  });
  geometry.translate(0, 0, DEPTH + DEFAULT_GLYPH_OPTIONS.bevelThickness);
  markSheet(geometry, SHEET_RIM);
  return geometry;
}
```

This is the prototype's `maskOf` and `rimOf` from `apps/lab/pave-compare/sheet.ts`, except that
the mask is half-float and the prototype's `field` is not kept, since nothing reads it after the
rim is built. If `nest`, `isoContours`, `resample` or `smooth` have moved or changed signature
since, follow the prototype's current call sites rather than this listing.

- [ ] **Step 4: Run the tests to see them pass**

Run: `node_modules/.bin/vitest run packages/core/test/render/wells/sheet.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
node_modules/.bin/biome check --write packages/core/src/render/wells/sheet.ts packages/core/test/render/wells/sheet.test.ts
git add packages/core/src/render/wells/sheet.ts packages/core/test/render/wells/sheet.test.ts
git commit -m "build a letter's half-float mask and seam rim for the pavé sheet"
```

---

### Task 3: the shader patch

**Files:**
- Modify: `packages/core/src/render/wells/sheet.ts`
- Test: `packages/core/test/render/wells/sheet.test.ts`

Two roles. `body` is the letter's own material, shared by the body, both sheet copies and both rims.
It discards a cap fragment inside the mask, and a sheet fragment outside the mask or behind the clip
plane. It never cuts the rim. `stones` discards stone fragments outside the mask.

Two traps the prototype already hit: the material arrives with `createMaterial`'s flake patch in
`onBeforeCompile`, so the new patch has to chain it; and three keys programs on
`onBeforeCompile.toString()` by default, which is the same text for both roles, so without its own
`customProgramCacheKey` a body and a stone material share one wrong program.

- [ ] **Step 1: Write the failing tests**

Add `import { createMaterial } from '../../../src/render/looks.js';` and merge `maskMaterial`,
`sheetUniforms` into the `wells/sheet.js` import, then append:

```ts
/** Runs a material's patch over a skeleton of three's shaders, as the renderer would. */
function patched(material: THREE.MeshPhysicalMaterial) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: 'void main() {\n#include <beginnormal_vertex>\n#include <begin_vertex>\n}',
    fragmentShader: 'void main() {\n}',
  };
  material.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer);
  return shader;
}

describe('maskMaterial', () => {
  const letter = sheetLetterOf(boxShapes());
  const shift = new THREE.Vector2(-0.1, -0.2);

  it('keeps the patch the material already carried', () => {
    const material = createMaterial(null);
    maskMaterial(material, sheetUniforms(letter, shift), 'body');
    expect(patched(material).vertexShader).toContain('vFlakePos');
  });

  it('tells the body, the sheet and the rim apart by a vertex attribute', () => {
    const body = createMaterial(null);
    maskMaterial(body, sheetUniforms(letter, shift), 'body');
    const stones = createMaterial(null);
    maskMaterial(stones, sheetUniforms(letter, shift), 'stones');
    expect(patched(body).vertexShader).toContain(`attribute float ${SHEET_ATTRIBUTE}`);
    expect(patched(stones).vertexShader).not.toContain(SHEET_ATTRIBUTE);
    expect(patched(body).fragmentShader).toContain('discard');
    expect(patched(stones).fragmentShader).toContain('discard');
  });

  it("hands the shader this letter's own mask and slide", () => {
    const material = createMaterial(null);
    maskMaterial(material, sheetUniforms(letter, shift), 'stones');
    const { uniforms } = patched(material);
    expect(uniforms.uMask?.value).toBe(letter.mask);
    expect((uniforms.uMaskShift?.value as THREE.Vector2).toArray()).toEqual([-0.1, -0.2]);
    expect(uniforms.uMaskLevel?.value).toBe(-MASK);
  });

  it('gives each role its own program, shared by every letter in that role', () => {
    const other = sheetLetterOf(boxShapes());
    const key = (role: 'body' | 'stones', of = letter) => {
      const material = createMaterial(null);
      maskMaterial(material, sheetUniforms(of, shift), role);
      return material.customProgramCacheKey();
    };
    expect(key('body')).toBe(key('body', other));
    expect(key('body')).not.toBe(key('stones'));
    expect(key('body')).not.toBe(createMaterial(null).customProgramCacheKey());
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node_modules/.bin/vitest run packages/core/test/render/wells/sheet.test.ts`
Expected: FAIL. `maskMaterial` and `sheetUniforms` are not exported.

- [ ] **Step 3: Implement**

Append to `wells/sheet.ts`:

```ts
export type SheetRole = 'body' | 'stones';

export interface SheetUniforms {
  uMask: { value: THREE.Texture };
  uMaskXf: { value: THREE.Vector4 };
  uMaskLevel: { value: number };
  /** Where this letter's patch of the sheet sits: sheet space plus this is letter space. */
  uMaskShift: { value: THREE.Vector2 };
  uClipZ: { value: number };
}

export function sheetUniforms(letter: SheetLetter, shift: THREE.Vector2): SheetUniforms {
  return {
    uMask: { value: letter.mask },
    uMaskXf: { value: letter.xf },
    uMaskLevel: { value: -MASK },
    uMaskShift: { value: shift.clone() },
    uClipZ: { value: CLIP_Z },
  };
}

const VARYINGS: Record<SheetRole, string> = {
  body: 'varying vec3 vMkPos;\nvarying vec3 vMkNrm;\nvarying float vSheet;\n',
  stones: 'varying vec3 vMkPos;\n',
};

const WRITES: Record<SheetRole, string> = {
  body: `vMkPos = transformed;\nvMkNrm = objectNormal;\nvSheet = ${SHEET_ATTRIBUTE};`,
  stones: 'vMkPos = transformed;',
};

const UNIFORMS = `uniform sampler2D uMask;
uniform vec4 uMaskXf;
uniform float uMaskLevel;
uniform vec2 uMaskShift;
uniform float uClipZ;
float mkDepthAt(vec2 at) {
  return texture2D(uMask, ((at - uMaskXf.xy) / uMaskXf.z + 0.5) / uMaskXf.w).r;
}
`;

// vSheet is SHEET_BODY, SHEET_METAL or SHEET_RIM, compared at the half-steps between them.
const TESTS: Record<SheetRole, string> = {
  body: `
  if (vSheet < 0.5) {
    if (abs(normalize(vMkNrm).z) > 0.9 && mkDepthAt(vMkPos.xy) <= uMaskLevel) discard;
  } else if (vSheet < 1.5) {
    if (mkDepthAt(vMkPos.xy + uMaskShift) > uMaskLevel || vMkPos.z < uClipZ) discard;
  }`,
  stones: `
  if (mkDepthAt(vMkPos.xy + uMaskShift) > uMaskLevel) discard;`,
};

/** Patches `material` to show the sheet through one letter. See `SheetRole` for what each keeps. */
export function maskMaterial(
  material: THREE.MeshPhysicalMaterial,
  uniforms: SheetUniforms,
  role: SheetRole,
): void {
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    const attribute = role === 'body' ? `attribute float ${SHEET_ATTRIBUTE};\n` : '';
    shader.vertexShader = `${attribute}${VARYINGS[role]}${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n${WRITES[role]}`,
    );
    shader.fragmentShader = `${UNIFORMS}${VARYINGS[role]}${shader.fragmentShader}`.replace(
      'void main() {',
      `void main() {${TESTS[role]}`,
    );
  };
  material.customProgramCacheKey = () => `${key()}|sheet-${role}`;
  material.needsUpdate = true;
}
```

Put a JSDoc on `SheetRole` rather than a comment over the tests: `body` opens both caps over the
sheet, keeps the sheet's metal only inside the mask and in front of `CLIP_Z`, and never cuts the
rim; `stones` keeps stones inside the mask.

- [ ] **Step 4: Run the tests to see them pass**

Run: `node_modules/.bin/vitest run packages/core/test/render/wells/sheet.test.ts`
Expected: 12 passed.

- [ ] **Step 5: Commit**

```bash
node_modules/.bin/biome check --write packages/core/src/render/wells/sheet.ts packages/core/test/render/wells/sheet.test.ts
git add packages/core/src/render/wells/sheet.ts packages/core/test/render/wells/sheet.test.ts
git commit -m "patch a letter's materials to show the pavé sheet through its mask"
```

---

### Task 4: caching the sheet and each letter across fires

**Files:**
- Modify: `packages/core/src/render/caches.ts`
- Test: `packages/core/test/render/caches.test.ts`

One sheet per spec, shared by every word built on the same `WordCaches`. That is how a second
fire of `pave` skips the bake. A need the held sheet does not cover bakes a bigger one over
both. The smaller sheet stays alive until `dispose`, because a word built on it may still be
drawing it. Boxes snap outward to 0.25 em, so two words a hair apart share one bake. The key is the
spec object's identity, the same way `takeBlueprint` keys a tube spec, and `specOf('pave')` hands
back the same object every time.

- [ ] **Step 1: Write the failing tests**

In `caches.test.ts`, add `vi` to the vitest import and these imports:

```ts
import type { SheetSpec } from '../../src/render/decoration.js';
import type { BakedSheet, SheetLetter } from '../../src/render/wells/sheet.js';
```

then append:

```ts
describe('WordCaches.sheet', () => {
  const SPEC = { kind: 'sheet' } as unknown as SheetSpec;
  const box = (x0: number, y0: number, x1: number, y1: number) =>
    new THREE.Box2(new THREE.Vector2(x0, y0), new THREE.Vector2(x1, y1));
  const baker = () => {
    const baked: BakedSheet[] = [];
    const bake = vi.fn((at: THREE.Box2): BakedSheet => {
      const sheet = {
        box: at.clone(),
        shell: new THREE.BufferGeometry(),
        stones: null,
        thickness: 0,
        dispose: vi.fn(),
      };
      baked.push(sheet);
      return sheet;
    });
    return { bake, baked };
  };

  it('bakes once for a spec, whatever inside that sheet later asks', () => {
    const caches = new WordCaches();
    const { bake } = baker();
    const first = caches.sheet(SPEC, box(0, 0, 0.6, 0.7), bake);
    expect(caches.sheet(SPEC, box(0.1, 0.1, 0.5, 0.5), bake)).toBe(first);
    expect(bake).toHaveBeenCalledTimes(1);
  });

  it('snaps the box outward to quarter-em steps', () => {
    const caches = new WordCaches();
    const { bake } = baker();
    const first = caches.sheet(SPEC, box(-0.08, -0.08, 0.88, 1.08), bake);
    expect(first.box.min.toArray()).toEqual([-0.25, -0.25]);
    expect(first.box.max.toArray()).toEqual([1, 1.25]);
    expect(caches.sheet(SPEC, box(-0.1, -0.1, 0.9, 1.1), bake)).toBe(first);
  });

  it('bakes a sheet over both when a need falls outside, and keeps the old one until dispose', () => {
    const caches = new WordCaches();
    const { bake, baked } = baker();
    const small = caches.sheet(SPEC, box(0, 0, 0.5, 0.5), bake);
    const big = caches.sheet(SPEC, box(0, 0, 1.2, 0.5), bake);
    expect(big).not.toBe(small);
    expect(big.box.containsBox(small.box)).toBe(true);
    expect(small.dispose).not.toHaveBeenCalled();
    caches.dispose();
    for (const sheet of baked) expect(sheet.dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps one sheet per spec', () => {
    const caches = new WordCaches();
    const { bake } = baker();
    const other = { kind: 'sheet' } as unknown as SheetSpec;
    expect(caches.sheet(other, box(0, 0, 0.5, 0.5), bake)).not.toBe(
      caches.sheet(SPEC, box(0, 0, 0.5, 0.5), bake),
    );
  });
});

describe('WordCaches.sheetLetter', () => {
  const letter = (): SheetLetter => ({
    mask: new THREE.DataTexture(),
    xf: new THREE.Vector4(),
    rim: new THREE.BufferGeometry(),
    dispose: vi.fn(),
  });

  it('builds once per font and char, and frees each with the caches', () => {
    const caches = new WordCaches();
    const font = stubFont();
    const build = vi.fn(letter);
    const a = caches.sheetLetter(font, 'A', build);
    expect(caches.sheetLetter(font, 'A', build)).toBe(a);
    expect(caches.sheetLetter(font, 'B', build)).not.toBe(a);
    expect(caches.sheetLetter(stubFont(), 'A', build)).not.toBe(a);
    expect(build).toHaveBeenCalledTimes(3);
    caches.dispose();
    expect(a.dispose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node_modules/.bin/vitest run packages/core/test/render/caches.test.ts`
Expected: FAIL. `caches.sheet` is not a function.

- [ ] **Step 3: Implement**

In `caches.ts`, add type imports:

```ts
import type { SheetSpec } from './decoration.js';
import type { BakedSheet, SheetLetter } from './wells/sheet.js';
```

Above the class, add:

```ts
/** A sheet's box grows in steps this big, so two words a hair apart share one bake. */
const SHEET_STEP = 0.25;
const down = (v: number) => Math.floor(v / SHEET_STEP) * SHEET_STEP;
const up = (v: number) => Math.ceil(v / SHEET_STEP) * SHEET_STEP;
```

Add fields beside `onLoan`:

```ts
  private readonly sheets = new Map<number, BakedSheet>();
  /** Sheets a bigger bake replaced. A word built on one may still be drawing it. */
  private readonly outgrown: BakedSheet[] = [];
  private readonly sheetLetters = new Map<string, SheetLetter>();
```

Add methods before `dispose()`:

```ts
  /**
   * The baked sheet for `spec`, covering `need`. One per spec, shared by every letter of every word
   * on these caches; a need the held sheet does not cover bakes one over both.
   */
  sheet(spec: SheetSpec, need: THREE.Box2, bake: (box: THREE.Box2) => BakedSheet): BakedSheet {
    if (this.disposed) throw new Error('klieg: WordCaches used after dispose');
    const key = this.interner.id(spec);
    const held = this.sheets.get(key);
    if (held?.box.containsBox(need)) return held;
    const box = need.clone();
    if (held) box.union(held.box);
    box.min.set(down(box.min.x), down(box.min.y));
    box.max.set(up(box.max.x), up(box.max.y));
    const baked = bake(box);
    if (held) this.outgrown.push(held);
    this.sheets.set(key, baked);
    return baked;
  }

  /** A glyph's sheet mask and rim. Depth is not part of the key: every letter is built at one. */
  sheetLetter(font: LoadedFont, char: string, build: () => SheetLetter): SheetLetter {
    if (this.disposed) throw new Error('klieg: WordCaches used after dispose');
    const key = `${this.interner.id(font)}|${char}`;
    let letter = this.sheetLetters.get(key);
    if (!letter) {
      letter = build();
      this.sheetLetters.set(key, letter);
    }
    return letter;
  }
```

In `dispose()`, before `this.disposed = true;`:

```ts
    for (const sheet of this.sheets.values()) sheet.dispose();
    this.sheets.clear();
    for (const sheet of this.outgrown) sheet.dispose();
    this.outgrown.length = 0;
    for (const letter of this.sheetLetters.values()) letter.dispose();
    this.sheetLetters.clear();
```

`caches.ts` imports three as `import type * as THREE`, which is enough: the new code only calls
methods on `Box2` instances it was handed.

- [ ] **Step 4: Run the tests to see them pass**

Run: `node_modules/.bin/vitest run packages/core/test/render/caches.test.ts`
Expected: all pass, the five new ones among them.

- [ ] **Step 5: Commit**

```bash
node_modules/.bin/biome check --write packages/core/src/render/caches.ts packages/core/test/render/caches.test.ts
git add packages/core/src/render/caches.ts packages/core/test/render/caches.test.ts
git commit -m "cache one pavé sheet per spec and one mask and rim per glyph across fires"
```

---

### Task 5: `SheetBuilder`

**Files:**
- Create: `packages/core/src/render/decorations/sheet.ts`
- Modify: `packages/core/src/render/decorations/registry.ts:12,107`
- Test: `packages/core/test/render/decorations/sheet.test.ts`

The builder has three jobs per letter:
- **Body.** A builder-owned clone of the glyph marked `SHEET_BODY`, answered through
  `bodyGeometry`. The attribute has to be on the geometry: when a program declares an attribute
  the geometry lacks, WebGL reads whatever generic value the context last had at that location,
  and another program's defaults can leave that at 1.
- **Metal.** Through `dressBody(index, char, body)`, the builder patches the body's material in
  role `body`. It hangs four children off the body mesh, all on that material: the sheet slid to
  this letter's patch, the same sheet turned onto the back, the rim, and the rim turned onto the
  back.
- **Stones.** Through `buildLetter`, one stone material per letter in role `stones`. The stone
  mesh sits inside a group that carries the slide, because `Word` writes the part mesh's own
  position every effect frame. The back copy is a child of the front mesh, so it follows the part.

Each letter slides to its own patch by a fixed walk on its slot, so every fire of a word shows the
same patches. `prime(chars)` sizes the sheet for the whole word before any letter is built. Without
it, each wider letter would grow the sheet and pay another bake.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/render/decorations/sheet.test.ts`:

```ts
import type { Font, PathCommand } from 'opentype.js';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WordCaches } from '../../../src/render/caches.js';
import type { SheetSpec } from '../../../src/render/decoration.js';
import type { WordBuildContext } from '../../../src/render/decorations/registry.js';
import { SheetBuilder, SLACK, slideOf } from '../../../src/render/decorations/sheet.js';
import { createMaterial } from '../../../src/render/looks.js';
import { SHEET_ATTRIBUTE, SHEET_BODY } from '../../../src/render/wells/sheet.js';
import type { LoadedFont } from '../../../src/text/font.js';
import { DEFAULT_GLYPH_OPTIONS } from '../../../src/text/glyphs.js';

const DEPTH = DEFAULT_GLYPH_OPTIONS.depth;

/** Box spanning `bottom`..`top` in three's y-up space; opentype paths are y-down. */
function boxPath(w: number, top: number, bottom: number): PathCommand[] {
  return [
    { type: 'M', x: 0, y: -bottom },
    { type: 'L', x: w, y: -bottom },
    { type: 'L', x: w, y: -top },
    { type: 'L', x: 0, y: -top },
    { type: 'Z' },
  ];
}

/** Every char is a 0.5 em wide box rising 0.7 em, except 'W', which is twice as wide. */
function stubFont(): LoadedFont {
  const font = {
    charToGlyph: (char: string) => ({
      advanceWidth: 600,
      getPath: (_x: number, _y: number, size: number) => ({
        commands: boxPath((char === 'W' ? 1 : 0.5) * size, 0.7 * size, 0),
        toPathData: () => 'M0 0',
      }),
    }),
  } as unknown as Font;
  return {
    font,
    unitsPerEm: 1000,
    key: '/f.ttf',
    family: 'klieg-test-sheet',
    metrics: { advanceOf: () => 600, kernOf: () => 0 },
    bytes: new ArrayBuffer(0),
  };
}

/** `pave`'s own numbers at twice the pitch, so a bake costs a quarter of the shipped one. */
const SPEC = {
  kind: 'sheet',
  cutter: 'pave',
  bezel: 0.026,
  floor: 0.07,
  pitch: 0.1,
  wall: 0.012,
  relax: 1,
  edge: 'absorb',
  size: 0.048,
  rimBevel: 0.003,
  rimDrop: 0.003,
  look: {},
  fill: 'stone',
  sink: 0.25,
  facets: 8,
} as const satisfies SheetSpec;

function context(
  inflate?: WordBuildContext['inflate'],
  caches = new WordCaches(),
  font = stubFont(),
): WordBuildContext {
  return {
    font,
    caches,
    inflate,
    baseX: [0, 1],
    baseY: [0, 0],
    studioMaterial: () => createMaterial(null),
    glyph: (char, depth) => caches.glyph(font, char, depth, inflate),
    shapes: (char) => caches.shapes(font, char),
    partInfo: (kind, index, count, slot, at, span, ink, fill) => ({
      kind,
      fill,
      index,
      count,
      letter: { index: slot, count: 2 },
      x: 0,
      y: 0,
      ink: ink ?? { minX: 0, maxX: 0, minY: 0, maxY: 0 },
      at,
      span,
    }),
    meshInk: () => ({ minX: 0, maxX: 0, minY: 0, maxY: 0 }),
  };
}

/** A body the way `Word` makes one: the builder's geometry on a fresh studio material. */
function bodyOf(builder: SheetBuilder, char: string): THREE.Mesh {
  return new THREE.Mesh(builder.bodyGeometry(char, DEPTH), createMaterial(null));
}

describe('SheetBuilder', () => {
  it('answers a body marked as body, one per char', () => {
    const ctx = context();
    const builder = new SheetBuilder(SPEC, ctx);
    const body = builder.bodyGeometry('A', DEPTH);
    expect(body).toBe(builder.bodyGeometry('A', DEPTH));
    expect(body).not.toBe(ctx.glyph('A', DEPTH));
    expect(body.getAttribute('position').count).toBe(
      ctx.glyph('A', DEPTH).getAttribute('position').count,
    );
    expect(new Set(body.getAttribute(SHEET_ATTRIBUTE).array)).toEqual(new Set([SHEET_BODY]));
    builder.dispose();
  });

  it('hangs the sheet and the rim off the body, front and back, on the body material', () => {
    const builder = new SheetBuilder(SPEC, context());
    const body = bodyOf(builder, 'A');
    builder.dressBody(0, 'A', body);
    const [front, back, rim, rimBack] = body.children as THREE.Mesh[];
    expect(body.children).toHaveLength(4);
    for (const child of body.children as THREE.Mesh[]) expect(child.material).toBe(body.material);
    expect(back?.geometry).toBe(front?.geometry);
    expect(rimBack?.geometry).toBe(rim?.geometry);
    for (const turned of [back, rimBack]) {
      expect(turned?.scale.z).toBe(-1);
      expect(turned?.position.z).toBe(DEPTH);
    }
    expect((body.material as THREE.Material).customProgramCacheKey()).toContain('sheet-body');
    builder.dispose();
  });

  it('slides each letter to its own patch of the sheet', () => {
    expect(slideOf(0).equals(slideOf(1))).toBe(false);
    for (let slot = 0; slot < 24; slot++) {
      const { x, y } = slideOf(slot);
      for (const v of [x, y]) {
        expect(v).toBeLessThanOrEqual(0);
        expect(v).toBeGreaterThanOrEqual(-SLACK);
      }
    }
    const builder = new SheetBuilder(SPEC, context());
    const body = bodyOf(builder, 'A');
    builder.dressBody(1, 'A', body);
    const front = body.children[0] as THREE.Mesh;
    expect(front.position.x).toBeCloseTo(slideOf(1).x, 9);
    expect(front.position.y).toBeCloseTo(slideOf(1).y, 9);
    builder.dispose();
  });

  it('contributes one stone part per letter, its back copy riding the front', () => {
    const builder = new SheetBuilder(SPEC, context());
    const sized = new THREE.Group();
    builder.buildLetter(0, 'A', sized, undefined);
    builder.skipLetter(1);
    const parts = builder.collectParts();
    expect(parts).toHaveLength(1);
    expect(parts[0]?.info.kind).toBe('chunk');
    expect(parts[0]?.info.fill).toBe('stone');
    const stones = parts[0]?.mesh as THREE.Mesh;
    expect(stones.parent?.position.x).toBeCloseTo(slideOf(0).x, 9);
    expect(stones.position.toArray()).toEqual([0, 0, 0]);
    expect((stones.children[0] as THREE.Mesh).scale.z).toBe(-1);
    expect((stones.material as THREE.Material).customProgramCacheKey()).toContain('sheet-stones');
    builder.dispose();
  });

  it('sets no stones and contributes no part when no fill is named', () => {
    const { fill: _, ...bare } = SPEC;
    const builder = new SheetBuilder(bare, context());
    const sized = new THREE.Group();
    builder.buildLetter(0, 'A', sized, undefined);
    expect(sized.children).toHaveLength(0);
    expect(builder.collectParts()).toEqual([]);
    builder.dispose();
  });

  it('bakes one sheet for a primed word, wide letter and all', () => {
    const ctx = context();
    const builder = new SheetBuilder(SPEC, ctx);
    builder.prime(['A', 'W', ' ']);
    const primed = ctx.caches.sheet(SPEC, new THREE.Box2(), () => {
      throw new Error('prime should already have baked a sheet');
    });
    const body = bodyOf(builder, 'W');
    builder.dressBody(1, 'W', body);
    expect((body.children[0] as THREE.Mesh).geometry).toBe(primed.shell);
    builder.dispose();
  });

  it('shares the sheet and each letter through the caches, and leaves them there on dispose', () => {
    const caches = new WordCaches();
    const font = stubFont();
    const first = new SheetBuilder(SPEC, context(undefined, caches, font));
    const second = new SheetBuilder(SPEC, context(undefined, caches, font));
    const a = bodyOf(first, 'A');
    const b = bodyOf(second, 'A');
    first.dressBody(0, 'A', a);
    second.dressBody(0, 'A', b);
    const shell = (a.children[0] as THREE.Mesh).geometry;
    expect((b.children[0] as THREE.Mesh).geometry).toBe(shell);
    expect((b.children[2] as THREE.Mesh).geometry).toBe((a.children[2] as THREE.Mesh).geometry);
    first.dispose();
    expect(shell.getAttribute('position').count).toBeGreaterThan(0);
    expect(() => caches.sheet(SPEC, new THREE.Box2(), () => {
      throw new Error('the sheet should still be held');
    })).not.toThrow();
    second.dispose();
  });

  it('refuses an inflated letter, whose crown the sheet would not follow', () => {
    expect(
      () => new SheetBuilder(SPEC, context({ profile: 'cushion', rise: 0.06, reach: 0.08 })),
    ).toThrow(/flat/);
  });
});
```

The `prime` test asks the cache for an empty box on purpose. `Box2.containsBox` of an empty box
is true, so the call answers the primed sheet without baking. If a later three changes that, ask
for a box inside the primed one instead.

- [ ] **Step 2: Run them to see them fail**

Run: `node_modules/.bin/vitest run packages/core/test/render/decorations/sheet.test.ts`
Expected: FAIL. `decorations/sheet.js` does not exist.

- [ ] **Step 3: Write the builder**

Create `packages/core/src/render/decorations/sheet.ts`:

```ts
import * as THREE from 'three';
import type { ResolvedOffset } from '../../effects/types.js';
import { DEFAULT_GLYPH_OPTIONS, GlyphCache } from '../../text/glyphs.js';
import type { SheetSpec } from '../decoration.js';
import { DEFAULT_INFLATE } from '../inflate.js';
import {
  applyLook,
  type FrameOwnedBase,
  frameOwnedBase,
  type LightBase,
  lightBase,
  litEmissive,
} from '../looks.js';
import {
  type BakedSheet,
  bakeSheet,
  markSheet,
  maskMaterial,
  SHEET_BODY,
  type SheetLetter,
  sheetLetterOf,
  sheetUniforms,
} from '../wells/sheet.js';
import type { DecorationBuilder, DecorationPart, WordBuildContext } from './registry.js';

const DEPTH = DEFAULT_GLYPH_OPTIONS.depth;
/** Room past the glyph on every side, so the sheet has whole cells where the mask cuts it. */
const MARGIN = 0.08;
/** How far one letter's patch of the sheet may sit from another's, in em: six cells or so. */
export const SLACK = 0.3;

const frac = (n: number) => n - Math.floor(n);

/** Where letter `slot` sits on the sheet. Fixed per slot, so each fire of a word shows the same. */
export function slideOf(slot: number): THREE.Vector2 {
  return new THREE.Vector2(-SLACK * frac(slot * 0.618034), -SLACK * frac(slot * 0.381966 + 0.1));
}

/** `object` turned onto the letter's back: mirrored through its middle. */
function turned<T extends THREE.Object3D>(object: T): T {
  object.position.z = DEPTH;
  object.scale.z = -1;
  return object;
}

/**
 * Pavé as one baked sheet shown through each letter, front and back, under a rim on the seam.
 *
 * The sheet's metal and the rim draw on the body's own material, hung off the body mesh, so every
 * write the body gets lands on them too. The stones are the one part this contributes.
 */
export class SheetBuilder implements DecorationBuilder {
  /** One marked clone per char, builder-owned; the cache's glyph stays unmarked for other looks. */
  private readonly bodies: GlyphCache<THREE.BufferGeometry>;
  /** Per letter slot, so an effect can reach one letter's stones without its neighbors'. */
  private readonly materials: (THREE.MeshPhysicalMaterial | null)[] = [];
  private readonly meshes: (THREE.Mesh | null)[] = [];
  private readonly lights: (LightBase | null)[] = [];
  private readonly base: FrameOwnedBase;

  constructor(
    private readonly spec: SheetSpec,
    private readonly ctx: WordBuildContext,
  ) {
    if (ctx.inflate && { ...DEFAULT_INFLATE, ...ctx.inflate }.profile !== 'flat') {
      throw new Error("klieg: a 'sheet' decoration needs a flat letter; carve an inflated one with 'well'");
    }
    this.base = frameOwnedBase(spec.stone ?? 'gem');
    this.bodies = new GlyphCache<THREE.BufferGeometry>((char, depth) => {
      const body = ctx.glyph(char, depth).clone();
      markSheet(body, SHEET_BODY);
      return body;
    });
  }

  prime(chars: readonly string[]): void {
    const glyphs = new THREE.Box2();
    for (const char of new Set(chars)) this.cover(glyphs, char);
    if (!glyphs.isEmpty()) this.sheetOver(glyphs);
  }

  bodyGeometry(char: string, depth: number): THREE.BufferGeometry {
    return this.bodies.get(char, depth);
  }

  dressBody(index: number, char: string, body: THREE.Mesh): void {
    const sheet = this.sheetFor(char);
    const letter = this.letterOf(char);
    const shift = slideOf(index);
    const material = body.material as THREE.MeshPhysicalMaterial;
    maskMaterial(material, sheetUniforms(letter, shift), 'body');

    const front = new THREE.Mesh(sheet.shell, material);
    front.position.set(shift.x, shift.y, 0);
    const back = turned(new THREE.Mesh(sheet.shell, material));
    back.position.x = shift.x;
    back.position.y = shift.y;
    body.add(
      front,
      back,
      new THREE.Mesh(letter.rim, material),
      turned(new THREE.Mesh(letter.rim, material)),
    );
  }

  buildLetter(index: number, char: string, sized: THREE.Group, tint: number | undefined): void {
    this.skipLetter(index);
    if (!this.spec.fill) return;
    const sheet = this.sheetFor(char);
    if (!sheet.stones) return;

    const shift = slideOf(index);
    const material = this.ctx.studioMaterial();
    applyLook(material, this.spec.stone ?? 'gem', tint);
    material.thickness = sheet.thickness;
    material.transparent = true;
    material.opacity = this.base.opacity;
    material.emissiveIntensity = this.base.emissiveIntensity;
    maskMaterial(material, sheetUniforms(this.letterOf(char), shift), 'stones');

    const mesh = new THREE.Mesh(sheet.stones, material);
    mesh.add(turned(new THREE.Mesh(sheet.stones, material)));
    const slid = new THREE.Group();
    slid.position.set(shift.x, shift.y, 0);
    slid.add(mesh);
    sized.add(slid);

    this.materials[index] = material;
    this.meshes[index] = mesh;
    this.lights[index] = lightBase(this.spec.stone ?? 'gem', tint);
  }

  skipLetter(index: number): void {
    this.materials[index] = null;
    this.meshes[index] = null;
    this.lights[index] = null;
  }

  /** One part per letter that drew stones, as the carved wells contribute. */
  collectParts(): DecorationPart[] {
    const fields: number[] = [];
    for (let i = 0; i < this.meshes.length; i++) {
      if (this.meshes[i]) fields.push(i);
    }
    return fields.map((slot, n) => ({
      info: this.ctx.partInfo(
        'chunk',
        n,
        fields.length,
        slot,
        n / fields.length,
        1 / fields.length,
        undefined,
        this.spec.fill,
      ),
      mesh: this.meshes[slot] as THREE.Mesh,
      slot,
    }));
  }

  frame(index: number, opacity: number): void {
    const material = this.materials[index];
    if (!material) return;
    material.opacity = opacity * this.base.opacity;
    material.emissiveIntensity = this.base.emissiveIntensity;
    const light = this.lights[index];
    if (light) material.emissive.setHex(light.emissive);
  }

  /** The sheet shows only within its letter, so there is no box of its own. */
  boundsAt(): THREE.Box2 | null {
    return null;
  }

  applyGradientBounds(): void {}

  writePart(part: DecorationPart, out: ResolvedOffset): void {
    const material = part.mesh.material as THREE.MeshPhysicalMaterial;
    const light = this.lights[part.slot];
    if (light) material.emissive.setHex(litEmissive(light.emissive, light.hue, out.light));
    material.emissiveIntensity = this.base.emissiveIntensity * out.gain;
  }

  dispose(): void {
    // The sheet and every mask and rim belong to the caches, which outlive this word.
    this.bodies.dispose();
    for (const material of this.materials) material?.dispose();
    this.materials.length = 0;
    this.meshes.length = 0;
    this.lights.length = 0;
  }

  /** Widens `box` by `char`'s outline; a glyph that drew no ink leaves it alone. */
  private cover(box: THREE.Box2, char: string): void {
    if (!this.ctx.glyph(char, DEPTH).attributes.position?.count) return;
    for (const shape of this.ctx.shapes(char)) {
      for (const point of shape.getPoints(24)) box.expandByPoint(point);
    }
  }

  private sheetFor(char: string): BakedSheet {
    const glyph = new THREE.Box2();
    this.cover(glyph, char);
    return this.sheetOver(glyph);
  }

  /** The shared sheet, grown if it must be to hold `glyphs`, the margin and any letter's slide. */
  private sheetOver(glyphs: THREE.Box2): BakedSheet {
    const need = glyphs.clone().expandByScalar(MARGIN);
    need.max.addScalar(SLACK);
    return this.ctx.caches.sheet(this.spec, need, (box) => bakeSheet(box, this.spec));
  }

  private letterOf(char: string): SheetLetter {
    return this.ctx.caches.sheetLetter(this.ctx.font, char, () =>
      sheetLetterOf(this.ctx.shapes(char)),
    );
  }
}
```

The slide is negative, so a letter shows sheet points up to `SLACK` above and right of its own.
That is why `sheetOver` grows only `need.max`.

- [ ] **Step 4: Register the kind**

In `registry.ts`, add `import { SheetBuilder } from './sheet.js';` beside the other builder
imports, and after the `'well'` registration:

```ts
registerDecoration('sheet', (spec, ctx) => new SheetBuilder(spec, ctx));
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `node_modules/.bin/vitest run packages/core/test/render/decorations/sheet.test.ts`
Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
node_modules/.bin/biome check --write packages/core/src/render/decorations/sheet.ts packages/core/src/render/decorations/registry.ts packages/core/test/render/decorations/sheet.test.ts
git add packages/core/src/render/decorations/sheet.ts packages/core/src/render/decorations/registry.ts packages/core/test/render/decorations/sheet.test.ts
git commit -m "add a sheet decoration: one baked pavé sheet shown through each letter, front and back"
```

---

### Task 6: `Word` calls `prime` and `dressBody`

**Files:**
- Modify: `packages/core/src/render/decorations/registry.ts:53-82`
- Modify: `packages/core/src/render/word.ts:200-204` and `:500-505`
- Test: `packages/core/test/render/word.test.ts`

- [ ] **Step 1: Write the failing tests**

In `word.test.ts`, make sure `vi` is in the vitest import and `WordCaches` is imported (add
`import { WordCaches } from '../../src/render/caches.js';` if absent), add

```ts
import type { SheetSpec } from '../../src/render/decoration.js';
import { SheetBuilder } from '../../src/render/decorations/sheet.js';
```

and append:

```ts
describe('a sheet decoration', () => {
  /** `pave`'s own numbers at twice the pitch, so a bake costs a quarter of the shipped one. */
  const SHEET = {
    kind: 'sheet',
    cutter: 'pave',
    bezel: 0.026,
    floor: 0.07,
    pitch: 0.1,
    wall: 0.012,
    relax: 1,
    edge: 'absorb',
    size: 0.048,
    rimBevel: 0.003,
    rimDrop: 0.003,
    look: {},
    fill: 'stone',
    sink: 0.25,
    facets: 8,
  } as const satisfies SheetSpec;
  const LOOK = { opacity: 1, decoration: SHEET };

  it('hangs the sheet and the rim off every body, on that body material', () => {
    const word = new Word('AB', stubFont(), LOOK, ROOMY);
    for (const body of meshes(word)) {
      expect(body.children).toHaveLength(4);
      for (const child of body.children as THREE.Mesh[]) expect(child.material).toBe(body.material);
    }
    word.dispose();
  });

  it('primes the sheet with every char before any letter is dressed, and bakes it once', () => {
    const prime = vi.spyOn(SheetBuilder.prototype, 'prime');
    const dress = vi.spyOn(SheetBuilder.prototype, 'dressBody');
    const sheet = vi.spyOn(WordCaches.prototype, 'sheet');
    try {
      const word = new Word('Ag', stubFont(), LOOK, ROOMY);
      expect(prime).toHaveBeenCalledWith(['A', 'g']);
      expect(prime.mock.invocationCallOrder[0]).toBeLessThan(
        dress.mock.invocationCallOrder[0] as number,
      );
      expect(new Set(sheet.mock.results.map((r) => r.value)).size).toBe(1);
      word.dispose();
    } finally {
      prime.mockRestore();
      dress.mockRestore();
      sheet.mockRestore();
    }
  });

  it('shares one sheet between words on the same caches', () => {
    const caches = new WordCaches();
    const font = stubFont();
    const make = () => new Word('A', font, LOOK, ROOMY, false, undefined, undefined, null, caches);
    const a = make();
    const b = make();
    const shellOf = (word: Word) => ((meshes(word)[0] as THREE.Mesh).children[0] as THREE.Mesh).geometry;
    expect(shellOf(b)).toBe(shellOf(a));
    a.dispose();
    b.dispose();
    caches.dispose();
  });

  it('contributes one stone part per letter', () => {
    const word = new Word('AB', stubFont(), LOOK, ROOMY);
    expect(word.partsOf('chunk').map((part) => part.fill)).toEqual(['stone', 'stone']);
    word.dispose();
  });
});
```

`'g'` in this file's stub font descends 0.2 em, so its box is not the same as `'A'`'s. If prime
did nothing, the sheet built for `'A'` would not cover `'g'`, and a second bake would show up as
a second distinct sheet.

- [ ] **Step 2: Run them to see them fail**

Run: `node_modules/.bin/vitest run packages/core/test/render/word.test.ts -t "a sheet decoration"`
Expected: FAIL. Bodies have no children, and `prime` is never called.

- [ ] **Step 3: Add the hooks to the interface**

In `registry.ts`, inside `interface DecorationBuilder`, after `skipLetter`:

```ts
  /**
   * Every letter's char in slot order, once, before the first letter is built — for a builder whose
   * shared geometry has to cover the whole word rather than grow letter by letter.
   */
  prime?(chars: readonly string[]): void;
  /**
   * Letter `index`'s body mesh, just made and not yet drawn, before `buildLetter`. A builder may
   * patch its material or hang geometry off it, which then takes every write the body gets.
   */
  dressBody?(index: number, char: string, body: THREE.Mesh): void;
```

- [ ] **Step 4: Call them from `Word`**

In `word.ts`'s constructor, between `this.applyFit(this.fit);` and the `buildCell` loop:

```ts
    this.builder?.prime?.(this.charOf);
```

In `buildCell`, right after `sized.add(bodyMesh);`:

```ts
    this.builder?.dressBody?.(i, char, bodyMesh);
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `node_modules/.bin/vitest run packages/core/test/render/word.test.ts`
Expected: all pass, the four new ones among them.

- [ ] **Step 6: Commit**

```bash
node_modules/.bin/biome check --write packages/core/src/render/decorations/registry.ts packages/core/src/render/word.ts packages/core/test/render/word.test.ts
git add packages/core/src/render/decorations/registry.ts packages/core/src/render/word.ts packages/core/test/render/word.test.ts
git commit -m "let a decoration size itself for the whole word and dress each letter's body"
```

---

### Task 7: `pave` ships as the sheet

**Files:**
- Modify: `packages/core/src/render/looks.ts:311-358`
- Test: `packages/core/test/render/looks.test.ts`, `packages/core/test/render/decorations/registry.test.ts`

- [ ] **Step 1: Write the failing tests**

In `looks.test.ts`, after `it('builds sequin from the chunks generator', …)`:

```ts
  it('builds pave from one baked sheet, and keeps the carved wells for tiara', () => {
    expect(specOf('pave').decoration?.kind).toBe('sheet');
    expect(specOf('tiara').decoration?.kind).toBe('well');
  });
```

In `registry.test.ts`, in `'has a factory registered for each shipped kind'`, add:

```ts
    expect(decorationBuilderFor(specOf('pave').decoration, wordContext())).not.toBeNull();
```

- [ ] **Step 2: Run them to see them fail**

Run: `node_modules/.bin/vitest run packages/core/test/render/looks.test.ts`
Expected: FAIL. `expected 'well' to be 'sheet'`.

- [ ] **Step 3: Switch the look**

In `looks.ts`, replace the JSDoc above `pave` with:

```ts
  /**
   * Four candidates for what the wells line ships as. `pave` shows one baked sheet through each
   * letter; `tiara` carves the same wells into an inflated solid, `bezel` swaps the cutter, and
   * `carved` names no fill at all.
   */
```

In `pave.decoration`, change `kind: 'well',` to `kind: 'sheet',`, and delete the `insets` line
and the two comment lines above it. A sheet's region is a rectangle, so `insets` has nothing to
measure. Leave every other number alone: they are the numbers the sheet was judged on.

- [ ] **Step 4: Run the tests to see them pass**

Run: `node_modules/.bin/vitest run packages/core/test/render/looks.test.ts packages/core/test/render/decorations/registry.test.ts`
Expected: all pass.

- [ ] **Step 5: Typecheck**

Run: `node_modules/.bin/tsc -b`
Expected: no errors. If the lab fails here because `specOf('pave').decoration` is no longer a
`WellSpec`, that is Task 8's work: fix it there and typecheck again at the end of Task 8.

- [ ] **Step 6: Commit**

```bash
node_modules/.bin/biome check --write packages/core/src/render/looks.ts packages/core/test/render/looks.test.ts packages/core/test/render/decorations/registry.test.ts
git add packages/core/src/render/looks.ts packages/core/test/render/looks.test.ts packages/core/test/render/decorations/registry.test.ts
git commit -m "ship pave as the baked sheet instead of carved wells"
```

---

### Task 8: the labs build through `Word`, and a look at it

**Files:**
- Modify: `apps/lab/pave-compare/main.ts`, `apps/lab/pave-spin/main.ts`
- Delete: `apps/lab/pave-compare/sheet.ts`

Both labs keep the carved wells as their comparison row, now built from an explicit well spec,
because `specOf('pave')` is the sheet.

- [ ] **Step 1: Rewrite `pave-spin/main.ts`**

```ts
/**
 * A whole phrase spinning in pavé two ways, frame by frame: the carved wells `pave` used to be
 * above, the baked sheet it is now below. `spikes/pave-spin.mjs` pulls the frames.
 *
 *   /pave-spin/                    'FUCK YOU' over 'TRAVIS'
 *   /pave-spin/#ANY%20TEXT
 */
import * as THREE from 'three';
import { WordCaches } from '../../../packages/core/src/render/caches.js';
import type { SheetSpec } from '../../../packages/core/src/render/decoration.js';
import { buildEnvironment } from '../../../packages/core/src/render/environment.js';
import { type Look, type LookSpec, specOf } from '../../../packages/core/src/render/looks.js';
import { Word } from '../../../packages/core/src/render/word.js';
import { loadFont } from '../../../packages/core/src/text/font.js';
import { fromEuler } from '../../../packages/core/src/transform.js';

const TEXT = decodeURIComponent(location.hash.slice(1)) || 'FUCK YOU\nTRAVIS';
const W = 1280;
const H = 720;
const ENV: [number, number] = [0.35, 0.6];

const PAVE = specOf('pave');
/** The carved wells `pave` shipped as before the sheet: the same numbers, cut into each letter. */
const WELLS: LookSpec = {
  ...PAVE,
  decoration: { ...(PAVE.decoration as SheetSpec), kind: 'well', insets: 'proportional' },
};

async function main(): Promise<void> {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x0a0a0a);
  const env = buildEnvironment(renderer).texture;

  const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 100);
  camera.position.set(0, 0, 11);
  const vh = 2 * Math.tan((19 * Math.PI) / 180) * 11;
  const vw = (vh * W) / H;
  const budget = {
    width: vw * 0.84,
    height: vh * 0.8,
    cameraZ: 11,
    extent: vw,
    cap: Number.POSITIVE_INFINITY,
  };
  const loaded = await loadFont('/font.ttf');

  const build = (look: Look, caches?: WordCaches) => {
    const t = performance.now();
    const word = new Word(TEXT, loaded, look, budget, false, undefined, undefined, env, caches);
    const ms = performance.now() - t;
    word.setEnvRotation(...ENV);
    return { word, ms };
  };
  const wells = build(WELLS);
  // Twice on one set of caches: the first fire bakes the sheet, the second should not.
  const caches = new WordCaches();
  const cold = build('pave', caches);
  cold.word.dispose();
  const sheet = build('pave', caches);

  const scenes = [wells.word, sheet.word].map((word) => {
    const scene = new THREE.Scene();
    scene.environment = env;
    scene.add(word.group);
    return scene;
  });

  const out = document.createElement('canvas');
  out.width = W;
  out.height = H * 2;
  document.body.appendChild(out);
  const g = out.getContext('2d') as CanvasRenderingContext2D;
  const labels = [
    `carved wells — ${wells.ms.toFixed(0)}ms`,
    `sheet — ${cold.ms.toFixed(0)}ms first fire, ${sheet.ms.toFixed(0)}ms the next`,
  ];

  const draw = (scene: THREE.Scene, top: number, label: string) => {
    // Twice: transmission reads the frame before, so the first render of a pose shows the last.
    renderer.render(scene, camera);
    renderer.render(scene, camera);
    g.drawImage(canvas, 0, top);
    g.fillStyle = '#ffd479';
    g.font = '20px ui-monospace, monospace';
    g.fillText(label, 20, top + 34);
  };

  Object.assign(globalThis, {
    frame(k: number, n: number): string {
      const turn = fromEuler(0, (2 * Math.PI * k) / n, 0);
      wells.word.transform = turn;
      sheet.word.transform = turn;
      draw(scenes[0] as THREE.Scene, 0, labels[0] as string);
      draw(scenes[1] as THREE.Scene, H, labels[1] as string);
      return out.toDataURL('image/jpeg', 0.92);
    },
    READY: { wellsMs: wells.ms, sheetColdMs: cold.ms, sheetWarmMs: sheet.ms },
  });
}

void main();
```

`insets: 'proportional'` goes back into the wells row because Task 7 dropped it from `pave`, and
the carved wells were judged with it.

- [ ] **Step 2: Rewrite `pave-compare/main.ts`**

Keep the file's header, `LETTER`, `ANGLES`, `TILE`, `DEG`, `ENV`, the `Row` interface, `asRow`,
and the whole render loop from `const grid = …` to the end. Make these changes:

- Delete the imports of `DEFAULT_GLYPH_OPTIONS` and of `./sheet.js`. Add
  `import type { SheetSpec } from '../../../packages/core/src/render/decoration.js';` and
  `type LookSpec` to the `looks.js` import.
- Replace the `REAL` / `decoration` constants with:

```ts
/** The shipped look, which is now the sheet, and the carved wells it replaced, on the same numbers. */
const PAVE = specOf('pave');
const decoration = PAVE.decoration as SheetSpec;
const WELLS: LookSpec = {
  ...PAVE,
  decoration: { ...decoration, kind: 'well', insets: 'proportional' },
};
```

  and in `FAKE`, read `PAVE.color` and `PAVE.roughness` where it read `REAL.color` and
  `REAL.roughness`.
- In `main()`, replace everything from `status.textContent = \`building '${LETTER}' as real
  geometry…\`` through the `const rows: Row[] = [...]` literal with:

```ts
  status.textContent = `building '${LETTER}' three ways…`;
  await tick();
  let t = performance.now();
  const wells = new Word(LETTER, loaded, WELLS, budget, false, undefined, undefined, env);
  const wellsMs = performance.now() - t;

  t = performance.now();
  const fake = new Word(LETTER, loaded, FAKE_BODY, budget, false, undefined, undefined, env);
  fake.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) paintPave(mesh.material as THREE.MeshPhysicalMaterial, FAKE);
  });
  const fakeMs = performance.now() - t;

  t = performance.now();
  const sheet = new Word(LETTER, loaded, 'pave', budget, false, undefined, undefined, env);
  const sheetMs = performance.now() - t;

  const rows: Row[] = [
    asRow(`carved wells — built in ${wellsMs.toFixed(0)}ms`, wells),
    asRow(`shader — built in ${fakeMs.toFixed(0)}ms`, fake),
    asRow(`sheet — built in ${sheetMs.toFixed(0)}ms, sheet baked in that`, sheet),
  ];
```

  Keep the `fromEuler` import: the render loop still turns each row with it.

- [ ] **Step 3: Delete the prototype**

```bash
git rm apps/lab/pave-compare/sheet.ts
```

- [ ] **Step 4: Typecheck and lint**

Run: `node_modules/.bin/tsc -b && node_modules/.bin/biome check --write apps/lab/pave-compare apps/lab/pave-spin`
Expected: clean. If `rg -n "pave-compare/sheet" apps spikes` finds anything else still importing
the prototype, point it at `Word` the same way.

- [ ] **Step 5: Render it and look**

Start the lab in the background (Bash `run_in_background: true`), unless something already
listens on :5192:

```bash
lsof -iTCP:5192 -sTCP:LISTEN || command npm run dev -w @klieg/lab -- --port 5192 --strictPort --host '::'
```

Then:

```bash
node spikes/pave-compare.mjs R "$SCRATCH/pave-R.png"
node spikes/pave-compare.mjs B "$SCRATCH/pave-B.png"
node spikes/pave-spin.mjs "$SCRATCH/spin" 96
~/src/slopboard/bin/slop --zone klieg "$SCRATCH/pave-R.png" "$SCRATCH/pave-B.png" "$SCRATCH/spin/strip.jpg"
```

Here `$SCRATCH` is the session's scratchpad directory. Pass `--zone klieg`, because from a
worktree `slop` files under the worktree's name. Check each of these, and write down which ones
held:

- **Face on (0°):** the sheet row matches the prototype's. Stones show through every letter, a
  rim runs the seam, and no counter shows a hole into the letter.
- **84°:** no sheet floats over the bevel, and no gold cap shows inside the rim.
- **The back (180°, `strip.jpg`'s fifth frame):** stones, not bare gold. No shimmer where the
  two sheet copies meet, and no flat plane showing inside the wells.
- **Neighbors:** two letters of the same char, such as the Us in the default phrase, show
  different patches.
- **Timing:** `READY` (printed by the spin spike as `built: {…}`): `sheetWarmMs` should be far
  under `sheetColdMs`. That is the cross-fire cache working.

A failed check is a bug to find with superpowers:systematic-debugging before going on, not a
note for later.

- [ ] **Step 6: Stop the lab if you started it**

```bash
lsof -tiTCP:5192 -sTCP:LISTEN | xargs kill
```

Only if this session started it: stop servers by port, and never by pattern.

- [ ] **Step 7: Commit**

```bash
git add apps/lab/pave-compare/main.ts apps/lab/pave-spin/main.ts
git commit -m "build both pavé labs through Word and drop the hand-built sheet prototype"
```

(`git rm` in Step 3 already staged the deletion.)

---

### Task 9: record it, and the gate

**Files:**
- Modify: `docs/superpowers/HANDOFF.md`, this plan

- [ ] **Step 1: Update the handoff**

In "Pavé by sheet — 2026-09-10", replace the **Next** paragraph and its list with a statement of
what is built. `pave` is a `'sheet'` decoration, and the sheet is cached per spec across fires.
Give the Step 5 timings from Task 8. List what stays open: stones as individual parts, and one
known cost. Every letter draws the whole sheet's vertices twice (front and back), and the
fragment test throws most of them away. Say it is unmeasured unless you measured it. In "Where
it is", drop the prototype paragraph's reference to `sheet.ts`.

- [ ] **Step 2: Mark this plan built**

Change the **Status** line at the top of this file to `**Status: built** on <date>, commits
<first>..<last>.`

- [ ] **Step 3: The gate**

The full suite runs once here, and only on a quiet box. Check first:

```bash
uptime
pgrep -fl vitest
```

If another vitest is running, or the 1-minute load average is above roughly the core count,
don't run it. Stop and report that the gate is pending, and why. Otherwise:

```bash
command npm run check
```

Expected: lint, typecheck and every test green. A timeout in a file this branch did not touch,
on a loaded box, is contention, not a regression. Report it with the diff's reach, and do not
re-run.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/HANDOFF.md docs/superpowers/plans/2026-09-10-pave-sheet.md
git commit -m "record the pavé sheet as built"
```
