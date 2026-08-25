# Effects Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a klieg look drive appearance over time below the level of a letter — a neon sign with one tube flickering on its own timing — through a grammar that works the same way for a tube run and for a letter body.

**Architecture:** A *part* is the smallest addressable thing: a tube run or a letter body. `EffectPiece` mirrors `MotionPiece` one level down — `{ duration, at(t, part) → PartOffset }` — and a slot is a piece or an array of them, merged by the same additive/multiplicative rule the pose compositor uses. Writes go through machinery that already exists: a run's own `runColor` vertex attribute for gain and colour, the mesh's material slot for `dark`, the mesh's own transform for movement, and `emissiveIntensity` for a body. No new material, draw call or compiled program.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), three.js as a peer dependency, vitest for unit tests, Playwright for visual baselines, biome for lint/format.

**Design:** [specs/2026-08-24-effects-pipeline-design.md](../specs/2026-08-24-effects-pipeline-design.md). This plan covers steps 1–3 of that spec. `chunk` parts (step 4) and `crawl` (step 5) each get their own plan.

**Before you start:** run `npm run check` and confirm it reports **789 passed (789)** across 43 files. That is the baseline every task below is measured against. Also run `npx playwright test` once and confirm 23 passed — several tasks re-run it.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/select.ts` | **New.** `SelectSpec` and `selectIndices` — the by/amount/stride selection grammar, extracted from `assign` so effects and lit-selection share one implementation. |
| `packages/core/src/render/looks.ts` | **Modify.** Split look-owned from frame-owned material properties; expose the frame-owned base. |
| `packages/core/src/motion/types.ts` | **Modify.** Generalize `orderKey`/`stagger` from `LetterInfo` to a minimal ordering interface. |
| `packages/core/src/effects/types.ts` | **New.** `PartKind`, `PartInfo`, `PartOffset`, `EffectPiece`, `EffectSpec`, `EffectName`. |
| `packages/core/src/effects/compositor.ts` | **New.** Merges a list of `PartOffset` into one resolved offset. |
| `packages/core/src/effects/pieces.ts` | **New.** The named pieces. `flicker` in this plan. |
| `packages/core/src/render/word.ts` | **Modify.** Owns the frame-owned write, builds the word-wide part pool, and applies resolved offsets per frame. |
| `packages/core/src/index.ts` | **Modify.** `FireOptions.effects`, `EFFECT_NAMES`, and the type re-exports. |

---

### Task 1: Split look-owned from frame-owned material properties

`applyLook` writes `emissiveIntensity` onto the material once at build time. `Word` is about to write it every frame. Two writers to one property is the bug that already cost this repo the `opacity` trap, so the ownership gets split before anything else is built.

**Files:**
- Modify: `packages/core/src/render/looks.ts:25-50` (the `LookKey` comment and union), `:327` (`PARAM_KEYS`), `:362-378` (`applyLook`)
- Test: `packages/core/test/render/looks.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/test/render/looks.test.ts`, inside the existing `describe('applyLook')` block, directly after the existing `'leaves opacity off the material, because Word owns it per frame'` test (around line 213):

```ts
  it('leaves emissiveIntensity off the material, because Word owns it per frame', () => {
    const material = createMaterial();

    applyLook(material, 'neon');

    // three's own default, not neon's 3.2: the value reaches the material through Word.
    expect(material.emissiveIntensity).toBe(1);
    // Everything else still lands, so this is an ownership split and not a dropped write.
    expect(material.emissive.getHex()).not.toBe(0x000000);
  });
```

Add a new `describe` block at the end of the same file:

```ts
describe('frameOwnedBase', () => {
  it('carries a look own declared values', () => {
    expect(frameOwnedBase('neon')).toEqual({ opacity: 1, emissiveIntensity: 3.2 });
  });

  it('falls back to the defaults when a look declares neither', () => {
    expect(frameOwnedBase('gold')).toEqual({ opacity: 1, emissiveIntensity: 1 });
  });

  it('reads opacity, which is not a LookKey', () => {
    expect(frameOwnedBase({ opacity: 0.08 }).opacity).toBe(0.08);
  });

  it('clamps a negative emissiveIntensity rather than passing it through', () => {
    expect(frameOwnedBase({ emissiveIntensity: -5 }).emissiveIntensity).toBe(0);
  });
});
```

Extend the import at the top of the file (currently `applyLook, ...` on line 5) to include `frameOwnedBase`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/core/test/render/looks.test.ts`
Expected: FAIL — `frameOwnedBase is not a function`, and the new `applyLook` test fails with `expected 3.2 to be 1`.

- [ ] **Step 3: Implement the split**

In `packages/core/src/render/looks.ts`, replace the two-line comment above `type LookKey` (lines 26-27) with just the existing line 25 comment, and add below the `LookParams` type:

```ts
/**
 * Properties `Word` writes every frame from base x pose x effects. A look still declares its own
 * base and `resolveParams` still clamps it; what must not happen is `applyLook` writing a value
 * that the next frame overwrites, which is two writers for one property.
 */
type FrameOwned = 'opacity' | 'emissiveIntensity';
type AppliedKey = Exclude<LookKey, FrameOwned>;
```

Replace line 327:

```ts
const PARAM_KEYS = Object.keys(DEFAULTS) as LookKey[];
```

with:

```ts
const PARAM_KEYS = Object.keys(DEFAULTS) as LookKey[];
const FRAME_OWNED = new Set<string>(['opacity', 'emissiveIntensity']);
const APPLY_KEYS = PARAM_KEYS.filter((key): key is AppliedKey => !FRAME_OWNED.has(key));

// A frame-owned key reaching applyLook is the two-writer bug; the compiler is what catches it.
const _appliedKeysAreNotFrameOwned: Extract<AppliedKey, FrameOwned> extends never ? true : never =
  true;
```

In `applyLook` (line 370), change the loop to walk `APPLY_KEYS`:

```ts
  for (const key of APPLY_KEYS) {
```

Add, immediately after `applyLook`:

```ts
/** The base a frame-owned property composes from. `Word` is the only caller. */
export interface FrameOwnedBase {
  opacity: number;
  emissiveIntensity: number;
}

export function frameOwnedBase(look: Look): FrameOwnedBase {
  const spec = specOf(look);
  return {
    opacity: spec.opacity ?? 1,
    emissiveIntensity: resolveParams(spec).emissiveIntensity,
  };
}
```

- [ ] **Step 4: Fix the two existing tests that asserted the old ownership**

In `packages/core/test/render/looks.test.ts`, the test `'gives neon an emissive above the bloom threshold over a near-black base'` (around line 108) asserts on the material. Change its `emissiveIntensity` line to read the base instead:

```ts
    expect(frameOwnedBase('neon').emissiveIntensity).toBeGreaterThan(1);
```

In `'resets every new channel from the defaults'` (around line 136), delete this line — it now passes only because three's default happens to equal gold's, which is a test that agrees for the wrong reason:

```ts
    expect(gold.emissiveIntensity).toBe(1);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/core/test/render/looks.test.ts`
Expected: PASS, with 4 more tests than before.

- [ ] **Step 6: Verify by mutation**

Temporarily change `FRAME_OWNED` to `new Set<string>(['opacity'])` and re-run the file. Expected: the new `'leaves emissiveIntensity off the material'` test FAILS. Restore it. A test that passes with the code under it removed is not testing that code.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/render/looks.ts packages/core/test/render/looks.test.ts
git commit -m "stop applyLook writing the properties Word owns per frame"
```

---

### Task 2: Word composes the frame-owned properties

Task 1 stopped `applyLook` writing `emissiveIntensity`, so nothing writes it yet and every emissive look is currently rendering at three's default of 1. This task restores it through the composing writer. It must be initialized in the constructor as well as maintained in `apply()`, because most tests and any frame before the first `apply()` never reach the frame loop.

**Files:**
- Modify: `packages/core/src/render/word.ts:139-147` (the base fields), `:285-380` (construction), `:515-538` (`apply`)
- Test: `packages/core/test/render/word.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/test/render/word.test.ts`, as a new `describe` block at the end of the file:

```ts
describe('frame-owned material properties', () => {
  /** Reaches the body mesh material of letter `i` without going through a private field. */
  function bodyMaterialOf(word: Word, i: number): THREE.MeshPhysicalMaterial {
    const cell = word.group.children[0]?.children[i] as THREE.Group;
    const mesh = cell.children[0] as THREE.Mesh;
    return mesh.material as THREE.MeshPhysicalMaterial;
  }

  it('carries a look emissiveIntensity onto the material without any frame having run', () => {
    const word = new Word('A', stubFont(), 'neon', ROOMY);

    expect(bodyMaterialOf(word, 0).emissiveIntensity).toBe(3.2);
  });

  it('holds it across a frame', () => {
    const word = new Word('A', stubFont(), 'neon', ROOMY);
    const still: MotionPiece = { duration: 1000, offset: () => ({}) };

    word.apply(new Timeline({ enter: still, active: NONE, exit: NONE, hold: 0, blendMs: 0 }), 0);

    expect(bodyMaterialOf(word, 0).emissiveIntensity).toBe(3.2);
  });

  it('leaves a look that declares none at the default', () => {
    const word = new Word('A', stubFont(), 'gold', ROOMY);

    expect(bodyMaterialOf(word, 0).emissiveIntensity).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/core/test/render/word.test.ts -t "frame-owned"`
Expected: FAIL — `expected 1 to be 3.2` on the first two.

- [ ] **Step 3: Add the base fields**

In `packages/core/src/render/word.ts`, add `frameOwnedBase` and `FrameOwnedBase` to the existing import from `./looks.js` (around line 31).

Below the existing `darkOpacity` field declaration (around line 123), add:

```ts
  /** Frame-owned bases, one per material family. `Word` is the only writer of these properties. */
  private readonly bodyBase: FrameOwnedBase;
  private readonly decorBase: FrameOwnedBase;
  private readonly darkBase: FrameOwnedBase;
```

In the constructor, beside the existing opacity assignments (lines 139-147), add:

```ts
    this.bodyBase = frameOwnedBase(spec);
    this.decorBase = frameOwnedBase(decoration?.look ?? {});
    this.darkBase = frameOwnedBase(
      decoration?.kind === 'tube' ? decoration.dark : {},
    );
```

- [ ] **Step 4: Write them at construction**

`emissiveIntensity` is not on `THREE.Material`, and a debug hook may supply a non-physical decoration material, so the write is guarded by a property check rather than a cast.

Add this module-level helper to `word.ts`, next to the existing `seedFlake` helper (around line 55):

```ts
/** Writes a frame-owned emissive onto a material that has one. A debug override may not. */
function setEmissiveIntensity(material: THREE.Material | null, value: number): void {
  if (material && 'emissiveIntensity' in material) {
    (material as THREE.MeshPhysicalMaterial).emissiveIntensity = value;
  }
}
```

In the constructor, immediately after `this.bodyMaterials.push(material);` (line 294):

```ts
    setEmissiveIntensity(material, this.bodyBase.emissiveIntensity);
```

Immediately after `this.decorMaterials.push(decorMaterial);` — note there are **two** such lines, one in the tube branch (line 329) and one in the chunks branch (line 361) — add to each:

```ts
      setEmissiveIntensity(decorMaterial, this.decorBase.emissiveIntensity);
```

Immediately after `this.darkMaterials.push(darkMaterial);` (line 337):

```ts
      setEmissiveIntensity(darkMaterial, this.darkBase.emissiveIntensity);
```

- [ ] **Step 5: Maintain them per frame**

In `apply()` (lines 532-537), extend each of the three material writes:

```ts
      const material = this.bodyMaterials[i];
      if (material) {
        material.opacity = pose.opacity * this.bodyOpacity;
        material.emissiveIntensity = this.bodyBase.emissiveIntensity;
      }
      const decor = this.decorMaterials[i];
      if (decor) {
        decor.opacity = pose.opacity * this.decorOpacity;
        setEmissiveIntensity(decor, this.decorBase.emissiveIntensity);
      }
      const dark = this.darkMaterials[i];
      if (dark) {
        dark.opacity = pose.opacity * this.darkOpacity;
        setEmissiveIntensity(dark, this.darkBase.emissiveIntensity);
      }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run packages/core/test/render/word.test.ts -t "frame-owned"`
Expected: PASS, 3 tests.

- [ ] **Step 7: Verify nothing moved on screen**

Run: `npm run check`
Expected: PASS, 796 tests (789 baseline + 4 from Task 1 + 3 here).

Run: `npx playwright test`
Expected: 23 passed. **This is the load-bearing check for Tasks 1 and 2 together** — it is the claim that moving where `emissiveIntensity` is written moved no pixels. If `look-neon` or `look-tubing` fails here, the base is not reaching the material; do not re-record the baseline.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/render/word.ts packages/core/test/render/word.test.ts
git commit -m "compose the frame-owned material properties in Word"
```

---

### Task 3: Extract the selection grammar

`assign` holds the by/amount/stride selection inline. Effects need the same grammar over parts, and two copies of a seeded selector drift.

**Files:**
- Create: `packages/core/src/select.ts`
- Create: `packages/core/test/select.test.ts`
- Modify: `packages/core/src/render/tube/assign.ts:1-75`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/select.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { selectIndices } from '../src/select.js';

/** Indices are the pool's own numbering, not array offsets — the two differ once anything filters. */
const pool = [
  { index: 0, length: 5 },
  { index: 1, length: 1 },
  { index: 2, length: 9 },
  { index: 3, length: 3 },
];

describe('selectIndices', () => {
  it('takes a fraction of the pool', () => {
    expect(selectIndices(pool, { by: 'index', amount: 0.5 }, 0)).toEqual(new Set([0, 1]));
  });

  it('takes a literal count above 1', () => {
    expect(selectIndices(pool, { by: 'index', amount: 3 }, 0)).toEqual(new Set([0, 1, 2]));
  });

  it('never asks for more than the pool holds', () => {
    expect(selectIndices(pool, { by: 'index', amount: 99 }, 0).size).toBe(4);
  });

  it('orders by length, longest first', () => {
    expect(selectIndices(pool, { by: 'length', amount: 2 }, 0)).toEqual(new Set([2, 0]));
  });

  it('strides over the pool own indices', () => {
    expect(selectIndices(pool, { by: 'index', amount: 1, stride: 2 }, 0)).toEqual(new Set([0, 2]));
  });

  it('is deterministic for a seed and varies with it', () => {
    const a = selectIndices(pool, { by: 'seed', amount: 2 }, 7);
    const b = selectIndices(pool, { by: 'seed', amount: 2 }, 7);
    const c = selectIndices(pool, { by: 'seed', amount: 2 }, 8);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('selects nothing from an empty pool rather than throwing', () => {
    expect(selectIndices([], { by: 'seed', amount: 1 }, 0)).toEqual(new Set());
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/core/test/select.test.ts`
Expected: FAIL — cannot resolve `../src/select.js`.

- [ ] **Step 3: Create the module**

Create `packages/core/src/select.ts`:

```ts
export interface SelectSpec {
  /** How the pool is ordered before the amount is taken off the front. */
  by: 'seed' | 'length' | 'index';
  /** 0..1 is a fraction of the pool size; above 1 is a literal count. */
  amount: number;
  /** Only read when `by` is 'index': take every nth member. */
  stride?: number;
}

/** Anything a `SelectSpec` can choose between. `index` is the pool's numbering, not an offset. */
export interface Selectable {
  index: number;
  /** Ranks a `by: 'length'` selection. */
  length: number;
}

/** Same generator the chunk scatter uses, so seeding behaves consistently across decorations. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The indices `select` chooses out of `pool`. */
export function selectIndices(
  pool: readonly Selectable[],
  select: SelectSpec,
  seed: number,
): Set<number> {
  if (select.by === 'index' && select.stride && select.stride > 1) {
    const stride = Math.round(select.stride);
    return new Set(pool.filter((e) => e.index % stride === 0).map((e) => e.index));
  }

  const count =
    select.amount > 1
      ? Math.min(pool.length, Math.round(select.amount))
      : Math.round(Math.min(1, Math.max(0, select.amount)) * pool.length);

  let order: number[];
  if (select.by === 'length') {
    order = pool
      .map((e) => [e.length, e.index] as const)
      .sort((a, b) => b[0] - a[0])
      .map(([, i]) => i);
  } else if (select.by === 'index') {
    order = pool.map((e) => e.index);
  } else {
    const random = rng(Math.round(seed * 2654435761) ^ 0x5eed);
    order = pool
      .map((e) => [random(), e.index] as const)
      .sort((a, b) => a[0] - b[0])
      .map(([, i]) => i);
  }

  return new Set(order.slice(0, count));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/core/test/select.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Make `assign` use it**

In `packages/core/src/render/tube/assign.ts`, delete the local `SelectSpec` interface and the local `rng` function, and replace the top of the file with:

```ts
import * as THREE from 'three';
import { type SelectSpec, selectIndices } from '../../select.js';
import { type GradientSpec, perRunT, rampAt } from './gradient.js';
import type { Run } from './runs.js';
import type { SurfaceKind } from './surfaces.js';

export type { SelectSpec } from '../../select.js';
```

Replace the whole selection block — from `if (select.by === 'index' && select.stride && select.stride > 1) {` down to and including the closing brace of the `else` that ends with `for (const run of runs) run.lit = chosen.has(run.index);` — with:

```ts
  const chosen = selectIndices(lightable, select, seed);
  for (const run of runs) run.lit = chosen.has(run.index);
```

The `for (const run of runs) if (run.dark) run.lit = false;` line below it stays: `lightable` already excludes dark runs, and the line is what keeps that true if the pool ever widens.

- [ ] **Step 6: Verify the extraction changed no selection**

Run: `npm run check`
Expected: PASS, 803 tests (796 + 7). Every existing `assign` test passes untouched.

Run: `npx playwright test`
Expected: 23 passed. A changed selection would repaint which runs are lit, so a baseline failure here means the extraction is not faithful.

- [ ] **Step 7: Verify by mutation**

Temporarily change `selectIndices` to return `new Set()` and run `npx vitest run packages/core/test/render/tube`. Expected: `assign` tests FAIL. Restore. This proves `assign` is genuinely routed through the new code rather than still holding a copy.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/select.ts packages/core/test/select.test.ts packages/core/src/render/tube/assign.ts
git commit -m "extract the selection grammar so effects and lit-selection share it"
```

---

### Task 4: Generalize stagger from letters to any ordered pool

`orderKey` and `stagger` take a `LetterInfo` but read only six of its fields. Parts need the same phase-spread grammar, and a second copy would drift from the first.

**Files:**
- Modify: `packages/core/src/motion/types.ts:56-107`
- Test: `packages/core/test/motion/types.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/test/motion/types.test.ts` (create the file if it does not exist, with `import { describe, expect, it } from 'vitest';` and `import { orderKey, stagger } from '../../src/motion/types.js';`):

```ts
describe('orderKey over a non-letter pool', () => {
  it('orders anything carrying index and count', () => {
    const part = { index: 3, count: 4 };

    expect(orderKey(part, { from: 'start' })).toBeCloseTo(0.75);
    expect(orderKey(part, { from: 'end' })).toBeCloseTo(0.25);
  });

  it('staggers a pool member the same way it staggers a letter', () => {
    const spec = { spread: 0.5, from: 'start' as const };
    const asPart = stagger(0.75, { index: 1, count: 4 }, spec);
    const asLetter = stagger(0.75, { index: 1, count: 4 }, spec);

    expect(asPart).toBe(asLetter);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/core/test/motion/types.test.ts`
Expected: FAIL to compile — `{ index, count }` is not assignable to `LetterInfo` (which requires nothing else, so if this compiles, still run it and confirm the assertions before moving on).

- [ ] **Step 3: Introduce the ordering interface**

In `packages/core/src/motion/types.ts`, add above `orderKey`:

```ts
/**
 * What ordering a pool needs: position within it, and optionally where its member sits in the
 * laid-out block. `LetterInfo` satisfies it, and so does a part of a letter.
 */
export interface Ordered {
  index: number;
  count: number;
  line?: number;
  column?: number;
  lineCount?: number;
  columnCount?: number;
}
```

Change the three signatures that take a letter — `radial`, `fromMiddle`, `orderKey` and `stagger` — from `LetterInfo` to `Ordered`. `LetterInfo` extends the same shape, so every existing caller is unaffected:

```ts
function radial(letter: Ordered): number {
function fromMiddle(letter: Ordered): number {
export function orderKey(letter: Ordered, spec: StaggerSpec = {}): number {
export function stagger(t: number, letter: Ordered, spec: number | StaggerSpec = 0.5): number {
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/core/test/motion/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the motion path is untouched**

Run: `npm run check`
Expected: PASS, 805 tests (803 + 2).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/motion/types.ts packages/core/test/motion/types.test.ts
git commit -m "widen stagger from letters to any ordered pool"
```

---

### Task 5: Part types and the offset compositor

Pure data and pure functions, with no three.js and no `Word` — this is the piece that is cheapest to get right and hardest to debug later if it is wrong.

**Files:**
- Create: `packages/core/src/effects/types.ts`
- Create: `packages/core/src/effects/compositor.ts`
- Create: `packages/core/test/effects/compositor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/effects/compositor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mergeOffsets, REST_OFFSET } from '../../src/effects/compositor.js';

describe('mergeOffsets', () => {
  it('is the identity for no offsets', () => {
    expect(mergeOffsets([])).toEqual(REST_OFFSET);
  });

  it('multiplies gain toward 1 rather than summing it', () => {
    expect(mergeOffsets([{ gain: 0.5 }, { gain: 0.5 }]).gain).toBe(0.25);
  });

  it('multiplies scale the same way', () => {
    expect(mergeOffsets([{ scale: 2 }, { scale: 3 }]).scale).toBe(6);
  });

  it('sums position and rotation', () => {
    const out = mergeOffsets([
      { position: [1, 0, 0], rotation: [0, 1, 0] },
      { position: [0, 2, 0], rotation: [0, 0, 3] },
    ]);
    expect(out.position).toEqual([1, 2, 0]);
    expect(out.rotation).toEqual([0, 1, 3]);
  });

  it('sums crawl, so two chases add rather than fight', () => {
    expect(mergeOffsets([{ crawl: 0.25 }, { crawl: 0.5 }]).crawl).toBe(0.75);
  });

  it('takes the strongest dark rather than compounding it', () => {
    expect(mergeOffsets([{ dark: 0.3 }, { dark: 0.9 }, { dark: 0.1 }]).dark).toBe(0.9);
  });

  it('lets the last writer win the colour', () => {
    expect(mergeOffsets([{ color: 0xff0000 }, { color: 0x00ff00 }]).color).toBe(0x00ff00);
  });

  it('leaves colour unset when nobody writes one, so the part keeps its own', () => {
    expect(mergeOffsets([{ gain: 0.5 }]).color).toBeUndefined();
  });

  it('ignores a channel an offset omits', () => {
    expect(mergeOffsets([{ gain: 0.5 }, { color: 0x00ff00 }]).gain).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/core/test/effects/compositor.test.ts`
Expected: FAIL — cannot resolve `../../src/effects/compositor.js`.

- [ ] **Step 3: Write the types**

Create `packages/core/src/effects/types.ts`:

```ts
import type { LetterInfo, StaggerSpec } from '../motion/types.js';
import type { SelectSpec } from '../select.js';
import type { Vec3 } from '../pose.js';

/** What an effect can address. A part is the smallest thing below a letter. */
export type PartKind = 'run' | 'body';

/**
 * One addressable part, described the way `LetterInfo` describes a letter. The pool is word-wide,
 * so `index` and `count` span the whole sign rather than one letter.
 */
export interface PartInfo {
  kind: PartKind;
  index: number;
  count: number;
  /** The letter this part belongs to, so a piece can order by letter as well as by part. */
  letter: LetterInfo;
  /** Layout position in em, relative to the block centre. */
  x: number;
  y: number;
  /** Fraction of the pool's extent lying before this part, and this part's share of it. */
  at: number;
  span: number;
}

/** A relative contribution. Omitted fields mean "no contribution", as `PoseOffset` does. */
export interface PartOffset {
  /** Multiplies the part's emissive. */
  gain?: number;
  color?: number;
  /** 0..1 toward a tube decoration's `dark` material. */
  dark?: number;
  position?: Vec3;
  rotation?: Vec3;
  scale?: number;
  /** Shifts the colour ramp along the part. Inert until the crawl step lands. */
  crawl?: number;
}

/** Everything a merge resolved. Multiplicative channels rest at 1, additive at 0. */
export interface ResolvedOffset {
  gain: number;
  color?: number;
  dark: number;
  position: Vec3;
  rotation: Vec3;
  scale: number;
  crawl: number;
}

export interface EffectPiece {
  /** Milliseconds for one pass. Loops. */
  duration: number;
  /** `t` is normalized 0..1 within this pass. */
  at(t: number, part: PartInfo): PartOffset;
}

export type EffectName = 'flicker';

export interface EffectSpec {
  piece: EffectName | EffectPiece;
  /** Which parts, out of the word's pool of that kind. */
  target: { kind: PartKind } & SelectSpec;
  /** Per-part phase spread. */
  stagger?: number | StaggerSpec;
  /** Fixes the selection so a pinned frame is reproducible. */
  seed?: number;
}
```

- [ ] **Step 4: Write the compositor**

Create `packages/core/src/effects/compositor.ts`:

```ts
import type { Vec3 } from '../pose.js';
import type { PartOffset, ResolvedOffset } from './types.js';

/** No contribution: multiplicative channels at 1, additive at 0, colour left to the part. */
export const REST_OFFSET: ResolvedOffset = {
  gain: 1,
  dark: 0,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: 1,
  crawl: 0,
};

/**
 * Folds layered contributions into one. Multiplicative channels fade toward 1 and additive ones
 * toward 0, matching the pose compositor — scaling a multiplicative channel toward 0 would remove
 * the part rather than remove the contribution.
 */
export function mergeOffsets(offsets: readonly PartOffset[]): ResolvedOffset {
  const position: Vec3 = [0, 0, 0];
  const rotation: Vec3 = [0, 0, 0];
  let gain = 1;
  let scale = 1;
  let dark = 0;
  let crawl = 0;
  let color: number | undefined;

  for (const o of offsets) {
    if (o.position) {
      for (let i = 0; i < 3; i++) {
        position[i] = (position[i] as number) + (o.position[i] as number);
      }
    }
    if (o.rotation) {
      for (let i = 0; i < 3; i++) {
        rotation[i] = (rotation[i] as number) + (o.rotation[i] as number);
      }
    }
    if (o.gain !== undefined) gain *= o.gain;
    if (o.scale !== undefined) scale *= o.scale;
    if (o.crawl !== undefined) crawl += o.crawl;
    // Strongest wins rather than compounding: two layers each half-dead should not read as dead.
    if (o.dark !== undefined) dark = Math.max(dark, o.dark);
    if (o.color !== undefined) color = o.color;
  }

  return { gain, color, dark, position, rotation, scale, crawl };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run packages/core/test/effects/compositor.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/effects packages/core/test/effects
git commit -m "add the part offset types and their compositor"
```

---

### Task 6: The flicker piece

**Files:**
- Create: `packages/core/src/effects/pieces.ts`
- Create: `packages/core/test/effects/pieces.test.ts`

A failing tube is not a sine wave. It sits mostly lit, drops to near-dark in short irregular stutters, and the irregularity is what reads as broken rather than as decoration. The piece is deterministic in `t` so a pinned frame is reproducible.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/effects/pieces.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EFFECTS, flicker } from '../../src/effects/pieces.js';
import type { PartInfo } from '../../src/effects/types.js';

const part: PartInfo = {
  kind: 'run',
  index: 0,
  count: 4,
  letter: { index: 0, count: 1 },
  x: 0,
  y: 0,
  at: 0,
  span: 1,
};

/** Samples one pass at a fixed rate, so a claim about the whole cycle is not read off one frame. */
function gainsAcrossOnePass(steps = 200): number[] {
  const piece = flicker();
  return Array.from({ length: steps }, (_, n) => piece.at(n / steps, part).gain as number);
}

describe('flicker', () => {
  it('writes only gain, leaving every other channel to another layer', () => {
    const out = flicker().at(0.5, part);
    expect(Object.keys(out)).toEqual(['gain']);
  });

  it('stays inside 0..1', () => {
    for (const g of gainsAcrossOnePass()) {
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
    }
  });

  it('spends most of the pass lit, which is what makes the stutter read as a fault', () => {
    const lit = gainsAcrossOnePass().filter((g) => g > 0.8).length;
    expect(lit).toBeGreaterThan(120);
  });

  it('actually drops dark somewhere in the pass', () => {
    expect(Math.min(...gainsAcrossOnePass())).toBeLessThan(0.2);
  });

  it('is deterministic in t', () => {
    expect(flicker().at(0.37, part).gain).toBe(flicker().at(0.37, part).gain);
  });

  it('gives two parts different stutters, so a pair does not blink in lockstep', () => {
    const piece = flicker();
    const a = Array.from({ length: 50 }, (_, n) => piece.at(n / 50, { ...part, index: 0 }).gain);
    const b = Array.from({ length: 50 }, (_, n) => piece.at(n / 50, { ...part, index: 1 }).gain);
    expect(a).not.toEqual(b);
  });

  it('takes a depth that bounds how dark it goes', () => {
    const shallow = Array.from(
      { length: 200 },
      (_, n) => flicker({ depth: 0.5 }).at(n / 200, part).gain as number,
    );
    expect(Math.min(...shallow)).toBeGreaterThanOrEqual(0.5);
  });

  it('is reachable by name', () => {
    expect(typeof EFFECTS.flicker).toBe('function');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/core/test/effects/pieces.test.ts`
Expected: FAIL — cannot resolve `../../src/effects/pieces.js`.

- [ ] **Step 3: Write the piece**

Create `packages/core/src/effects/pieces.ts`:

```ts
import type { EffectName, EffectPiece, PartInfo } from './types.js';

export interface FlickerSpec {
  /** Milliseconds for one pass. */
  duration?: number;
  /** How dark the stutter goes, as the floor of `gain`. 0 is fully out. */
  depth?: number;
  /** Share of the pass spent stuttering. The rest is held lit. */
  unrest?: number;
}

/**
 * Deterministic, so a pinned clock renders the same frame every run. A seeded generator would
 * depend on call order, which a per-part evaluation does not have.
 */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * A tube that has not failed yet. Mostly lit, with short irregular drops — the irregularity is
 * what reads as a fault rather than as a decoration, so the stutter is sampled from a hash of the
 * pass position rather than from a wave.
 */
export function flicker(spec: FlickerSpec = {}): EffectPiece {
  const duration = spec.duration ?? 1400;
  const depth = Math.min(1, Math.max(0, spec.depth ?? 0));
  const unrest = Math.min(1, Math.max(0, spec.unrest ?? 0.25));

  return {
    duration,
    at(t: number, part: PartInfo) {
      // Quantized so a drop lasts a few frames rather than one: a single-frame drop is invisible
      // at 60fps and reads as noise on a screenshot.
      const step = Math.floor(t * 64);
      const roll = hash01(step + part.index * 977.3);
      if (roll > unrest) return { gain: 1 };
      // Inside a stutter the depth varies, so repeated drops do not look like a square wave.
      const bite = hash01(step * 3.7 + part.index * 131.1);
      return { gain: depth + (1 - depth) * bite * 0.35 };
    },
  };
}

/** Named pieces, for `EFFECT_NAMES` and for resolving an `EffectSpec` that names one. */
export const EFFECTS: Record<EffectName, (spec?: FlickerSpec) => EffectPiece> = {
  flicker,
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/core/test/effects/pieces.test.ts`
Expected: PASS, 8 tests. If `'spends most of the pass lit'` fails, `unrest` is too high — do not weaken the assertion to match, tune the default.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/effects/pieces.ts packages/core/test/effects/pieces.test.ts
git commit -m "add the flicker piece"
```

---

### Task 7: Word builds the part pool

The pool is word-wide, so it can only be assembled after every letter's blueprint exists. Runs come from the blueprints; each letter contributes exactly one `body` part.

**Files:**
- Modify: `packages/core/src/render/word.ts`
- Test: `packages/core/test/render/word.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/test/render/word.test.ts`:

```ts
describe('part pool', () => {
  it('has one body part per drawn letter, numbered across the word', () => {
    const word = new Word('AA', stubFont(), 'gold', ROOMY);
    const parts = word.partsOf('body');

    expect(parts.map((p) => p.index)).toEqual([0, 1]);
    expect(parts.every((p) => p.count === 2)).toBe(true);
    expect(parts[0]?.letter.index).toBe(0);
    expect(parts[1]?.letter.index).toBe(1);
  });

  it('draws no body part for a glyph with no outline', () => {
    expect(new Word('A B', stubFont(), 'gold', ROOMY).partsOf('body')).toHaveLength(2);
  });

  it('has no run parts on a look with no tube', () => {
    expect(new Word('A', stubFont(), 'gold', ROOMY).partsOf('run')).toHaveLength(0);
  });

  it('numbers run parts across the whole word, not per letter', () => {
    const word = new Word('AA', stubFont(), 'tubing', ROOMY);
    const parts = word.partsOf('run');

    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((p) => p.index)).toEqual(parts.map((_, n) => n));
    expect(new Set(parts.map((p) => p.letter.index))).toEqual(new Set([0, 1]));
  });

  it('gives every run part a share of the pool extent that sums to one', () => {
    const parts = new Word('AA', stubFont(), 'tubing', ROOMY).partsOf('run');
    const total = parts.reduce((a, p) => a + p.span, 0);

    expect(total).toBeCloseTo(1, 5);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/core/test/render/word.test.ts -t "part pool"`
Expected: FAIL — `word.partsOf is not a function`.

- [ ] **Step 3: Record what each part needs as it is built**

In `packages/core/src/render/word.ts`, add near the other private field declarations:

```ts
  /** One entry per addressable part, in pool order. Built after every letter exists. */
  private readonly parts: PartInfo[] = [];
  /** The mesh each part draws through, index-parallel to `parts`. */
  private readonly partMeshes: THREE.Mesh[] = [];
  /** A run part's own colour, so an effect composes from the base rather than from last frame. */
  private readonly partBaseColor: number[] = [];
```

Import `PartInfo` and `PartKind` from `../effects/types.js`.

The body mesh and the run meshes are currently created inline. Capture them. Replace line 297:

```ts
    const cell = new THREE.Group();
    cell.add(new THREE.Mesh(geo, material));
```

with:

```ts
    const cell = new THREE.Group();
    const bodyMesh = new THREE.Mesh(geo, material);
    cell.add(bodyMesh);
    this.bodyMeshes[i] = bodyMesh;
```

adding a `private readonly bodyMeshes: (THREE.Mesh | null)[] = [];` field. Assign by index rather than pushing: a glyph that draws no outline never reaches this line, and a sparse array reads as `undefined` at that slot, which `buildParts` already skips.

Replace line 351:

```ts
      for (const geo of blueprint.lit) cell.add(new THREE.Mesh(geo, decorMaterial));
```

with:

```ts
      const litMeshes: THREE.Mesh[] = [];
      for (const geo of blueprint.lit) {
        const mesh = new THREE.Mesh(geo, decorMaterial);
        litMeshes.push(mesh);
        cell.add(mesh);
      }
      this.litMeshes[i] = litMeshes;
```

adding a `private readonly litMeshes: THREE.Mesh[][] = [];` field.

- [ ] **Step 4: Assemble the pool**

Add a private method, called once at the end of the constructor after every letter has been built:

```ts
  /**
   * The word-wide pools. Assembled after construction because `index` and `count` span the whole
   * sign — `{ amount: 1 }` is one bad tube in the word rather than one per letter.
   */
  private buildParts(): void {
    const bodies: { i: number; mesh: THREE.Mesh }[] = [];
    for (let i = 0; i < this.letters.length; i++) {
      const mesh = this.bodyMeshes[i];
      if (mesh) bodies.push({ i, mesh });
    }
    for (let n = 0; n < bodies.length; n++) {
      const { i, mesh } = bodies[n] as { i: number; mesh: THREE.Mesh };
      this.parts.push({
        kind: 'body',
        index: n,
        count: bodies.length,
        letter: this.letterInfo(i),
        x: this.baseX[i] as number,
        y: this.baseY[i] as number,
        at: bodies.length > 0 ? n / bodies.length : 0,
        span: bodies.length > 0 ? 1 / bodies.length : 0,
      });
      this.partMeshes.push(mesh);
      this.partBaseColor.push(0xffffff);
    }

    // A run's share is its arc length, not its ordinal: runs differ in length by an order of
    // magnitude, and an ordinal share would put a chase's dwell in the wrong place.
    const runs: { i: number; r: number; mesh: THREE.Mesh; length: number; color: number }[] = [];
    for (let i = 0; i < this.tubeBlueprints.length; i++) {
      const blueprint = this.tubeBlueprints[i];
      const meshes = this.litMeshes[i];
      if (!blueprint || !meshes) continue;
      const lit = blueprint.runs.filter((run) => run.lit);
      for (let r = 0; r < meshes.length; r++) {
        const run = lit[r];
        const mesh = meshes[r];
        if (!run || !mesh) continue;
        runs.push({ i, r, mesh, length: run.length, color: run.color });
      }
    }
    const total = runs.reduce((a, run) => a + run.length, 0);
    let walked = 0;
    for (let n = 0; n < runs.length; n++) {
      const entry = runs[n] as (typeof runs)[number];
      this.parts.push({
        kind: 'run',
        index: n,
        count: runs.length,
        letter: this.letterInfo(entry.i),
        x: this.baseX[entry.i] as number,
        y: this.baseY[entry.i] as number,
        at: total > 0 ? walked / total : 0,
        span: total > 0 ? entry.length / total : 0,
      });
      this.partMeshes.push(entry.mesh);
      this.partBaseColor.push(entry.color);
      walked += entry.length;
    }
  }

  /** The word's parts of one kind, in pool order. */
  partsOf(kind: PartKind): readonly PartInfo[] {
    return this.parts.filter((p) => p.kind === kind);
  }
```

**A part must carry its letter's grid position, or `grid: true` lies.** `orderKey` gates its radial
branch on `item.column !== undefined`, so a `PartInfo` without `line`/`column` compiles fine and
silently falls back to reading order — a stagger option that appears to work and does not. A part's
grid position is its letter's, and `PartInfo.letter` already holds both, so copy them across when
building each part:

```ts
        line: this.lineOf[i],
        column: this.columnOf[i],
        lineCount: this.lineCount,
        columnCount: this.columnCount,
```

Add the four optional fields to `PartInfo` in `effects/types.ts` when you do, and pin it with a test
that `orderKey(part, { grid: true, from: 'center' })` differs from the reading-order result for a
part whose letter sits off-centre in a multi-row block.

Note `blueprint.lit` and `blueprint.runs.filter(r => r.lit)` are index-parallel — `buildTubeBlueprint` pushes a geometry per run in run order and skips only runs whose sweep returned nothing. If `meshes.length !== lit.length` for any letter the pairing is wrong; add an assertion in a test rather than silently mis-pairing.

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run packages/core/test/render/word.test.ts -t "part pool"`
Expected: PASS, 5 tests.

- [ ] **Step 6: Make the pairing assumption fail loudly**

`buildParts` pairs `blueprint.lit[r]` with `blueprint.runs.filter(r => r.lit)[r]` by ordinal. That holds only while `sweepRun` returns a geometry for every lit run — one null shifts every pair after it, and every effect then targets the wrong tube with nothing thrown. Assert it instead of trusting it.

In `buildParts`, replace the `for (let r = 0; r < meshes.length; r++)` loop header with a check first:

```ts
      if (meshes.length !== lit.length) {
        throw new Error(
          `tube blueprint ${i}: ${meshes.length} lit meshes for ${lit.length} lit runs`,
        );
      }
      for (let r = 0; r < meshes.length; r++) {
```

Add the test that exercises it across the alphabet:

```ts
  it('pairs a lit mesh with a lit run for every letter of both tube looks', () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (const look of ['tubing', 'piping'] as const) {
      for (const char of letters) {
        expect(() => new Word(char, stubFont(), look, ROOMY)).not.toThrow();
      }
    }
  });
```

If this throws for some letter, the pairing is genuinely unsafe and `buildParts` must key on the run's own `index` rather than on ordinal — do not relax the check.

- [ ] **Step 7: Verify nothing moved**

Run: `npm run check`
Expected: PASS, 818 tests (805 + 8 from Task 6 + 5 here).

Run: `npx playwright test`
Expected: 23 passed. This task only records references to meshes that already existed, so any baseline movement means a mesh was created differently, not merely captured.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/render/word.ts packages/core/test/render/word.test.ts
git commit -m "assemble the word-wide part pool"
```

---

### Task 8: Apply resolved offsets, and the public surface

**Files:**
- Modify: `packages/core/src/render/word.ts` (`apply`), `packages/core/src/render/looks.ts` (`LookSpec.effects`), `packages/core/src/index.ts`
- Test: `packages/core/test/render/word.test.ts`, `apps/lab/test/looks.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/test/render/word.test.ts`. Extend its imports with `specOf` from `../../src/render/looks.js` and `EffectPiece` from `../../src/effects/types.js`.

```ts
describe('effects', () => {
  const STILL = new Timeline({ enter: NONE, active: NONE, exit: NONE, hold: 0, blendMs: 0 });
  /** Writes a fixed gain to every part it is given, so the test asserts routing, not waveform. */
  const half: EffectPiece = { duration: 1000, at: () => ({ gain: 0.5 }) };

  it('leaves every part untouched when a look declares no effects', () => {
    const word = new Word('A', stubFont(), 'tubing', ROOMY);
    const before = [...word.debugRunColorOf(0)];

    word.apply(STILL, 0);

    expect([...word.debugRunColorOf(0)]).toEqual(before);
  });

  it('scales a targeted run own colour by the gain', () => {
    const word = new Word('A', stubFont(), {
      ...specOf('tubing'),
      effects: [{ piece: half, target: { kind: 'run', by: 'index', amount: 1 }, seed: 0 }],
    }, ROOMY);

    word.apply(STILL, 0);

    const first = word.debugRunColorOf(0);
    const second = word.debugRunColorOf(1);
    // Run 0 is the only one selected, and its colour is halved; run 1 is untouched.
    expect(first[0]).toBeCloseTo(second[0] * 0.5, 5);
  });

  it('does not compound across frames', () => {
    const word = new Word('A', stubFont(), {
      ...specOf('tubing'),
      effects: [{ piece: half, target: { kind: 'run', by: 'index', amount: 1 }, seed: 0 }],
    }, ROOMY);

    word.apply(STILL, 0);
    const once = [...word.debugRunColorOf(0)];
    word.apply(STILL, 16);
    word.apply(STILL, 32);

    expect([...word.debugRunColorOf(0)]).toEqual(once);
  });

  it('drives a body through emissiveIntensity rather than through the attribute', () => {
    const word = new Word('A', stubFont(), {
      ...specOf('neon'),
      effects: [{ piece: half, target: { kind: 'body', by: 'index', amount: 1 }, seed: 0 }],
    }, ROOMY);

    word.apply(STILL, 0);

    const cell = word.group.children[0]?.children[0] as THREE.Group;
    const mesh = cell.children[0] as THREE.Mesh;
    expect((mesh.material as THREE.MeshPhysicalMaterial).emissiveIntensity).toBeCloseTo(1.6, 5);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run packages/core/test/render/word.test.ts -t "effects"`
Expected: FAIL — `word.debugRunColorOf is not a function`.

- [ ] **Step 3: Declare effects on a look**

In `packages/core/src/render/looks.ts`, add to `LookSpec`:

```ts
  /** Appearance driven over time, below the level of a letter. Empty or absent renders statically. */
  effects?: EffectSpec[];
```

and import `EffectSpec` from `../effects/types.js`.

- [ ] **Step 4: Resolve the targets once**

In `word.ts`, add a field and build it at the end of the constructor after `buildParts()`:

```ts
  /** Per effect: the resolved piece and the part indices it drives. Selection is not per frame. */
  private readonly effects: { piece: EffectPiece; parts: number[]; stagger?: number | StaggerSpec }[] =
    [];
```

```ts
  private buildEffects(specs: readonly EffectSpec[]): void {
    for (const spec of specs) {
      const pool = this.parts
        .map((part, index) => ({ part, index }))
        .filter(({ part }) => part.kind === spec.target.kind);
      // `length` ranks a `by: 'length'` selection; a part's span is its share of the pool extent.
      const chosen = selectIndices(
        pool.map(({ part }) => ({ index: part.index, length: part.span })),
        spec.target,
        spec.seed ?? 0,
      );
      const piece = typeof spec.piece === 'string' ? EFFECTS[spec.piece]() : spec.piece;
      this.effects.push({
        piece,
        stagger: spec.stagger,
        parts: pool.filter(({ part }) => chosen.has(part.index)).map(({ index }) => index),
      });
    }
  }
```

- [ ] **Step 5: Apply them per frame**

Add to `apply()`, after the existing per-letter loop:

```ts
    if (this.effects.length === 0) return;
    this.applyEffects(elapsed);
```

and the method:

```ts
  /** Only targeted parts are written; an untargeted part costs nothing per frame. */
  private applyEffects(elapsed: number): void {
    const layered = new Map<number, PartOffset[]>();
    for (const effect of this.effects) {
      for (const index of effect.parts) {
        const part = this.parts[index] as PartInfo;
        const pass = effect.piece.duration > 0 ? (elapsed % effect.piece.duration) /
          effect.piece.duration : 0;
        const t = effect.stagger === undefined ? pass : stagger(pass, part, effect.stagger);
        const list = layered.get(index) ?? [];
        list.push(effect.piece.at(t, part));
        layered.set(index, list);
      }
    }

    for (const [index, offsets] of layered) {
      this.writePart(index, mergeOffsets(offsets));
    }
  }

  private writePart(index: number, out: ResolvedOffset): void {
    const part = this.parts[index] as PartInfo;
    const mesh = this.partMeshes[index] as THREE.Mesh;

    mesh.position.set(...out.position);
    mesh.rotation.set(...out.rotation);
    mesh.scale.setScalar(out.scale);

    if (part.kind === 'body') {
      setEmissiveIntensity(
        mesh.material as THREE.Material,
        this.bodyBase.emissiveIntensity * out.gain,
      );
      return;
    }

    // A run carries its colour on a per-vertex attribute the look's shader already reads, so gain
    // and colour are one buffer write and no new material.
    const attribute = mesh.geometry.getAttribute(RUN_COLOR_ATTRIBUTE) as
      | THREE.BufferAttribute
      | undefined;
    if (!attribute) return;
    const base = new THREE.Color(out.color ?? (this.partBaseColor[index] as number));
    base.multiplyScalar(out.gain);
    const array = attribute.array as Float32Array;
    for (let v = 0; v < array.length; v += 3) {
      array[v] = base.r;
      array[v + 1] = base.g;
      array[v + 2] = base.b;
    }
    attribute.needsUpdate = true;
  }
```

Import `mergeOffsets` from `../effects/compositor.js`, `EFFECTS` from `../effects/pieces.js`, `stagger` and `StaggerSpec` from `../motion/types.js`, `selectIndices` from `../../select.js`, `RUN_COLOR_ATTRIBUTE` from `./tube/tint.js`, and `EffectPiece`, `EffectSpec`, `PartInfo`, `PartKind`, `PartOffset`, `ResolvedOffset` from `../effects/types.js`. `REST_OFFSET` is not needed here — it is only used by the compositor's own tests and by the Step 11 mutation.

- [ ] **Step 6: Add the test accessor**

`debugRunColorOf` is test-facing and reads a buffer that has no other reader. Add it beside `partsOf`:

```ts
  /** The composed run colour of one part, for tests that assert an effect landed. @internal */
  debugRunColorOf(runOrdinal: number): Float32Array {
    const part = this.parts.findIndex((p) => p.kind === 'run' && p.index === runOrdinal);
    const mesh = this.partMeshes[part] as THREE.Mesh;
    return (mesh.geometry.getAttribute(RUN_COLOR_ATTRIBUTE) as THREE.BufferAttribute)
      .array as Float32Array;
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run packages/core/test/render/word.test.ts -t "effects"`
Expected: PASS, 4 tests. The `'does not compound'` test is the one that proves the write composes from `partBaseColor` rather than from the buffer — if it fails, the base is being read from the attribute.

- [ ] **Step 8: Wire the public API**

In `packages/core/src/index.ts`:

```ts
export type {
  EffectName,
  EffectPiece,
  EffectSpec,
  PartInfo,
  PartKind,
  PartOffset,
} from './effects/types.js';
export { EFFECTS } from './effects/pieces.js';
export const EFFECT_NAMES: readonly EffectName[] = Object.keys(EFFECTS) as EffectName[];
export type { SelectSpec } from './select.js';
```

Add to `FireOptions`:

```ts
  /**
   * Appearance driven over time, below the level of a letter. Replaces the look's own list rather
   * than adding to it — spread `specOf(look).effects` to keep them.
   */
  effects?: EffectSpec[];
```

and, where `new Word(...)` is constructed in `index.ts`, pass the resolved look with `effects` overridden when the caller supplied any.

- [ ] **Step 9: Add the visual baseline**

In `apps/lab/test/looks.spec.ts`, add a case that fires `tubing` with one flickering run at a pinned clock. Follow the existing harness exactly — the clock must be pinned or the shot flakes.

Run: `npx playwright test --update-snapshots -g "flicker"`
Expected: one new baseline recorded. **Do not run `--update-snapshots` without `-g`** — it rewrites every baseline.

- [ ] **Step 10: Verify the whole thing**

Run: `npm run check`
Expected: PASS, 822 tests.

Run: `npx playwright test`
Expected: 24 passed — the original 23 unchanged plus the new one. **The 23 being unchanged is the claim that this whole plan moved no shipped look.**

- [ ] **Step 11: Verify by mutation**

Change `mergeOffsets` to return `REST_OFFSET` unconditionally and run `npx vitest run packages/core/test/render/word.test.ts -t "effects"`. Expected: the gain tests FAIL. Restore.

- [ ] **Step 12: Commit**

```bash
git add packages/core/src apps/lab/test packages/core/test
git commit -m "drive a part's appearance from a look's effects"
```

---

## Self-review notes for the implementer

Three things in this plan are assumptions about existing code that were read but not executed. Check each before trusting the step that rests on it:

- **`blueprint.lit` is index-parallel to `blueprint.runs.filter(r => r.lit)`.** `buildTubeBlueprint` skips a run whose `sweepRun` returns nothing, so a null geometry would shift the pairing. Task 7 step 6 asks you to make this throw rather than assume it.
- **`stagger(pass, part, spec)` expects `part` to satisfy `Ordered`.** `PartInfo` has `index` and `count` and no `line`/`column`, so `from: 'grid'` falls back to reading order for parts. That is correct but undocumented; note it in `StaggerSpec` if it surprises you.
- **`FireOptions.effects` replacing the look's list** means `fire('X', { look: 'tubing', effects: [...] })` drops whatever `tubing` declared. This is deliberate (design doc, Traps) — do not "fix" it to append.
