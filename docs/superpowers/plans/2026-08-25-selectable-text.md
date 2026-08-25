# Selectable Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give klieg's WebGL-rendered text a DOM representation, so it can be copied, found with Ctrl+F, read by a screen reader, indexed — and, opt-in, selected by dragging across the glyphs.

**Architecture:** One `FireOptions.selectable: 'hidden' | 'layer' | 'none'` (default `'hidden'`). `Stage` owns a container element that is a sibling of the canvas. `'hidden'` puts one visually-hidden node in it; `'layer'` puts per-letter transparent spans in it, positioned by a pure projection function from the layout klieg already computes. The layer is shown only while the word sits at its layout positions, and rebuilt whenever the layout, the fit, or the canvas box changes.

**Tech Stack:** TypeScript, three.js, opentype.js, vitest (node environment — no DOM), Playwright.

**Read first:** `docs/superpowers/specs/2026-08-25-selectable-text-design.md`.

---

## Background the implementer needs

**Units.** Glyphs are built at 1 em (`const EM = 1` in `render/word.ts`) with `DEFAULT_GLYPH_OPTIONS.depth = 0.3`, so extrusion depth is **0.3 em**, not 0.3 world units. `applyFit` sets `group.scale = fit.scale` and `group.position.y = -fit.midY * fit.scale`. So for letter `i`:

- world x = `baseX[i] * fit.scale`
- world y = `(baseY[i] - fit.midY) * fit.scale`
- the front face of every letter sits at world z = `+(0.3 / 2) * fit.scale`

**Two mechanisms, two questions.** They are not redundant:

- `slotMovesLetters` (Task 3) answers *"should this caller get a layer at all"* — once, at fire time, so a caller who asked for `'layer'` with `active: 'float'` is **told** instead of silently getting nothing.
- `Word.atRest()` (Task 5) answers *"is right now a moment when the layer is aligned"* — every frame, covering the enter, the exit, and a stage tween.

Without the first, a moving effect fails silently. Without the second, the layer sits over letters that are still flying in.

**No DOM in vitest.** `vitest.config.ts` sets `environment: 'node'`. Every unit test below is pure. `TextLayer` (Task 7) is verified by Playwright in Task 10 — do not add jsdom.

**Commands:** `npm test` (vitest), `npm run test:visual` (Playwright), `npm run check` (lint + typecheck + test).

---

## File Structure

**Create:**
- `packages/core/src/text/projection.ts` — pure em-to-pixel map. No DOM, no three.
- `packages/core/src/text/font-face.ts` — registers the fetched font bytes as a CSS face; returns the family name.
- `packages/core/src/text/dom-layer.ts` — `TextLayer`, the only file that touches layer DOM.
- `packages/core/test/text/projection.test.ts`
- `packages/core/test/text/font-face.test.ts`

**Modify:**
- `packages/core/src/text/font.ts` — keep the `ArrayBuffer` on `LoadedFont`.
- `packages/core/src/motion/compositor.ts` — add `slotMovesLetters`.
- `packages/core/src/render/word.ts` — add `readout()`, `atRest()`, `layoutVersion`.
- `packages/core/src/render/stage.ts` — add `layerCss`, create/remove the container.
- `packages/core/src/index.ts` — the `selectable` option and its wiring.
- `apps/lab/index.html`, `apps/lab/src/main.ts` — a control to drive the Playwright tests.
- `apps/lab/test/visual.spec.ts` — the browser tests.
- `README.md`, `CHANGELOG.md`.

---

### Task 1: `LoadedFont` keeps its bytes

The layer needs the same `ArrayBuffer` for `new FontFace(...)`. `loadFont` currently drops it after parsing.

**Files:**
- Modify: `packages/core/src/text/font.ts`

- [ ] **Step 1: Add the field and populate it**

In `packages/core/src/text/font.ts`, add to `LoadedFont`:

```ts
export interface LoadedFont {
  font: Font;
  unitsPerEm: number;
  metrics: GlyphMetrics;
  /** The fetched file, kept so a CSS `FontFace` can reuse it instead of downloading again. */
  bytes: ArrayBuffer;
}
```

and return it from `loadFont`:

```ts
  return { font, unitsPerEm: font.unitsPerEm, metrics, bytes };
```

- [ ] **Step 2: Run the suite to find every stub that now fails to typecheck**

Run: `npm run typecheck`
Expected: errors in test files whose `stubFont()` builds a `LoadedFont` literal (at minimum `packages/core/test/render/word.test.ts`).

- [ ] **Step 3: Fix each stub**

Add `bytes: new ArrayBuffer(0),` to every failing `LoadedFont` literal. The stubs never register a face, so an empty buffer is honest.

- [ ] **Step 4: Verify**

Run: `npm run check`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/text/font.ts packages/core/test
git commit -m "keep the fetched font bytes on LoadedFont"
```

---

### Task 2: The projection

A pure function from layout to pixel boxes. Both traps in the spec live here.

**Files:**
- Create: `packages/core/src/text/projection.ts`
- Test: `packages/core/test/text/projection.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/text/projection.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { type ProjectionInput, projectLetters } from '../../src/text/projection.js';

const UPEM = 1000;

/** A 90° lens at z = 1 sees exactly 2 world units of height, so px-per-world is height / 2. */
function input(over: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    chars: ['A'],
    x: [0],
    y: [0],
    fit: { scale: 1, midY: 0 },
    fov: 90,
    cameraZ: 1,
    depth: 0,
    width: 800,
    height: 400,
    ascender: 800,
    descender: -200,
    unitsPerEm: UPEM,
    ...over,
  };
}

describe('projectLetters', () => {
  it('scales one em to the pixels one world unit covers', () => {
    // vh = 2 * tan(45°) * 1 = 2; pxPerWorld = 400 / 2 = 200. One em is fit.scale world units.
    expect(projectLetters(input()).fontSize).toBeCloseTo(200, 6);
    expect(projectLetters(input({ fit: { scale: 0.5, midY: 0 } })).fontSize).toBeCloseTo(100, 6);
  });

  it('puts a letter at the layout origin on the canvas centre line', () => {
    const box = projectLetters(input()).boxes[0];
    expect(box?.left).toBeCloseTo(400, 6);
  });

  it('carries the layout x across, scaled by the fit', () => {
    const boxes = projectLetters(input({ chars: ['A', 'B'], x: [0, 0.5], y: [0, 0] })).boxes;
    // 0.5 em * fit.scale 1 = 0.5 world units = 100px right of centre.
    expect(boxes[1]?.left).toBeCloseTo(500, 6);
  });

  it('flips the y axis: a lower layout row lands further down the page', () => {
    const boxes = projectLetters(input({ chars: ['A', 'B'], x: [0, 0], y: [0, -1] })).boxes;
    expect((boxes[1]?.top ?? 0) - (boxes[0]?.top ?? 0)).toBeCloseTo(200, 6);
  });

  it('centres the block vertically through fit.midY, as applyFit does', () => {
    const centred = projectLetters(input({ y: [0.5], fit: { scale: 1, midY: 0.5 } })).boxes[0];
    const origin = projectLetters(input()).boxes[0];
    expect(centred?.top).toBeCloseTo(origin?.top ?? 0, 6);
  });

  it('places the box top a baseline above, not at, the letter position', () => {
    // fontSize 200; content height = (800 + 200)/1000 * 200 = 200, so halfLeading = 0.
    // Baseline sits ascender/upem * fontSize = 160px below the box top.
    const box = projectLetters(input()).boxes[0];
    expect(box?.top).toBeCloseTo(200 - 160, 6);
  });

  it('adds half-leading when the font does not fill its em box', () => {
    // content height = (800 + 0)/1000 * 200 = 160, so halfLeading = (200 - 160)/2 = 20.
    const box = projectLetters(input({ descender: 0 })).boxes[0];
    expect(box?.top).toBeCloseTo(200 - 20 - 160, 6);
  });

  it('projects at the extruded front face, not the word plane', () => {
    // depth 0.3 em at fit.scale 1 puts the front face 0.15 nearer: vh = 2 * 0.85 = 1.7.
    const near = projectLetters(input({ depth: 0.3 }));
    expect(near.fontSize).toBeCloseTo(400 / 1.7, 6);
    expect(near.fontSize).toBeGreaterThan(projectLetters(input()).fontSize);
  });

  it('keeps the char alongside each box', () => {
    expect(projectLetters(input({ chars: ['Q'] })).boxes[0]?.char).toBe('Q');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run packages/core/test/text/projection.test.ts`
Expected: FAIL — cannot resolve `../../src/text/projection.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/text/projection.ts`:

```ts
/** Where one letter's CSS box goes, in pixels from the canvas box's top-left. */
export interface LetterBox {
  char: string;
  left: number;
  top: number;
}

export interface ProjectionInput {
  chars: readonly string[];
  /** Layout x per letter, in em, as `Word` holds it. */
  x: readonly number[];
  /** Layout y per letter, in em, before the block's vertical centring. */
  y: readonly number[];
  fit: { scale: number; midY: number };
  /** Vertical field of view, in degrees. */
  fov: number;
  cameraZ: number;
  /** Extrusion depth in em. */
  depth: number;
  /** The canvas CSS box, not its drawing buffer. */
  width: number;
  height: number;
  /** Font units, from the opentype face. */
  ascender: number;
  descender: number;
  unitsPerEm: number;
}

export interface Projection {
  fontSize: number;
  boxes: LetterBox[];
}

/**
 * The em-to-pixel map for a front-on, untransformed word. Every letter shares one z, so this is a
 * uniform scale and a translate rather than a per-frame matrix.
 */
export function projectLetters(input: ProjectionInput): Projection {
  // The front face, not the word plane: a letter is extruded toward the camera by half its depth.
  const faceZ = input.cameraZ - (input.depth / 2) * input.fit.scale;
  const vh = 2 * Math.tan((input.fov * Math.PI) / 360) * faceZ;
  const pxPerWorld = input.height / vh;
  const fontSize = input.fit.scale * pxPerWorld;

  // CSS positions a box top; the layout gives a baseline. At line-height 1 the gap is the
  // half-leading plus the ascender.
  const contentHeight = ((input.ascender - input.descender) / input.unitsPerEm) * fontSize;
  const baselineFromTop =
    (fontSize - contentHeight) / 2 + (input.ascender / input.unitsPerEm) * fontSize;

  const boxes = input.chars.map((char, i) => {
    const worldX = (input.x[i] ?? 0) * input.fit.scale;
    const worldY = ((input.y[i] ?? 0) - input.fit.midY) * input.fit.scale;
    return {
      char,
      left: input.width / 2 + worldX * pxPerWorld,
      top: input.height / 2 - worldY * pxPerWorld - baselineFromTop,
    };
  });

  return { fontSize, boxes };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/core/test/text/projection.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/text/projection.ts packages/core/test/text/projection.test.ts
git commit -m "map a laid-out word from em to canvas pixels"
```

---

### Task 3: Does this slot move the letters?

The fire-time question. `MotionPiece.offset` is pure, so sample it.

**Files:**
- Modify: `packages/core/src/motion/compositor.ts`
- Test: `packages/core/test/motion/compositor.test.ts` (create if absent — check first with `ls packages/core/test/motion/`)

- [ ] **Step 1: Write the failing test**

Append to the motion compositor test file (or create it with the imports shown):

```ts
import { describe, expect, it } from 'vitest';
import { slotMovesLetters } from '../../src/motion/compositor.js';
import type { MotionPiece } from '../../src/motion/types.js';
import { NONE } from '../../src/motion/types.js';

const drift: MotionPiece = { duration: 1000, offset: (t) => ({ position: [0, t, 0] }) };
const tilt: MotionPiece = { duration: 1000, offset: () => ({ rotation: [0, 0.2, 0] }) };
const breathe: MotionPiece = { duration: 1000, offset: (t) => ({ scale: 1 + t * 0.1 }) };
const dim: MotionPiece = { duration: 1000, offset: () => ({ opacity: 0.5 }) };
const perLetter: MotionPiece = {
  duration: 1000,
  offset: (_t, letter) => (letter.index === 3 ? { position: [1, 0, 0] } : {}),
};

describe('slotMovesLetters', () => {
  it('clears a slot that never leaves rest', () => {
    expect(slotMovesLetters(NONE)).toBe(false);
    expect(slotMovesLetters([NONE, NONE])).toBe(false);
  });

  it('catches position, rotation and scale', () => {
    expect(slotMovesLetters(drift)).toBe(true);
    expect(slotMovesLetters(tilt)).toBe(true);
    expect(slotMovesLetters(breathe)).toBe(true);
  });

  it('ignores opacity, which does not move a letter', () => {
    expect(slotMovesLetters(dim)).toBe(false);
  });

  it('catches a layer that moves even when its neighbours do not', () => {
    expect(slotMovesLetters([NONE, drift])).toBe(true);
  });

  it('catches a piece that only moves one letter of the word', () => {
    expect(slotMovesLetters(perLetter)).toBe(true);
  });

  it('catches a constant offset, which misaligns without ever animating', () => {
    expect(slotMovesLetters({ duration: 1000, offset: () => ({ position: [0, 2, 0] }) })).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run packages/core/test/motion/compositor.test.ts`
Expected: FAIL — `slotMovesLetters` is not exported.

- [ ] **Step 3: Write the implementation**

Add to `packages/core/src/motion/compositor.ts`, below `slotDrivesEnv`:

```ts
const SAMPLE_T = [0, 0.17, 0.33, 0.5, 0.67, 0.83, 1];
const SAMPLE_LETTERS = 8;

const shifts = (v: readonly number[] | undefined): boolean =>
  v !== undefined && v.some((n) => n !== 0);

/**
 * Whether a slot puts any letter anywhere but its layout position. Sampled rather than declared:
 * `offset` is a pure function, so a caller's own piece is judged exactly as a built-in is.
 * Opacity is not movement — a fading letter stays where the DOM layer put it.
 */
export function slotMovesLetters(slot: Slot): boolean {
  for (const piece of layers(slot)) {
    for (const t of SAMPLE_T) {
      for (let index = 0; index < SAMPLE_LETTERS; index++) {
        const o = piece.offset(t, { index, count: SAMPLE_LETTERS, line: 0, column: index });
        if (shifts(o.position) || shifts(o.rotation)) return true;
        if (o.scale !== undefined && o.scale !== 1) return true;
      }
    }
  }
  return false;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/core/test/motion/compositor.test.ts`
Expected: PASS.

- [ ] **Step 5: Sanity-check it against the shipped pieces**

Run: `npx vitest run packages/core/test/motion/`
Expected: PASS. Then confirm by hand in a scratch test (do not commit it) that `slotMovesLetters(ACTIVE.float)` is `true` and `slotMovesLetters(ACTIVE.none)` is `false`. If `float` reads as false, the sampler is wrong — stop and re-read `motion/active.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/motion/compositor.ts packages/core/test/motion/compositor.test.ts
git commit -m "sample a motion slot for whether it moves letters off their layout"
```

---

### Task 4: The CSS font face

**Files:**
- Create: `packages/core/src/text/font-face.ts`
- Test: `packages/core/test/text/font-face.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/text/font-face.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { familyFor } from '../../src/text/font-face.js';

describe('familyFor', () => {
  it('is stable for one url', () => {
    expect(familyFor('/fonts/anton.woff2')).toBe(familyFor('/fonts/anton.woff2'));
  });

  it('separates two fonts', () => {
    expect(familyFor('/fonts/anton.woff2')).not.toBe(familyFor('/fonts/bebas.woff2'));
  });

  it('is a bare CSS identifier, so it needs no quoting in a font-family', () => {
    expect(familyFor('/fonts/Anton Regular (1).woff2')).toMatch(/^klieg-[a-z0-9]+$/);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run packages/core/test/text/font-face.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/text/font-face.ts`:

```ts
/** The CSS family name klieg registers a font under. Deterministic, so two instances share one. */
export function familyFor(url: string): string {
  let h = 2166136261;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `klieg-${(h >>> 0).toString(36)}`;
}

const registered = new Set<string>();

/**
 * Registers the already-fetched bytes as a CSS face and returns its family. There is no second
 * download. Returns null where the browser has no `FontFace`, which leaves the layer unbuilt
 * rather than mispositioned against a fallback face.
 */
export async function registerFace(url: string, bytes: ArrayBuffer): Promise<string | null> {
  const family = familyFor(url);
  if (registered.has(family)) return family;
  if (typeof FontFace === 'undefined' || !globalThis.document?.fonts) return null;

  try {
    const face = new FontFace(family, bytes);
    await face.load();
    document.fonts.add(face);
    registered.add(family);
    return family;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/core/test/text/font-face.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/text/font-face.ts packages/core/test/text/font-face.test.ts
git commit -m "register the fetched font bytes as a CSS face"
```

---

### Task 5: What `Word` has to tell the layer

Three additions: the live layout, whether the letters are at it, and a counter that changes when a regroup re-lays them. `Word` is internal to the package — it is not exported from `index.ts` — so these are package-public, not consumer-public.

**Files:**
- Modify: `packages/core/src/render/word.ts`
- Test: `packages/core/test/render/word.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/render/word.test.ts`, inside the existing top-level scope (reuse the file's `stubFont`, `makeWord` or equivalent helper — read the file's existing helpers first and match them):

```ts
describe('readout', () => {
  it('reports one entry per live letter, with the fit that maps em to world', () => {
    const word = makeWord('AB');
    const out = word.readout();
    expect(out.chars).toEqual(['A', 'B']);
    expect(out.x).toHaveLength(2);
    expect(out.y).toHaveLength(2);
    expect(out.fit.scale).toBeGreaterThan(0);
  });

  it('drops a letter a regroup retired', () => {
    const word = makeWord('AB');
    word.regroup((l) => l.index === 0);
    expect(word.readout().chars).toEqual(['A']);
  });
});

describe('atRest', () => {
  it('is true for a word nothing has posed', () => {
    expect(makeWord('AB').atRest()).toBe(true);
  });

  it('is false while a piece holds a letter off its layout position', () => {
    const word = makeWord('AB');
    const shove: MotionPiece = { duration: 100, offset: () => ({ position: [0, 1, 0] }) };
    word.apply(new Timeline({ enter: shove, active: NONE, exit: NONE, hold: 100, blendMs: 0 }), 0);
    expect(word.atRest()).toBe(false);
  });

  it('is false part-way through a fit tween and true once it settles', () => {
    const word = makeWord('ABC');
    word.regroup((l) => l.index < 2);
    word.setFitProgress(0.5);
    expect(word.atRest()).toBe(false);
    word.setFitProgress(1);
    expect(word.atRest()).toBe(true);
  });
});

describe('layoutVersion', () => {
  it('changes when a regroup re-lays the letters', () => {
    const word = makeWord('ABC');
    const before = word.layoutVersion;
    word.regroup((l) => l.index < 2);
    expect(word.layoutVersion).not.toBe(before);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run packages/core/test/render/word.test.ts`
Expected: FAIL — `readout`, `atRest` and `layoutVersion` do not exist.

- [ ] **Step 3: Write the implementation**

In `packages/core/src/render/word.ts`, add a field beside the other layout state:

```ts
  /** Bumped by every regroup, so a DOM layer can tell it is built against a stale layout. */
  layoutVersion = 0;
```

Bump it at the end of `regroup()`, immediately before `return { kept, dropped, delta }`:

```ts
    this.layoutVersion++;
```

Add these two methods as public members (place them next to `letterInfo`):

```ts
  /** The live letters' layout, in em, with the fit that maps em to world units. */
  readout(): { chars: string[]; x: number[]; y: number[]; fit: Fit } {
    const chars: string[] = [];
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < this.charOf.length; i++) {
      if (this.leavingAt(i)) continue;
      chars.push(this.charOf[i] as string);
      x.push(this.baseX[i] as number);
      y.push(this.baseY[i] as number);
    }
    return { chars, x, y, fit: { ...this.fit } };
  }

  /**
   * Whether every live letter sits exactly where the layout puts it, fit included. The DOM text
   * layer is only aligned while this holds — through an enter, an exit or a stage tween it does not.
   */
  atRest(): boolean {
    if (this.fit.scale !== this.fitTo.scale || this.fit.midY !== this.fitTo.midY) return false;
    for (let i = 0; i < this.letters.length; i++) {
      const cell = this.letters[i];
      if (!cell || this.leavingAt(i)) continue;
      if (cell.position.x !== this.baseX[i] || cell.position.y !== this.baseY[i]) return false;
      if (cell.position.z !== 0) return false;
      if (cell.rotation.x !== 0 || cell.rotation.y !== 0 || cell.rotation.z !== 0) return false;
      if (cell.scale.x !== 1) return false;
    }
    return true;
  }
```

**Read `buildCell` and `apply` before writing `atRest`.** The check above assumes a cell's `position` is set to `baseX/baseY` plus the pose offset and its `scale` is set from pose scale. If the code stores those differently — a nested group, a pose offset applied to `inner`, a y already carrying `fit.midY` — match what `apply` actually writes and adjust both the method and the test. Getting this wrong makes the layer appear during motion, which is exactly the bug the spec is trying to avoid.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/core/test/render/word.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/word.ts packages/core/test/render/word.test.ts
git commit -m "let a word report its live layout and whether it sits at it"
```

---

### Task 6: `Stage` owns the container

**Files:**
- Modify: `packages/core/src/render/stage.ts`
- Test: `packages/core/test/render/stage.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/render/stage.test.ts`:

```ts
describe('layerCss', () => {
  it('is click-through at the container, so only a span can take a click', () => {
    expect(layerCss({ kind: 'fullscreen' })).toContain('pointer-events:none');
    expect(layerCss({ kind: 'element', el: null as unknown as HTMLElement })).toContain(
      'pointer-events:none',
    );
  });

  it('sits one above the canvas when fullscreen, and stacks by paint order when anchored', () => {
    expect(layerCss({ kind: 'fullscreen' })).toContain('z-index:2147483001');
    expect(layerCss({ kind: 'element', el: null as unknown as HTMLElement })).not.toContain(
      'z-index',
    );
  });

  it('covers the same box the canvas does', () => {
    for (const css of [layerCss({ kind: 'fullscreen' }), canvasCss({ kind: 'fullscreen' })]) {
      expect(css).toContain('inset:0');
    }
  });
});
```

Add `layerCss` to the file's import list from `../../src/render/stage.js`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run packages/core/test/render/stage.test.ts`
Expected: FAIL — `layerCss` is not exported.

- [ ] **Step 3: Write the implementation**

In `packages/core/src/render/stage.ts`, beside the existing CSS constants:

```ts
// One above the canvas: the layer must take a click on a letter, and the canvas must not shade it.
const FULLSCREEN_LAYER_CSS =
  'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483001';
// No z-index, for the reason ANCHORED_CSS gives; appended after the canvas, so paint order stacks it.
const ANCHORED_LAYER_CSS = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';

export function layerCss(placement: Placement): string {
  return placement.kind === 'element' ? ANCHORED_LAYER_CSS : FULLSCREEN_LAYER_CSS;
}
```

Add a field to `Stage` beside `canvas`:

```ts
  textLayer: HTMLElement | null = null;
```

In `mount()`, immediately after the `appendChild(canvas)` line:

```ts
    const layer = document.createElement('div');
    layer.style.cssText = layerCss(this.placement);
    (anchor ?? this.opts.target ?? document.body).appendChild(layer);
    this.textLayer = layer;
```

In `unmount()`, capture it alongside the others (`const layer = this.textLayer;`), null the field with the rest (`this.textLayer = null;`), and remove it in the `finally` block beside `canvas?.remove()`:

```ts
      layer?.remove();
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/core/test/render/stage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/stage.ts packages/core/test/render/stage.test.ts
git commit -m "give the stage a DOM text layer beside its canvas"
```

---

### Task 7: `TextLayer`

The only file that writes layer DOM. No unit test — vitest has no DOM here; Task 10 covers it.

**Files:**
- Create: `packages/core/src/text/dom-layer.ts`

- [ ] **Step 1: Write the implementation**

Create `packages/core/src/text/dom-layer.ts`:

```ts
import type { LetterBox } from './projection.js';

/** How the word appears in the DOM. Exactly one of these is ever present at a time. */
export type SelectableMode = 'hidden' | 'layer' | 'none';

// Clipped rather than `visibility:hidden` or `display:none`, both of which take the text out of
// find-in-page, selection and the accessibility tree — which is the whole point of this node.
const HIDDEN_CSS =
  'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;' +
  'clip:rect(0 0 0 0);clip-path:inset(50%);white-space:pre;border:0';

const SPAN_CSS =
  'position:absolute;color:transparent;white-space:pre;line-height:1;' +
  'transform-origin:0 0;pointer-events:auto;user-select:text';

/** What a built layer was built against. Any change to it makes the layer stale. */
export interface LayerKey {
  version: number;
  width: number;
  height: number;
  scale: number;
  midY: number;
}

const sameKey = (a: LayerKey | null, b: LayerKey): boolean =>
  a !== null &&
  a.version === b.version &&
  a.width === b.width &&
  a.height === b.height &&
  a.scale === b.scale &&
  a.midY === b.midY;

/**
 * The word's DOM representation, inside the container `Stage` owns. `'hidden'` is one clipped node;
 * `'layer'` is one transparent span per letter, positioned over the glyph it names.
 */
export class TextLayer {
  private built: LayerKey | null = null;

  constructor(private readonly container: HTMLElement) {}

  /** The tier-1 node: the whole fired string, once, never rebuilt. */
  setHidden(text: string): void {
    this.clear();
    const node = document.createElement('span');
    node.style.cssText = HIDDEN_CSS;
    node.textContent = text;
    this.container.appendChild(node);
  }

  /** True when the layer is missing or built against a layout, fit or canvas box that has moved. */
  isStale(key: LayerKey): boolean {
    return !sameKey(this.built, key);
  }

  setLayer(boxes: readonly LetterBox[], fontSize: number, family: string, key: LayerKey): void {
    this.clear();
    for (const box of boxes) {
      if (box.char.trim() === '') continue;
      const span = document.createElement('span');
      span.style.cssText = SPAN_CSS;
      span.style.left = `${box.left}px`;
      span.style.top = `${box.top}px`;
      span.style.fontSize = `${fontSize}px`;
      span.style.fontFamily = family;
      span.textContent = box.char;
      this.container.appendChild(span);
    }
    this.built = key;
  }

  /** Hides the layer without dropping it: through a tween the letters are simply not where it is. */
  setVisible(on: boolean): void {
    this.container.style.visibility = on ? '' : 'hidden';
  }

  clear(): void {
    this.container.replaceChildren();
    this.container.style.visibility = '';
    this.built = null;
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run check`
Expected: PASS. (`TextLayer` is unused until Task 8 — that is fine, it is exported.)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/text/dom-layer.ts
git commit -m "build the word's DOM text, hidden or as an aligned layer"
```

---

### Task 8: Wire it into `fire`

**Files:**
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/index.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/index.test.ts`, reusing the file's existing harness (its `stubFont`, its clock, and whatever it already stubs for `document`/WebGL — read the top of the file and the nearest existing `createKlieg` test and match them exactly):

```ts
describe('selectable', () => {
  it('warns and falls back to hidden when a transform would misalign the layer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const klieg = createKlieg(baseOptions());
    void klieg.fire('AB', { selectable: 'layer', transform: fromEuler(0, 0.3, 0) });
    await flush();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('transform'));
    warn.mockRestore();
    klieg.destroy();
  });

  it('warns and falls back to hidden when the active motion moves the letters', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const klieg = createKlieg(baseOptions());
    void klieg.fire('AB', { selectable: 'layer', active: 'float' });
    await flush();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('float'));
    warn.mockRestore();
    klieg.destroy();
  });

  it('says nothing for a still word', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const klieg = createKlieg(baseOptions());
    void klieg.fire('AB', { selectable: 'layer', enter: 'none', active: 'none' });
    await flush();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    klieg.destroy();
  });

  it('says nothing when the caller did not ask for a layer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const klieg = createKlieg(baseOptions());
    void klieg.fire('AB', { active: 'float' });
    await flush();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    klieg.destroy();
  });
});
```

Replace `baseOptions()` with whatever the file already uses to build `KliegOptions` for a firing test. The second test's `expect.stringContaining('float')` requires the warning to name the cause — if naming the piece is not reachable, assert on `'motion'` instead and make the message say it.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run packages/core/test/index.test.ts -t selectable`
Expected: FAIL — `selectable` is not a known property.

- [ ] **Step 3: Add the option**

In `packages/core/src/index.ts`, add to `FireOptions`:

```ts
  /**
   * How the word appears in the DOM, so it can be copied, found and read aloud. `'hidden'` is one
   * visually-hidden node; `'layer'` adds a transparent per-letter layer a drag can select, and
   * takes a click on a letter instead of passing it through; `'none'` adds nothing, for a page
   * whose own markup already carries this text.
   *
   * `'layer'` needs the word still — it falls back to `'hidden'` under a `transform` or a motion
   * piece that moves the letters. Defaults to `'hidden'`.
   */
  selectable?: SelectableMode;
```

Import and re-export the type near the other type exports:

```ts
export type { SelectableMode } from './text/dom-layer.js';
```

- [ ] **Step 4: Resolve the mode and warn**

In `run()`, after `if (opts.transform) word.transform = opts.transform;` and after `active` is resolved (move this below the `const active = resolveSlot(...)` line):

```ts
    const asked = opts.selectable ?? 'hidden';
    const blocker = opts.transform
      ? 'a transform'
      : slotMovesLetters(active)
        ? `the active motion (${describeSlot(opts.active ?? 'none')})`
        : null;
    if (asked === 'layer' && blocker) {
      console.warn(
        `klieg: selectable 'layer' needs the word still, and ${blocker} moves it — falling back to 'hidden'`,
      );
    }
    const mode: SelectableMode = asked === 'layer' && blocker ? 'hidden' : asked;
```

with, beside `resolveSlot`:

```ts
/** Names a slot for a diagnostic; a caller's own piece has no name to give. */
function describeSlot(slot: EnterSlot | ActiveSlot | ExitSlot): string {
  if (typeof slot === 'string') return slot;
  if (Array.isArray(slot)) return slot.map(describeSlot).join(' + ');
  return 'a custom piece';
}
```

Add `slotMovesLetters` to the existing import from `./motion/compositor.js`.

- [ ] **Step 5: Build the DOM text**

Still in `run()`, after `stage.scene.add(word.group);`:

```ts
    const container = stage.textLayer;
    const layer = container ? new TextLayer(container) : null;
    let family: string | null = null;
    if (layer && mode === 'hidden') layer.setHidden(text);
    if (layer && mode === 'layer') {
      // The hidden node goes up first and is replaced once the face is ready, so the word is never
      // absent from the DOM — and a browser with no `FontFace` keeps it rather than getting nothing.
      layer.setHidden(text);
      void registerFace(options.fontUrl, loaded.bytes).then((f) => {
        family = f;
      });
    }
```

The tick in Step 6 replaces that node with the spans on the first frame the word is at rest — `setLayer` calls `clear()` first, so exactly one text source is ever in the DOM.

Add the imports:

```ts
import { registerFace } from './text/font-face.js';
import { type SelectableMode, TextLayer } from './text/dom-layer.js';
import { projectLetters } from './text/projection.js';
import { DEFAULT_GLYPH_OPTIONS } from './text/glyphs.js';
```

- [ ] **Step 6: Drive it per frame**

In the `clock.subscribe` callback, immediately after `word.apply(driver, elapsed);`:

```ts
          if (layer && mode === 'layer' && family) {
            const rest = word.atRest();
            layer.setVisible(rest);
            if (rest) {
              const canvas = stage.canvas;
              const readout = word.readout();
              const key = {
                version: word.layoutVersion,
                width: canvas?.clientWidth ?? 0,
                height: canvas?.clientHeight ?? 0,
                scale: readout.fit.scale,
                midY: readout.fit.midY,
              };
              if (layer.isStale(key)) {
                const projected = projectLetters({
                  ...readout,
                  fov: stage.camera.fov,
                  cameraZ: stage.camera.position.z,
                  depth: DEFAULT_GLYPH_OPTIONS.depth,
                  width: key.width,
                  height: key.height,
                  ascender: loaded.font.ascender,
                  descender: loaded.font.descender,
                  unitsPerEm: loaded.unitsPerEm,
                });
                layer.setLayer(projected.boxes, projected.fontSize, family, key);
              }
            }
          }
```

- [ ] **Step 7: Tear it down**

In `settle()`, beside `stage.scene.remove(word.group);`:

```ts
        layer?.clear();
```

- [ ] **Step 8: Run the tests**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/index.ts packages/core/test/index.test.ts
git commit -m "add the selectable option and build the word's DOM text from it"
```

---

### Task 9: A lab control

The Playwright tests in Task 10 need a way to ask for a mode.

**Files:**
- Modify: `apps/lab/index.html`, `apps/lab/src/main.ts`

- [ ] **Step 1: Add the control**

In `apps/lab/index.html`, beside the `wrap` checkbox (search for `id="wrap"`), add:

```html
        <label>selectable
          <select id="selectable">
            <option value="hidden" selected>hidden</option>
            <option value="layer">layer</option>
            <option value="none">none</option>
          </select>
        </label>
```

- [ ] **Step 2: Wire it**

In `apps/lab/src/main.ts`: add `const selectableInput = el<HTMLSelectElement>('selectable');` beside `wrapInput` (line ~55); add `'selectable'` to the persisted-control list (the array containing `'wrap'`, `'holdClick'`, line ~127) if that list drives state restore; and add to the `FireOptions` the lab builds (beside `wrap: wrapInput.checked`, line ~354):

```ts
    selectable: selectableInput.value as 'hidden' | 'layer' | 'none',
```

- [ ] **Step 3: Verify by hand**

Run: `npm run dev --workspace apps/lab` (or the lab's own dev script — check `apps/lab/package.json`), open it, set enter `none` / active `none` / hold `4000`, pick `layer`, fire, and drag across the word. Expect a selection highlight on the letters and a copyable string.

If the highlight is offset from the glyphs, the fault is in Task 2's baseline or depth term — fix it there, not with a fudge factor here.

- [ ] **Step 4: Commit**

```bash
git add apps/lab/index.html apps/lab/src/main.ts
git commit -m "drive the selectable modes from the lab"
```

---

### Task 10: The browser tests

**Files:**
- Modify: `apps/lab/test/visual.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/lab/test/visual.spec.ts`:

```ts
async function fireSelectable(page: Page, mode: string, text = 'BIG'): Promise<void> {
  await page.goto('/');
  await page.locator('#enter').selectOption('none');
  await page.locator('#active').selectOption('none');
  await page.locator('#hold').fill('4000');
  await page.locator('#text').fill(text);
  await page.locator('#selectable').selectOption(mode);
  await page.getByRole('button', { name: 'FIRE', exact: true }).click();
  await expect(page.locator('canvas')).toBeAttached();
  await page.waitForTimeout(300);
}

test('the hidden node puts the word in the DOM without a layer', async ({ page }) => {
  await fireSelectable(page, 'hidden');
  expect(await page.evaluate(() => document.body.innerText.includes('BIG'))).toBe(true);
});

test('none puts no klieg text in the page at all', async ({ page }) => {
  await fireSelectable(page, 'none');
  // #text holds 'BIG' as an input value, which innerText does not carry.
  expect(await page.evaluate(() => document.body.innerText.includes('BIG'))).toBe(false);
});

test('a drag across the layer selects the word', async ({ page }) => {
  await fireSelectable(page, 'layer');

  const box = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('span')].filter(
      (s) => getComputedStyle(s).color === 'rgba(0, 0, 0, 0)',
    );
    if (spans.length === 0) return null;
    const first = spans[0].getBoundingClientRect();
    const last = spans[spans.length - 1].getBoundingClientRect();
    return {
      x1: first.left + 2,
      y1: first.top + first.height / 2,
      x2: last.right - 2,
      y2: last.top + last.height / 2,
    };
  });
  expect(box, 'the layer built no spans').not.toBeNull();
  if (!box) return;

  await page.mouse.move(box.x1, box.y1);
  await page.mouse.down();
  await page.mouse.move(box.x2, box.y2, { steps: 10 });
  await page.mouse.up();

  expect((await page.evaluate(() => window.getSelection()?.toString() ?? '')).trim()).toBe('BIG');
});

test('the layer sits over the glyphs it names', async ({ page }) => {
  await fireSelectable(page, 'layer');

  // A span's centre must land inside the canvas box, and the run of spans must span a sane
  // fraction of it — a projection off by the depth or baseline term fails this without a
  // pixel-perfect reference.
  const fit = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const spans = [...document.querySelectorAll('span')].filter(
      (s) => getComputedStyle(s).color === 'rgba(0, 0, 0, 0)',
    );
    if (!canvas || spans.length === 0) return null;
    const c = canvas.getBoundingClientRect();
    const first = spans[0].getBoundingClientRect();
    const last = spans[spans.length - 1].getBoundingClientRect();
    return {
      widthFrac: (last.right - first.left) / c.width,
      centredY: Math.abs((first.top + first.height / 2 - c.top) / c.height - 0.5),
    };
  });
  expect(fit).not.toBeNull();
  expect(fit?.widthFrac).toBeGreaterThan(0.2);
  expect(fit?.widthFrac).toBeLessThan(1);
  expect(fit?.centredY).toBeLessThan(0.15);
});

test('a letter in the layer takes the click the page would otherwise get', async ({ page }) => {
  await fireSelectable(page, 'layer');
  const target = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('span')].filter(
      (s) => getComputedStyle(s).color === 'rgba(0, 0, 0, 0)',
    );
    if (spans.length === 0) return null;
    const r = spans[0].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  expect(target).not.toBeNull();
  if (!target) return;
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
      target,
    ),
  ).toBe('SPAN');
});
```

- [ ] **Step 2: Run them**

Run: `npm run test:visual`
Expected: the new tests pass, **and the existing `'the overlay does not intercept clicks meant for the page beneath it'` test still passes** — it fires under the default mode, which builds no layer. If that test now fails, the container is taking pointer events; re-check `layerCss` in Task 6.

- [ ] **Step 3: Commit**

```bash
git add apps/lab/test/visual.spec.ts
git commit -m "cover selection, alignment and the layer's click capture in the browser"
```

---

### Task 11: Document it

**Files:**
- Modify: `README.md`, `CHANGELOG.md`

- [ ] **Step 1: README**

Add a short section near the other `FireOptions` prose. Match the file's voice — read a neighbouring section first.

```markdown
### Selectable, findable, readable text

klieg draws its letters in WebGL, so by default nothing it renders can be copied, found with
Ctrl+F, or read by a screen reader. Every fire puts the word in the DOM to fix that:

```js
klieg.fire('CONGRATULATIONS', { selectable: 'layer' });
```

- `'hidden'` (default) — one visually-hidden node carrying the word. Copy, find and screen readers
  work; the glyphs themselves do not highlight.
- `'layer'` — a transparent letter-shaped layer over the type, so dragging across it selects it.
  A click on a letter is taken by the layer instead of passing through to the page. Needs the word
  still: under a `transform`, or a motion piece that moves the letters, it falls back to `'hidden'`
  and says so in the console.
- `'none'` — no DOM text, for a page whose own markup already carries this string.
```

- [ ] **Step 2: CHANGELOG**

Add under `## Unreleased`, in the style of the entries already there:

```markdown
### The rendered word now exists in the DOM

klieg created exactly one element — a `pointer-events:none` canvas — so its text was invisible to
copy-paste, Ctrl+F, screen readers and crawlers. Every fire now puts the word in the DOM as well,
through `selectable`: `'hidden'` (the default) is a visually-hidden node, `'layer'` is a
transparent per-letter layer a drag can select, and `'none'` opts out for a page whose own markup
already carries the string. `'layer'` accepts pointer events on the letters themselves, so it is
opt-in; the click-through guarantee is unchanged for every other caller. It also needs the word
still, and falls back to `'hidden'` with a console warning under a `transform` or a motion piece
that moves the letters.
```

- [ ] **Step 3: Verify**

Run: `npm run check`
Expected: PASS, `readme.test.ts` included.

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "document the selectable option"
```

---

## Done when

- `npm run check` and `npm run test:visual` both pass.
- A drag across the word in the lab under `'layer'` highlights the glyphs and copies the string.
- Firing with `active: 'float'` and `selectable: 'layer'` prints one warning and still leaves the
  word findable with Ctrl+F.
- The existing click-through test passes untouched.
