# Framing Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `Framing` an `align`, so an anchored word can sit its painted edge against the anchor's edge instead of floating centered in it. Closes issue #2.

**Architecture:** `width`/`height` keep their one job — capping the fit's scale. `align` is separate and measures the word's **painted extent** against the **whole box**, not against the framing budget: `'start'` puts the leftmost ink on the box's left edge at whatever size the fit chose. The offset rides in `Fit` alongside `midY`, so it lerps through a regroup and reaches the DOM text layer by the same path.

**Tech Stack:** TypeScript, three.js, vitest.

---

## Background the implementer needs

**The obvious implementation is wrong, and its test would pass.** "Give the fit's leftover slack to one side" — which is what issue #2 proposes — is a no-op for the caller who asked for it.

The reporting consumer (michaelbaker.tech, a masthead strip) passes `{ width: 0.78, height: 0.55 }` into an anchor of roughly 439×86 CSS px. Measured against the real font:

```
byWidth 3.87   byHeight 5.28   → WIDTH-bound, 36% headroom
```

The width axis binds, so the fit leaves **zero** horizontal slack. What the consumer compensates for with a 43px asymmetric padding is not slack — it is the framing inset itself, `(1 − 0.78) / 2 × 439px = 48.3px`, which is why it drifts with the strip's width (the name, the font size) exactly as the issue reports. Widening to `width: 1` to manufacture slack scales the sign **28% larger**, because width is the binding axis: that trades a position bug for a size bug.

Hence the semantics below. Two consequences to hold on to:

1. **Alignment measures against `extent` — the full visible width at the word's depth — not against `budget.width`.** `budget.width` is `extent × widthFrac`. Aligning inside the budget box reintroduces the inset the feature exists to remove.
2. **Alignment measures painted geometry, not advances.** `placeBlock` spans the edge glyphs' *advances* (`text/placement.ts:72`), which overshoots the ink by a side bearing — 3.0px for `M` at the masthead, 4.4px if the name started with `I`. That residue is the same per-name rot in miniature. The fit keeps using the advance span (changing it would rescale every existing caller); alignment uses `boundingBox.min.x` / `max.x`, which `Word` already reads for the y axis.

`'center'` must stay byte-identical for every existing caller — it contributes no offset at all rather than a computed zero.

Vertical alignment is deliberately absent. The issue says it has not been wanted, and a symmetrical `Framing.alignY` can be added later without moving anything this plan writes.

---

## File Structure

- Modify: `packages/core/src/text/layout.ts` — `Align`, and the two `Budget` fields alignment needs
- Modify: `packages/core/src/text/placement.ts` — `Fit.offsetX`, computed in `fitOf` from painted bounds
- Modify: `packages/core/src/render/word.ts` — collect x bounds, apply/lerp/compare the offset
- Modify: `packages/core/src/text/projection.ts` — shift the DOM letter boxes by it
- Modify: `packages/core/src/render/stage.ts` — `viewportBudget` reports `extent` and carries `align`
- Modify: `packages/core/src/index.ts` — `Framing.align`, threaded to `viewportBudget`
- Modify: `README.md`, `CHANGELOG.md` — document the option
- Test: `packages/core/test/text/placement.test.ts`, `test/render/word.test.ts`,
  `test/text/projection.test.ts`, `test/render/stage.test.ts`, `test/index.test.ts`

`fitOf` grows from four positional arguments to three by taking the per-glyph bounds as one object;
six loose parallel arrays at a call site is where a caller silently swaps x for y.

---

### Task 1: `fitOf` computes an alignment offset from the painted extent

**Files:**
- Modify: `packages/core/src/text/layout.ts`
- Modify: `packages/core/src/text/placement.ts:81-117`
- Test: `packages/core/test/text/placement.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/text/placement.test.ts`:

```ts
describe('fitOf alignment', () => {
  /** Boxes 0.5 em wide on a 0.6 em advance, so paint and advance disagree by one side bearing. */
  const bounds = (n: number) => ({
    minX: Array(n).fill(0),
    maxX: Array(n).fill(0.5),
    minY: Array(n).fill(0),
    maxY: Array(n).fill(0.7),
  });

  it('leaves a centred word at the origin', () => {
    const fit = fitOf(place('AB'), bounds(2), { width: 1.2, height: 100, extent: 4 });
    expect(fit.offsetX).toBe(0);
    expect(fitOf(place('AB'), bounds(2), { width: 1.2, height: 100, extent: 4, align: 'center' }).offsetX).toBe(0);
  });

  it('puts the leftmost paint on the box edge for start', () => {
    const fit = fitOf(place('AB'), bounds(2), { width: 1.2, height: 100, extent: 4, align: 'start' });
    // 'AB' spans 1.2 em of advance into a 1.2-wide budget, so scale is 1; the left origin is -0.6.
    expect(fit.scale).toBeCloseTo(1, 6);
    expect(fit.offsetX + -0.6 * fit.scale).toBeCloseTo(-2, 6);
  });

  it('puts the rightmost paint on the box edge for end', () => {
    const fit = fitOf(place('AB'), bounds(2), { width: 1.2, height: 100, extent: 4, align: 'end' });
    // The last glyph's origin is 0 and its ink ends at 0.5 — not at the 0.6 its advance reaches.
    expect(fit.offsetX + 0.5 * fit.scale).toBeCloseTo(2, 6);
    expect(fit.offsetX).not.toBeCloseTo(2 - 0.6, 6);
  });

  it('aligns against the box, not the budget the fractions cut out of it', () => {
    const narrow = fitOf(place('AB'), bounds(2), { width: 0.6, height: 100, extent: 4, align: 'start' });
    // Half the budget halves the scale, and the paint still lands on the box's own edge.
    expect(narrow.scale).toBeCloseTo(0.5, 6);
    expect(narrow.offsetX + -0.6 * narrow.scale).toBeCloseTo(-2, 6);
  });

  it('stays at the origin when the box extent is unknown', () => {
    expect(fitOf(place('AB'), bounds(2), { width: 1.2, height: 100, align: 'start' }).offsetX).toBe(0);
  });

  it('stays at the origin when nothing draws', () => {
    const blank = { minX: [null, null], maxX: [null, null], minY: [null, null], maxY: [null, null] };
    expect(fitOf(place('  '), blank, { width: 1, height: 1, extent: 4, align: 'start' }).offsetX).toBe(0);
  });

  it('does not move the scale', () => {
    const budget = { width: 1.2, height: 100, extent: 4 };
    const centred = fitOf(place('AB'), bounds(2), budget);
    expect(fitOf(place('AB'), bounds(2), { ...budget, align: 'start' }).scale).toBe(centred.scale);
    expect(fitOf(place('AB'), bounds(2), { ...budget, align: 'end' }).midY).toBe(centred.midY);
  });
});
```

Update the three existing `fitOf` call sites in this file to the object form:

```ts
const blank = fitOf(place('  '), { minX: [null, null], maxX: [null, null], minY: [null, null], maxY: [null, null] }, { width: 1, height: 1 });
const mixed = fitOf(place('A\n '), { minX: [0, null], maxX: [0.5, null], minY: [0, null], maxY: [0.7, null] }, { width: 100, height: 100 });
const fit = fitOf(p, { minX: [0, 0, 0, 0], maxX: [0.5, 0.5, 0.5, 0.5], minY: [0, 0, 0, 0], maxY: [0.7, 0.7, 0.7, 0.7] }, { width: 1, height: 10 });
const fit = fitOf(p, { minX: [0], maxX: [0.5], minY: [-0.2], maxY: [0.7] }, { width: 100, height: 100 });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- packages/core/test/text/placement.test.ts`
Expected: FAIL — `fitOf` takes four arguments, and `Fit` has no `offsetX`.

- [ ] **Step 3: Add `Align` and the `Budget` fields**

In `packages/core/src/text/layout.ts`, above `Budget`:

```ts
/** Where the word sits in the box. `'start'` is its left edge; klieg has no text direction. */
export type Align = 'start' | 'center' | 'end';
```

and inside `Budget`, after `cap`:

```ts
  /**
   * Full visible width at the word's depth. Alignment measures against the whole box, where
   * `width` is only the share of it the type may fill — aligning inside that share would leave
   * the word inset by exactly the slack the fraction cut out.
   */
  extent?: number;
  align?: Align;
```

- [ ] **Step 4: Compute the offset in `fitOf`**

In `packages/core/src/text/placement.ts`, replace the `Fit` interface and `fitOf`:

```ts
export interface Fit {
  scale: number;
  /** Vertical centre of the drawn ink, in em. The group shifts by `-midY * scale`. */
  midY: number;
  /** World-space x for the group, placing the painted edge on the box's. 0 when centred. */
  offsetX: number;
}

/** Each glyph's own bounds in em, indexed like the placement; null where the glyph draws nothing. */
export interface GlyphBounds {
  minX: readonly (number | null | undefined)[];
  maxX: readonly (number | null | undefined)[];
  minY: readonly (number | null | undefined)[];
  maxY: readonly (number | null | undefined)[];
}

/**
 * Uniform scale, vertical centring and horizontal alignment for a placed block. Ink height, not
 * cap height: a descender both drops the centre and eats budget. Alignment measures the painted
 * extent rather than the advance span the fit is scored on, so an edge glyph's side bearing does
 * not hold the word off the edge it was asked to meet.
 */
export function fitOf(placed: Placement, geo: GlyphBounds, budget: Budget): Fit {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < placed.x.length; i++) {
    const lo = geo.minY[i];
    const hi = geo.maxY[i];
    if (lo === null || lo === undefined || hi === null || hi === undefined) continue;
    const y = placed.y[i] as number;
    minY = Math.min(minY, y + lo);
    maxY = Math.max(maxY, y + hi);
    const left = geo.minX[i];
    const right = geo.maxX[i];
    if (left === null || left === undefined || right === null || right === undefined) continue;
    const x = placed.x[i] as number;
    minX = Math.min(minX, x + left);
    maxX = Math.max(maxX, x + right);
  }

  const drawn = Number.isFinite(minY);
  const scale = fitScale(placed.inkWidth, drawn ? maxY - minY : 0, budget);
  return {
    scale,
    midY: drawn ? (minY + maxY) / 2 : 0,
    offsetX: alignOffset(scale, minX, maxX, budget),
  };
}

function alignOffset(scale: number, minX: number, maxX: number, budget: Budget): number {
  const extent = budget.extent;
  if (!budget.align || budget.align === 'center' || extent === undefined) return 0;
  if (!Number.isFinite(minX)) return 0;
  return budget.align === 'start' ? -extent / 2 - minX * scale : extent / 2 - maxX * scale;
}
```

Add `Align` to the type import at the top of the file:

```ts
import type { Align, Block, Budget, GlyphMetrics, Line } from './layout.js';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- packages/core/test/text/placement.test.ts`
Expected: PASS. `test/render/word.test.ts` still fails to typecheck — Task 2 fixes it.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/text/layout.ts packages/core/src/text/placement.ts packages/core/test/text/placement.test.ts
git commit -m "measure a framing alignment offset off the painted extent"
```

---

### Task 2: `Word` applies, lerps and reports the offset

**Files:**
- Modify: `packages/core/src/render/word.ts:125-126, 260-280, 606-609, 749, 757, 829-834`
- Test: `packages/core/test/render/word.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/render/word.test.ts`:

```ts
describe('framing alignment', () => {
  /** 'AA' spans 1.2 em of advance; a 1.2-wide budget scales it by 1 and its paint ends at 0.5. */
  const START: Budget = { width: 1.2, height: 100, extent: 4, align: 'start' };
  const END: Budget = { width: 1.2, height: 100, extent: 4, align: 'end' };

  it('leaves a centred word on the origin', () => {
    expect(new Word('AA', stubFont(), 'gold', ROOMY).group.position.x).toBe(0);
  });

  it('puts the leftmost paint on the box edge', () => {
    const word = new Word('AA', stubFont(), 'gold', START);
    expect(word.group.position.x + -STEP * word.group.scale.x).toBeCloseTo(-2, 6);
  });

  it('puts the rightmost paint on the box edge', () => {
    const word = new Word('AA', stubFont(), 'gold', END);
    expect(word.group.position.x + 0.5 * word.group.scale.x).toBeCloseTo(2, 6);
  });

  /**
   * Cap-bound, so the word is narrower than its budget. A width-bound fit lands the paint on
   * `-width / 2` whatever the letters are, which would leave a regroup nothing to move.
   */
  const LOOSE: Budget = { width: 100, height: 100, extent: 4, align: 'start' };

  it('moves the alignment with the fit across a regroup', () => {
    // 'AA' caps at 2.2 with its left paint at -0.6 em: -2 + 0.6 * 2.2.
    const word = new Word('AA', stubFont(), 'gold', LOOSE);
    expect(word.group.position.x).toBeCloseTo(-0.68, 6);

    word.regroup((letter) => letter.index === 0);
    word.setFitProgress(0);
    expect(word.group.position.x).toBeCloseTo(-0.68, 6);

    // One letter re-centres, putting its left paint at -0.3 em: -2 + 0.3 * 2.2.
    word.setFitProgress(1);
    expect(word.group.position.x).toBeCloseTo(-1.34, 6);

    word.setFitProgress(0.5);
    expect(word.group.position.x).toBeCloseTo(-1.01, 6);
  });

  it('is not at rest until the alignment has landed', () => {
    const word = new Word('AA', stubFont(), 'gold', LOOSE);
    word.regroup((letter) => letter.index === 0);

    word.setFitProgress(0.5);
    expect(word.atRest()).toBe(false);

    word.setFitProgress(1);
    expect(word.atRest()).toBe(true);
  });

  it('reports the offset in the snapshot the text layer projects from', () => {
    const word = new Word('AA', stubFont(), 'gold', START);
    expect(word.snapshot().fit.offsetX).toBe(word.group.position.x);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- packages/core/test/render/word.test.ts -t "framing alignment"`
Expected: FAIL — the group sits at x = 0 whatever the budget says.

- [ ] **Step 3: Collect the x bounds and apply the offset**

In `packages/core/src/render/word.ts`, beside the y bound fields (line 125):

```ts
  private readonly geoMinX: (number | null)[] = [];
  private readonly geoMaxX: (number | null)[] = [];
```

In the constructor's bounds loop, beside the y pushes:

```ts
      this.geoMinX.push(drawn ? drawn.min.x : null);
      this.geoMaxX.push(drawn ? drawn.max.x : null);
```

Replace the constructor's `fitOf` call:

```ts
    this.fit = fitOf(placed, this.glyphBounds(), budget);
```

Add the helper beside `applyFit`:

```ts
  private glyphBounds(pick?: readonly number[]): GlyphBounds {
    const at = (src: (number | null)[]) => (pick ? pick.map((i) => src[i] ?? null) : src);
    return {
      minX: at(this.geoMinX),
      maxX: at(this.geoMaxX),
      minY: at(this.geoMinY),
      maxY: at(this.geoMaxY),
    };
  }
```

Replace `applyFit`:

```ts
  private applyFit(fit: Fit): void {
    this.group.scale.setScalar(fit.scale);
    this.group.position.set(fit.offsetX, -fit.midY * fit.scale, 0);
  }
```

In `regroup`, replace the `fitOf` call:

```ts
    this.fitTo = fitOf(placed, this.glyphBounds(kept), this.budget);
```

In `atRest`, extend the fit comparison:

```ts
    if (
      this.fit.scale !== this.fitTo.scale ||
      this.fit.midY !== this.fitTo.midY ||
      this.fit.offsetX !== this.fitTo.offsetX
    )
      return false;
```

In `setFitProgress`, carry the offset through the lerp:

```ts
          : {
              scale: this.fitFrom.scale + (this.fitTo.scale - this.fitFrom.scale) * w,
              midY: this.fitFrom.midY + (this.fitTo.midY - this.fitFrom.midY) * w,
              offsetX: this.fitFrom.offsetX + (this.fitTo.offsetX - this.fitFrom.offsetX) * w,
            };
```

Add `GlyphBounds` to the placement import at the top of the file:

```ts
import {
  type Arrangement,
  arrange,
  type Fit,
  fitOf,
  type GlyphBounds,
  placeBlock,
} from '../text/placement.js';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- packages/core/test/render/word.test.ts`
Expected: PASS, including the existing fit and regroup suites.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/word.ts packages/core/test/render/word.test.ts
git commit -m "move the word group by its framing alignment"
```

---

### Task 3: The DOM text layer follows the alignment

**Files:**
- Modify: `packages/core/src/text/projection.ts:22, 56-58`
- Test: `packages/core/test/text/projection.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/text/projection.test.ts`:

```ts
describe('a word the framing has aligned', () => {
  it('shifts every box by the fit offset, in the pixels one world unit covers', () => {
    // pxPerWorldX is 800 / (2 * 2) = 200, so half a world unit is 100px.
    const boxes = projectLetters(
      input({ chars: ['A', 'B'], x: [0, 0.5], y: [0, 0], fit: { scale: 1, midY: 0, offsetX: 0.5 } }),
    ).boxes;

    expect(boxes[0]?.left).toBeCloseTo(500, 6);
    expect(boxes[1]?.left).toBeCloseTo(600, 6);
  });

  it('leaves an unaligned word where it was', () => {
    expect(projectLetters(input({ fit: { scale: 1, midY: 0, offsetX: 0 } })).boxes[0]?.left).toBeCloseTo(400, 6);
  });
});
```

Add `offsetX: 0` to the `fit` in this file's `input()` helper and to the two inline `fit` overrides
in the existing suite (`{ scale: 0.5, midY: 0 }` becomes `{ scale: 0.5, midY: 0, offsetX: 0 }`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- packages/core/test/text/projection.test.ts`
Expected: FAIL — `left` is 400 and 500; the offset is ignored.

- [ ] **Step 3: Read the offset in `projectLetters`**

In `packages/core/src/text/projection.ts`, widen the input's fit:

```ts
  fit: { scale: number; midY: number; offsetX: number };
```

and shift the box:

```ts
    const worldX = (input.x[i] ?? 0) * input.fit.scale + input.fit.offsetX;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- packages/core/test/text/projection.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/text/projection.ts packages/core/test/text/projection.test.ts
git commit -m "carry the alignment offset into the projected letter boxes"
```

---

### Task 4: `viewportBudget` reports the box it aligns against

**Files:**
- Modify: `packages/core/src/render/stage.ts:204-214`
- Test: `packages/core/test/render/stage.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the `framing against an anchor` describe in `packages/core/test/render/stage.test.ts`:

```ts
  it('reports the whole box as the extent the alignment measures against', () => {
    const strip = new Stage({
      idleTimeoutMs: 1000,
      placement: { kind: 'element', el: anchor(800, 120) },
    });
    strip.camera.aspect = 800 / 120;
    const budget = strip.viewportBudget(0.94, 0.66);

    expect(budget.extent).toBeCloseTo(frustumHeight(strip) * strip.camera.aspect, 12);
    // The fractions cut the budget out of the extent; alignment needs the extent itself.
    expect(budget.width).toBeCloseTo((budget.extent as number) * 0.94, 12);
  });

  it('carries the alignment through to the fit', () => {
    const strip = new Stage({
      idleTimeoutMs: 1000,
      placement: { kind: 'element', el: anchor(800, 120) },
    });

    expect(strip.viewportBudget(0.94, 0.66, 'start').align).toBe('start');
    expect(strip.viewportBudget(0.94, 0.66).align).toBeUndefined();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- packages/core/test/render/stage.test.ts -t "framing against an anchor"`
Expected: FAIL — `budget.extent` is undefined and `viewportBudget` takes two arguments.

- [ ] **Step 3: Widen `viewportBudget`**

In `packages/core/src/render/stage.ts`, replace the method body:

```ts
  viewportBudget(widthFrac = 0.62, heightFrac = 0.3, align?: Align): Budget {
    const vh = 2 * Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.position.z;
    return {
      width: vh * this.camera.aspect * widthFrac,
      height: vh * heightFrac,
      extent: vh * this.camera.aspect,
      align,
      // The anchor's box is the bound already, and filling it is the whole point of anchoring.
      cap: this.placement.kind === 'element' ? Number.POSITIVE_INFINITY : undefined,
    };
  }
```

and widen the type import at the top of the file:

```ts
import type { Align, Budget } from '../text/layout.js';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- packages/core/test/render/stage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/stage.ts packages/core/test/render/stage.test.ts
git commit -m "report the frustum extent alignment measures against"
```

---

### Task 5: `Framing.align`, and the docs that carry it

**Files:**
- Modify: `packages/core/src/index.ts:160-166, 311`
- Modify: `README.md:355`
- Modify: `CHANGELOG.md:2`
- Test: `packages/core/test/index.test.ts:954`

- [ ] **Step 1: Write the failing tests**

Append to the `framing` describe in `packages/core/test/index.test.ts`:

```ts
  /** The word group's x, and the scale it was fitted at, after one instant fire. */
  async function placeOf(text: string, framing?: KliegOptions['framing']) {
    const bk = create(framing ? { framing } : {});
    const done = bk.fire(text, INSTANT);
    await flush();
    const group = words()[0] as THREE.Group;
    const at = { x: group.position.x, scale: group.scale.x };
    clock.advance(16);
    await done;
    return at;
  }

  /** Half the frustum width at the word's depth; the stage is stubbed, so the aspect is 1. */
  const HALF_BOX = (2 * Math.tan((38 * Math.PI) / 360) * 11) / 2;
  /** 'HELLOTHERE' is ten 0.6 em advances centred on 0, so the first origin sits at -3. */
  const FIRST_ORIGIN = -3;
  /** Its last origin is 2.4, and each stub glyph paints 0.5 em of its 0.6 em advance. */
  const LAST_PAINT_END = 2.9;

  it('centres the word when the caller says nothing', async () => {
    expect((await placeOf('HELLOTHERE')).x).toBe(0);
    expect((await placeOf('HELLOTHERE', { width: 0.62, height: 0.3 })).x).toBe(0);
  });

  it('puts the painted edge on the box edge without changing the size', async () => {
    const centred = await placeOf('HELLOTHERE');
    const started = await placeOf('HELLOTHERE', { align: 'start' });

    expect(started.scale).toBe(centred.scale);
    expect(started.x + FIRST_ORIGIN * started.scale).toBeCloseTo(-HALF_BOX, 6);
  });

  it('aligns at the size the fractions chose, not at the width of the box', async () => {
    // The masthead case: width binds, so there is no slack, and alignment must work anyway.
    const narrow = await placeOf('HELLOTHERE', { width: 0.4, align: 'start' });
    const wide = await placeOf('HELLOTHERE', { width: 0.62, align: 'start' });

    expect(narrow.scale).toBeLessThan(wide.scale);
    expect(narrow.x + FIRST_ORIGIN * narrow.scale).toBeCloseTo(-HALF_BOX, 6);
    expect(wide.x + FIRST_ORIGIN * wide.scale).toBeCloseTo(-HALF_BOX, 6);
  });

  it('meets the right edge with the paint, not with the advance', async () => {
    const ended = await placeOf('HELLOTHERE', { align: 'end' });

    expect(ended.x + LAST_PAINT_END * ended.scale).toBeCloseTo(HALF_BOX, 6);
    // The last advance reaches 3.0 em; aligning on that would hold the ink off the edge.
    expect(ended.x + 3 * ended.scale).toBeGreaterThan(HALF_BOX);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- packages/core/test/index.test.ts -t "framing"`
Expected: FAIL — `align` is not a property of `Framing`, and the group never leaves x = 0.

- [ ] **Step 3: Add the option and thread it**

In `packages/core/src/index.ts`, inside `Framing`:

```ts
  /**
   * Where the word sits in the box, defaulting to `'center'`. The fractions above cap its size;
   * this places it, so `'start'` meets the left edge at whatever size the fit chose. An overlay
   * has no edge to meet — this is for an element `placement`, whose anchor does.
   */
  align?: Align;
```

Widen the doc comment above `Framing` to say the fractions cap size only, and export the type
beside the other public ones:

```ts
export type { Align } from './text/layout.js';
```

At the `viewportBudget` call:

```ts
        stage.viewportBudget(options.framing?.width, options.framing?.height, options.framing?.align),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- packages/core/test/index.test.ts`
Expected: PASS

- [ ] **Step 5: Document it**

In `README.md`, replace the `framing` row:

```md
| `framing` | `{ width: 0.62, height: 0.3 }` | share of the box the type may fill, per axis — the viewport, or the anchor under an element `placement`; raise it on a page that is nothing but the type. `align: 'start' \| 'center' \| 'end'` then places the word in the box at that size, so an anchored word can meet the page's own text edge instead of floating centred in it |
```

In `CHANGELOG.md`, add above `## 0.7.0`:

```md
## Unreleased

### `framing` can align the word against the box's edge

`framing` said how much of the anchor the type could fill and not where in it the word sat, so an
anchored masthead floated off the page's text edge by whatever slack the fit left — a gap a
consumer could only close by padding the anchor asymmetrically, in a number measured to one name at
one size. `framing.align` places it: `'start'` puts the leftmost paint on the box's left edge,
`'end'` the rightmost on its right, and `'center'` (the default) renders exactly as before.

Two things it deliberately does not do. It measures the **painted** extent, not the advance the fit
is scored on, so an edge glyph's side bearing does not hold the word off the edge. And it measures
against the whole box rather than the share `width` cut out of it, so aligning does not change the
size the fractions chose — the caller who needs a flush edge does not have to widen the framing to
get one.
```

- [ ] **Step 6: Run the whole suite, typecheck and lint**

```bash
npm run check
```
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/index.ts packages/core/test/index.test.ts README.md CHANGELOG.md
git commit -m "add framing alignment to the public option"
```

---

## Verification against the reporting consumer

After Task 5, the masthead's compensation should be expressible as a design quantity rather than a
measurement. The consumer keeps `{ width: 0.78, height: 0.55 }`, adds `align: 'start'`, and makes
the strip's padding symmetric — the remaining negative margin is the glow's radius, which is chosen,
not measured. Nothing in this repo depends on that; it is what to tell issue #2.

---

## As shipped

Both corrections below came from running it, not from reading it — the plan's own test code asserts
the naive edge in two places and would have passed a wrong implementation.

**The paint is wider than the outline, twice over.** A glyph's geometry runs `bevelSize` (0.038 em)
past its outline, and at an acute vertex the miter carries it further still — so a hand-derived
expectation like "the first origin, minus one bevel" is wrong by an amount that depends on the
glyph. `test/index.test.ts` measures the real thing instead: it walks the letter meshes and takes
the bounding box of what is actually drawn.

**Alignment happens in a frustum, so the plane is not the edge.** Aligning the word's world-space
extent to `extent / 2` put the type's near cap outside the box and the anchored canvas clipped it —
16px off `klieg` in the 832×120 strip lab, which is the same species of defect the feature exists to
remove. `Budget.cameraZ` and `GlyphBounds.depth` let `alignOffset` measure against the box's edge at
the depth of the *nearest* paint. That is conservative by construction: the widest point of a
bevelled glyph sits slightly behind its near cap, so the word can only ever land a hair inside the
edge, never over it. Measured in the lab after the fix: the painted span reaches column 0 of the
canvas with nothing clipped, and the fit is untouched (84px tall at every alignment).

The strip lab (`apps/lab/strip/`) grew an `align` selector, which is what those measurements were
taken through.

**The default changed after the plan was written.** `'center'` for everything preserved every
existing caller, but it is the wrong default for the case the issue is about: an anchored word sits
in a page that has a text edge. An element placement now defaults to `'start'` and only a
fullscreen overlay stays centred. `'start'`/`'end'` are logical, resolved against the box's computed
`direction`, so the public `Align` and the physical edge `fitOf` needs are separate types —
`Budget.edge` is `'left' | 'right'`, and `edgeFor` in the stage is what maps between them.
