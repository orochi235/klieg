# Decoration registry teardown — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**For:** an engineer who knows TypeScript and three.js but nothing about klieg. **Answers:** how to
replace `word.ts`'s hardcoded `decoration.kind` switch with a registry, changing no pixels.

**Goal:** `Word` stops naming `'tube'` and `'chunks'`; each decoration kind supplies its own builder.

**Architecture:** A `DecorationBuilder` owns everything a decoration kind needs — its shared
resources, its per-letter meshes and materials, the parts it contributes to effect targeting, its
per-frame material writes, and its disposal. `Word` holds one builder (or none) and calls it through
a fixed interface. The per-kind state currently living in ~12 parallel arrays on `Word` moves into
the builder that uses it.

**Tech Stack:** TypeScript, three.js, vitest (unit), Playwright (visual baselines).

**Acceptance for every task: all 40 visual baselines byte-identical.** This slice buys nothing
visible. A moved pixel is a bug, not a judgement call.

**This is the first slice of [wells and fills](../specs/2026-09-01-wells-and-fills-design.md)**,
which adds a family of new decoration kinds. Its "Order" section puts this teardown first and alone.

---

## Two constraints that are easy to violate

**`PartKind` stays closed.** It is `'run' | 'body' | 'chunk'` in `packages/core/src/effects/types.ts:10`
and it is public API — effect specs target parts by kind, so callers write `target: { kind: 'run' }`.
The registry lets a kind *contribute* parts; it does **not** let a builder invent a new `PartKind`.
Adding one is a deliberate public API change, made in the slice that needs it, not here.

**Nothing new gets exported from `index.ts`.** `DecorationBuilder` and `WordBuildContext` are
package-internal. `packages/core/src/index.ts:96` exports `DecorationSpec` and `MaterialSpec` and
that list does not grow in this slice.

## File structure

- Create `packages/core/src/render/decorations/registry.ts` — the `DecorationBuilder` and
  `WordBuildContext` interfaces, and `decorationBuilderFor(spec, ctx)`.
- Create `packages/core/src/render/decorations/chunks.ts` — `ChunksBuilder`.
- Create `packages/core/src/render/decorations/tube.ts` — `TubeBuilder`.
- Modify `packages/core/src/render/word.ts` — hold one builder, delete the switch and the per-kind fields.
- Create `packages/core/test/render/decorations/registry.test.ts`.

`render/tube/` is the precedent for a subdirectory under `render/`; tests mirror the source tree.

---

### Task 1: The builder seam

Defines the interface and the lookup. Nothing is wired to it yet, so every existing test stays green
for the reason it already was.

**Files:**
- Create: `packages/core/src/render/decorations/registry.ts`
- Test: `packages/core/test/render/decorations/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import type { WordBuildContext } from '../../../src/render/decorations/registry.js';
import { decorationBuilderFor } from '../../../src/render/decorations/registry.js';

const ctx = {} as WordBuildContext;

describe('decorationBuilderFor', () => {
  it('has a factory registered for each shipped kind', () => {
    // Until Tasks 2 and 3 land, reaching the factory is the most that can be asserted — it
    // throws on construction rather than answering a builder.
    expect(() => decorationBuilderFor({ kind: 'chunks' } as never, ctx)).toThrow(
      'chunks builder not yet implemented',
    );
    expect(() => decorationBuilderFor({ kind: 'tube' } as never, ctx)).toThrow(
      'tube builder not yet implemented',
    );
  });

  it('answers null for no decoration at all', () => {
    expect(decorationBuilderFor(undefined, ctx)).toBeNull();
  });

  // A spec that reached here with a kind nobody registered is a wiring bug, and a silent null
  // would render an undecorated word rather than say so.
  it('throws on a kind nobody registered', () => {
    expect(() => decorationBuilderFor({ kind: 'well' } as never, ctx)).toThrow(/well/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/test/render/decorations/registry.test.ts`
Expected: FAIL — cannot resolve `../../../src/render/decorations/registry.js`.

- [ ] **Step 3: Write the interface and the lookup**

`packages/core/src/render/decorations/registry.ts`. The interface members are derived from the five
seams the switch currently spans in `word.ts`; each one names the lines it replaces.

```ts
import type * as THREE from 'three';
import type { PartInfo } from '../../effects/types.js';
import type { LoadedFont } from '../../text/font.js';
import type { WordCaches } from '../caches.js';
import type { DecorationSpec } from '../decoration.js';
import type { LightBase } from '../looks.js';
// Type-only: word.ts imports this module in Task 2, and a type-only import is erased at
// compile time, so this creates no runtime cycle.
import type { WordDebugHooks } from '../word.js';

/** What a builder may reach back into on the `Word` that owns it. */
export interface WordBuildContext {
  readonly font: LoadedFont;
  readonly caches: WordCaches;
  readonly debug?: WordDebugHooks;
  /** Letter origins in em, indexed by letter slot. Live for the word's lifetime. */
  readonly baseX: readonly number[];
  readonly baseY: readonly number[];
  /** A fresh material carrying the studio's environment settings. */
  studioMaterial(): THREE.MeshPhysicalMaterial;
  glyph(char: string, depth: number): THREE.ExtrudeGeometry;
  /** A letter playing its exit; its parts are left alone. */
  leavingAt(index: number): boolean;
  partInfo(
    kind: PartInfo['kind'],
    ordinal: number,
    of: number,
    slot: number,
    at: number,
    span: number,
    ink?: number,
  ): PartInfo;
  meshInk(slot: number, mesh: THREE.Mesh): number;
}

/** One part a decoration contributes to the word's pool, in the order the pool takes them. */
export interface DecorationPart {
  info: PartInfo;
  mesh: THREE.Mesh | THREE.InstancedMesh;
  /** The part's own colour, so an effect composes from the base rather than from last frame. */
  baseColor: number;
  /** Whether `writePart` may drive this part through the run-colour buffer. */
  readsRunColor: boolean;
  slot: number;
}

export interface DecorationBuilder {
  /** Build letter `index`'s decoration into `sized`. Called once per letter, in slot order. */
  buildLetter(index: number, char: string, sized: THREE.Group, tint: number | undefined): void;
  /** A letter that drew no ink. Keeps every per-letter slot aligned with the letter pool. */
  skipLetter(index: number): void;
  /** The parts this decoration contributes, once every letter is built. */
  collectParts(): DecorationPart[];
  /** Per-frame material writes for letter `index`; `opacity` is the pose's own. */
  frame(index: number, opacity: number): void;
  /** This letter's decoration bounds in its own em space, or null. Drives the gradient span. */
  boundsAt(index: number): THREE.Box2 | null;
  /** The live letters' union bounds, once known, so a positional gradient can be mapped. */
  applyGradientBounds(word: THREE.Box2): void;
  /** The effect write for one part this decoration contributed. `Word` owns transform; this owns colour. */
  writePart(slot: number, mesh: THREE.Mesh, out: ResolvedOffset): void;
  dispose(): void;
}

type BuilderFactory = (spec: never, ctx: WordBuildContext) => DecorationBuilder;

const REGISTRY = new Map<string, BuilderFactory>();

export function registerDecoration<K extends DecorationSpec['kind']>(
  kind: K,
  make: (spec: Extract<DecorationSpec, { kind: K }>, ctx: WordBuildContext) => DecorationBuilder,
): void {
  REGISTRY.set(kind, make as BuilderFactory);
}

export function decorationBuilderFor(
  spec: DecorationSpec | undefined,
  ctx: WordBuildContext,
): DecorationBuilder | null {
  if (!spec) return null;
  const make = REGISTRY.get(spec.kind);
  if (!make) throw new Error(`no decoration builder registered for kind '${spec.kind}'`);
  return make(spec as never, ctx);
}
```

The test's first case needs both shipped kinds registered, and they are not written until Tasks 2
and 3. Register placeholders now and replace their bodies there — add to the bottom of
`registry.ts`:

```ts
// Replaced by the real builders in Tasks 2 and 3.
registerDecoration('chunks', () => {
  throw new Error('chunks builder not yet implemented');
});
registerDecoration('tube', () => {
  throw new Error('tube builder not yet implemented');
});
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run packages/core/test/render/decorations/registry.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean. `LoadedFont` and `WordCaches` import paths are the ones `word.ts` already
uses — copy them from its import block rather than guessing.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/render/decorations/registry.ts packages/core/test/render/decorations/registry.test.ts
git commit -m "add the decoration builder seam"
```

---

### Task 2: Move the chunk field behind a builder

Chunks is the smaller of the two branches, so it proves the seam before the tube's weight lands on
it. The tube stays inline and working throughout this task.

**Files:**
- Create: `packages/core/src/render/decorations/chunks.ts`
- Modify: `packages/core/src/render/word.ts` — remove the chunk branch and its fields
- Test: `packages/core/test/render/decorations/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `registry.test.ts`. `sequin` is the shipped chunks look, so build against its spec rather
than a hand-made one; `specOf` resolves a look to its spec.

```ts
import { specOf } from '../../../src/render/looks.js';

describe('ChunksBuilder', () => {
  it('adds one instanced draw per letter that drew ink', () => {
    const spec = specOf('sequin');
    const decoration = spec.decoration;
    if (!decoration || decoration.kind !== 'chunks') throw new Error('sequin is not a chunk look');

    const builder = decorationBuilderFor(decoration, wordContext());
    if (!builder) throw new Error('no builder');
    const sized = new THREE.Group();
    builder.buildLetter(0, 'A', sized, undefined);

    const instanced = sized.children.filter((c) => (c as THREE.InstancedMesh).isInstancedMesh);
    expect(instanced).toHaveLength(1);
    expect(builder.collectParts()).toHaveLength(1);
    builder.dispose();
  });
});
```

`wordContext()` is a helper this test file needs: a `LoadedFont` and a `WordCaches`, because a chunk
blueprint is built off actual glyph geometry.

**There is no shared font helper — the suite has two patterns, and this test wants the first.**
`word.test.ts:48` defines `stubFont()`, whose glyphs are 0.5 em boxes rising 0.7 em; it is fast, has
no disk dependency, and gives a chunk field real area to scatter over. Copy it. The other pattern is
`packages/core/test/render/tube/reports.test.ts:18-21`, which parses a real TTF off disk with
`opentype.parse` — reach for that only if a box's four corners turn out to be too few contours for
the tube assertions in Task 3. Do not try the lab's `?url` font import; it does not resolve under
vitest.

```ts
function wordContext(): WordBuildContext {
  const font = stubFont();
  const caches = new WordCaches();
  return {
    font,
    caches,
    baseX: [0],
    baseY: [0],
    studioMaterial: () => new THREE.MeshPhysicalMaterial(),
    glyph: (char, depth) => caches.glyph(font, char, depth),
    leavingAt: () => false,
    partInfo: (kind, ordinal, of, slot, at, span) =>
      ({ kind, ordinal, of, slot, at, span }) as never,
    meshInk: () => 1,
  };
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/test/render/decorations/registry.test.ts`
Expected: FAIL — "chunks builder not yet implemented".

- [ ] **Step 3: Write `ChunksBuilder`**

Move, verbatim, out of `word.ts`:

- the chunk branch, `word.ts:810-844` (`} else if (decoration && decoration.kind === 'chunks') {` through the close of its `if (blueprint.kind === 'chunks' && this.chunkGeo)`)
- `chunkBlueprintFor`, `word.ts:645-656`
- the chunk part pool, `word.ts:402-414` — becomes `collectParts()`
- the field's per-frame emissive write, `word.ts:1071-1076` — becomes `frame()`
- the chunk fields: `chunkMeshes`, `chunkLights`, `chunkGeo`, `chunkGeos`, `decorCache`
  (`word.ts:182,184,213,223,225`) and their ctor seeding at `word.ts:265,274-282`
- the chunk disposal, `word.ts:1092-1093,1113-1116`

`boundsAt()` returns `null` — a chunk field never contributed to the gradient span; `word.ts:820`
pushed null into `tubeBounds` for exactly this. `lightAt(index)` returns `chunkLights[index]`.
`skipLetter` pushes null into `chunkMeshes` and `chunkLights`.

`decorMaterials` and `decorBase` stay on `Word` for now — the tube branch still writes them, and
they move in Task 4.

Replace the placeholder registration with

```ts
registerDecoration('chunks', (spec: ChunkSpec, ctx) => new ChunksBuilder(spec, ctx));
```

- [ ] **Step 4: Wire `Word` to it for chunks only**

In the `Word` constructor, after `const decoration = spec.decoration;`:

```ts
this.builder = decoration?.kind === 'chunks' ? decorationBuilderFor(decoration, this) : null;
```

This line is deliberately still a `kind` test — Task 3 widens it and Task 4 checks it is gone.
`Word` implements `WordBuildContext`; `partInfo`, `meshInk`, `studioMaterial`, `glyph` and
`leavingAt` are already private methods with the right shapes. Widen them by dropping `private`
rather than adding forwarding methods.

**`debug` has to become a field.** `WordBuildContext` carries `debug?: WordDebugHooks`, but `Word`
currently threads `debug` as a parameter (`word.ts:244` into `word.ts:688`) and stores it nowhere.
Add `private readonly debug?: WordDebugHooks` and seed it in the constructor. Chunks does not read
it; Task 3's tube does, and it must be on the context before that builder is written.

Call the builder where the deleted code stood: `buildLetter` in the cell build, `skipLetter` in the
no-ink early return at `word.ts:696-699`, `collectParts` where the chunk pool was, `frame` in the
per-frame loop, `dispose` in `dispose()`.

- [ ] **Step 5: Run the unit suite**

Run: `npm test`
Expected: PASS, at the baseline count plus this task's new specs. `word.test.ts` and `looks.test.ts`
both cover chunk fields and must pass unchanged — **do not edit a test to make it pass.** A red test
here means the move changed behavior.

- [ ] **Step 6: Run the visual baselines**

Run: `npx playwright test`
Expected: 41 passed. `looks › sequin` is the one that would move; it must not.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "move the chunk field behind a decoration builder"
```

---

### Task 3: Move the tube behind a builder

**Files:**
- Create: `packages/core/src/render/decorations/tube.ts`
- Modify: `packages/core/src/render/word.ts`
- Test: `packages/core/test/render/decorations/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('TubeBuilder', () => {
  it('adds a mesh per lit run and contributes each as a part', () => {
    const spec = specOf('tubing');
    const decoration = spec.decoration;
    if (!decoration || decoration.kind !== 'tube') throw new Error('tubing is not a tube look');

    const builder = decorationBuilderFor(decoration, wordContext());
    if (!builder) throw new Error('no builder');
    const sized = new THREE.Group();
    builder.buildLetter(0, 'A', sized, undefined);

    const parts = builder.collectParts();
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.every((p) => p.info.kind === 'run')).toBe(true);
    expect(builder.boundsAt(0)).not.toBeNull();
    builder.dispose();
  });

  it('leaves a letter that drew no ink with no bounds', () => {
    const spec = specOf('tubing');
    const builder = decorationBuilderFor(spec.decoration, wordContext());
    if (!builder) throw new Error('no builder');
    builder.skipLetter(0);
    expect(builder.boundsAt(0)).toBeNull();
    expect(builder.collectParts()).toHaveLength(0);
    builder.dispose();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/test/render/decorations/registry.test.ts`
Expected: FAIL — "tube builder not yet implemented".

- [ ] **Step 3: Write `TubeBuilder`**

Move, verbatim, out of `word.ts`:

- the tube branch, `word.ts:735-809`
- the run part pool, `word.ts:352-397` (the `runs` collection and the arc-length walk that pushes
  run parts) — becomes `collectParts()`. **Keep the arc-length share and the lit-mesh/lit-run
  pairing check exactly as they are**: the check at `word.ts:366` throws when the counts disagree,
  and it is there because one missing geometry shifts every later pair and lands each effect on a
  tube it never targeted. The arc-length share matters too — runs differ in length by an order of
  magnitude, and an ordinal share puts a chase's dwell somewhere other than where the glass is.
- `setGradientBounds`'s material walk, `word.ts:616-628` — becomes `applyGradientBounds()`. The
  bounds union over letters stays on `Word` and is fed from `boundsAt()`.

  **You are the first real user of this pair — chunks made both trivial, so neither has been
  exercised.** Two things the signatures do not say. `Word` must keep its `word.isEmpty()` early
  return *before* calling `applyGradientBounds`: an empty `THREE.Box2` is `min +Infinity /
  max -Infinity`, and handing that to the shader's bounds `Vector4` turns every positional gradient
  NaN. And the uniform objects are aliased into the compiled shader at `word.ts:585-586`, so
  `applyGradientBounds` must `.set()` them and never reassign — a fresh object leaves an already
  compiled letter on the pre-regroup mapping. That comment must survive the move verbatim.
- the dark material's per-frame write, `word.ts:1077-1081` — folds into `frame()`
- the tube fields: `darkMaterials`, `litMeshes`, `litReadsRunColor`, `tubeBlueprints`, `tubeBounds`,
  `gradientRamp` (`word.ts:178,186,191,218,220,222`) and their ctor seeding at `word.ts:264,266-269`
- the tube disposal, `word.ts:1096-1112`

**`writePart` is where the run's effect write goes.** Task 2 added `writePart` to the interface and
moved the chunk half out of `Word.writePart`, leaving the run branch inline. Move it now:
`RUN_COLOR_ATTRIBUTE`, `CRAWL_ATTRIBUTE`, the `partColor` scratch and the `partBaseColor` /
`partReadsRunColor` reads all belong to `TubeBuilder`. `Word.writePart` should be left with the
transform write and the `body` branch only — no `PartKind` dispatch for decorations at all.

Keep the two comments in that block verbatim. One says colour composes from `partBaseColor` rather
than the buffer, because reading last frame's value back and rescaling it compounds and fades the
sign to black in seconds. The other says hue and emissive are the same colour for a run.

**`setEmissiveIntensity` (`word.ts:70`) is module-private and you are the first outside caller.**
It guards `'emissiveIntensity' in material` because `debug.tubeMaterial` can hand back a base
`THREE.Material`. Export it or move it to `looks.ts` — do not copy it into `tube.ts`.

The `debug?.tubeMaterial` hook reaches the builder as `ctx.debug` — it is how the visual specs swap
in a flat material to read run colours back, and Task 2 put it on the context for this. Its two
calls (`'lit'`, `'dark'`) keep their meaning, and `litReadsRunColor` stays false under an override
for the reason the comment at `word.ts:742-744` gives.

Replace the placeholder registration with

```ts
registerDecoration('tube', (spec: TubeSpec, ctx) => new TubeBuilder(spec, ctx));
```

- [ ] **Step 4: Widen the constructor wiring**

```ts
this.builder = decorationBuilderFor(decoration, this);
```

The `kind` test from Task 2 goes; both kinds now resolve through the registry.

- [ ] **Step 5: Run the unit suite**

Run: `npm test`
Expected: PASS. `word.test.ts` covers run parts, gradient bounds and tube disposal heavily.

- [ ] **Step 6: Run the visual baselines**

Run: `npx playwright test`
Expected: 41 passed. `looks › tubing`, `looks › piping`, `off axis › tubing`, `off axis › piping`
and every effect spec exercise this path.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "move the tube behind a decoration builder"
```

---

### Task 4: Delete the switch

With both kinds behind builders, the remaining `decoration.kind` reads on `Word` are dead or
reducible. This task removes them and the last shared per-kind state.

**Files:**
- Modify: `packages/core/src/render/word.ts`

- [ ] **Step 1: Confirm what is left**

Run: `grep -n "decoration.kind\|decoration?.kind" packages/core/src/render/word.ts`
Expected: only the `decorMaterials` / `decorBase` seeding remains, if anything. Every hit is a line
this task deletes or moves.

- [ ] **Step 2: Move `decorMaterials` and the decoration bases into the builders**

`decorMaterials` (`word.ts:176`) is read in two places outside the branches: the per-frame opacity
write (`word.ts:1065-1069`) and `setGradientBounds` (`word.ts:616`). Both are now builder concerns —
the first is `frame()`, the second `applyGradientBounds()`. Delete the field and both reads.

`decorBase` and `darkBase` (frame-owned opacity and emissive intensity) move to the builder that
owns each. `bodyBase` stays on `Word`.

- [ ] **Step 3: Run the whole check**

Run: `npm run check`
Expected: lint, typecheck and the full unit suite clean. Typecheck is the one that catches a field
left declared and unread.

- [ ] **Step 4: Run the visual baselines**

Run: `npx playwright test`
Expected: 41 passed.

- [ ] **Step 5: Verify the switch is actually gone**

Run: `grep -c "kind === 'tube'\|kind === 'chunks'" packages/core/src/render/word.ts`
Expected: `0`.

**That grep alone is not sufficient acceptance** — it passes vacuously while a decoration switch
keyed on `PartKind` remains. Also run:

`grep -n "part.kind\|PartKind" packages/core/src/render/word.ts`

`writePart` should dispatch only `body` against everything else, with every decoration part
delegated to its builder. If a `'chunk'` or `'run'` test survives there, the switch moved rather
than died. (Tasks 2 and 3 do this work; this step is the check.)

This is the acceptance for the whole slice. `word.ts` should also be materially shorter — it starts
at 1,127 lines and was 1,030 after Task 2.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "drop the decoration kind switch from the word builder"
```

---

### Task 5: Record what the teardown learned

**Files:**
- Modify: `docs/superpowers/HANDOFF.md`
- Modify: `docs/superpowers/specs/2026-09-01-wells-and-fills-design.md`

- [ ] **Step 1: Mark the slice done in the design's Order section**

The "Order" section names this teardown as first. Say it is built, and where the seam is
(`render/decorations/registry.ts`), so the next slice adds a builder rather than rediscovering the
interface.

- [ ] **Step 2: Add a handoff entry**

Under "What is worth doing next", the wells-and-fills entry currently calls the teardown the open
item. Replace that with what the next person needs: the seam's methods, the two constraints at the
top of this plan, and the next slice (the plate cutter and regions).

Only what a reader could not get from the code. **Do not narrate this refactor's process.**

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "record the decoration registry seam in the handoff"
```

---

## Traps

**Do not edit a test to make it pass.** Every existing test is the characterization for this
refactor. A red one means behavior moved.

**Baselines are byte-compared and the suite derives its dev-server port from the worktree path**
(`playwright.config.ts`) — a run here cannot be judged against another checkout's server, which is a
trap this repo already hit and fixed.

**`chunkGeos` are per-letter clones and each one must still be disposed.** They exist only when a
look sets `relief`, so a leak here shows up on `sequin` alone.

**Parallel arrays are indexed by letter slot, and a letter that drew no ink is a hole, not a gap.**
Every `push` in the build path has a matching `push` in the no-ink early return. `skipLetter` is
what keeps that true once the pushes move; drop it and every field after the first blank letter is
off by one. A word containing a space is the case that breaks, and
`visual.spec.ts:444` is the baseline that catches it.

**`debugShapes` goes dead when the tube moves.** `word.ts:722` sets it inside the tube branch and
`word.ts:766-770` passes `debugShapes ?? glyphToShapes(font.font, char, EM)` to `debug.onLetter`.
Once the branch leaves, `Word` recomputes `glyphToShapes` per tube letter instead of reusing the one
the tube already built. Behaviorally identical, so it is not a bug — but it is an extra build on the
debug path the visual specs use, and the variable itself becomes dead. Remove it rather than leaving
it unread.
