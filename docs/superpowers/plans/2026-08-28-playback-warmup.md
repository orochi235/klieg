# Playback warmup and cross-fire caching — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop rebuilding glyph geometry and tube blueprints that a previous fire already built, and
move the GL-side mount cost off the critical path onto an idle callback after `createKlieg`.

**Architecture:** The design is
[the spec](../specs/2026-08-28-playback-warmup-design.md) — read it first; it carries the
measurements. Two caches move from `Word` fields to an instance-owned `WordCaches` that outlives an
unmount (a `BufferGeometry` is CPU-side and re-uploads to the next context). The GL side cannot
persist, so it is instead paid earlier: a warm on `requestIdleCallback` mounts the stage, builds the
environment, and renders one throwaway glyph to a 1×1 target to force the driver's program link.

**Tech stack:** TypeScript, three.js, opentype.js, vitest (node environment, no GL).

---

## Decisions this plan makes that the spec does not

**Cached tube blueprints need a lease.** `Word.writePart` (`render/word.ts:477`) writes the
`RUN_COLOR_ATTRIBUTE` buffer of a lit run's *geometry* every frame. Two words that are live at the
same time — which `policy: 'concurrent'` allows — sharing one blueprint would have each effect
writing the other's colours. So the blueprint store hands a blueprint to one word at a time: a
second taker of a leased key gets a freshly built one that is disposed on release rather than kept.
The glyph geometry cache needs no lease, because nothing writes into body geometry (one word already
shares one geometry between two of the same letter).

**The blueprint key carries the decoration and the tint, not just `(font, char, depth, seed)`.**
`buildTubeBlueprint` takes the `TubeSpec` (`render/word.ts:695`), and that spec is rewritten per
letter by `tintedTube(decoration, hue)` where `hue` comes from a caller's per-letter `tint`
callback. A key blind to either returns another look's tube, which is a wrong picture rather than an
error. Object-valued parts of the key (the `LoadedFont`, the `TubeSpec`) are interned to numbers;
`specOf` returns the canonical `LOOKS` entry for a named look, so a decoration's identity is stable
across fires.

**A borrowed store is not disposed by the borrower.** `Word` takes an optional store and makes its
own when it is not given one, so every existing direct construction (`test/render/word.test.ts`, the
dev labs) keeps today's ownership exactly.

## File structure

- **Create** `packages/core/src/render/caches.ts` — `WordCaches`: the interner, the glyph geometry
  store, and the leased tube blueprint store. One responsibility: what survives a `Word`.
- **Create** `packages/core/src/render/warm.ts` — `scheduleWarm`: the idle callback, its guards, and
  the throwaway render. Kept out of `index.ts`, which is already 1000 lines.
- **Create** `packages/core/test/render/caches.test.ts`.
- **Modify** `packages/core/src/text/glyphs.ts` — export `EM`.
- **Modify** `packages/core/src/render/word.ts` — borrow both stores.
- **Modify** `packages/core/src/index.ts` — own the caches, add `warmLook`, schedule the warm.
- **Modify** `packages/core/test/index.test.ts` (the warm's tests go here, where the stage and the
  renderer are already stubbed), `packages/core/test/render/word.test.ts`, `README.md`,
  `CHANGELOG.md`.

---

### Task 1: The glyph geometry store

**Files:**
- Modify: `packages/core/src/text/glyphs.ts:1` (export `EM`)
- Create: `packages/core/src/render/caches.ts`
- Test: `packages/core/test/render/caches.test.ts`

- [ ] **Step 1: Export `EM` from `glyphs.ts`**

`EM` is a private const in `word.ts:63`; the store builds geometry too, so it moves to the module
that owns glyph building. Add to `packages/core/src/text/glyphs.ts`, just above `GlyphOptions`:

```ts
/** Glyphs are built at 1 em; the group scale does the fitting. */
export const EM = 1;
```

In `packages/core/src/render/word.ts`, delete line 63 (`const EM = 1; // glyphs are built...`) and
add `EM` to the existing import block from `../text/glyphs.js` (lines 10–15), keeping the members
alphabetical:

```ts
import {
  buildGlyphGeometry,
  DEFAULT_GLYPH_OPTIONS,
  EM,
  GlyphCache,
  glyphToShapes,
} from '../text/glyphs.js';
```

- [ ] **Step 2: Run typecheck to confirm the move is clean**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Write the failing test**

Create `packages/core/test/render/caches.test.ts`:

```ts
import type { Font } from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { WordCaches } from '../../src/render/caches.js';
import type { LoadedFont } from '../../src/text/font.js';

const UPEM = 1000;
const ADVANCE = 600;
/** Every letter is a 0.5 em box, so each one builds a real geometry. */
const BOX = (size: number) => [
  { type: 'M', x: 0, y: 0 },
  { type: 'L', x: 0.5 * size, y: 0 },
  { type: 'L', x: 0.5 * size, y: -0.7 * size },
  { type: 'Z' },
];

function stubFont(): LoadedFont {
  const font = {
    unitsPerEm: UPEM,
    charToGlyph: (char: string) => ({
      advanceWidth: ADVANCE,
      getPath: (_x: number, _y: number, size: number) => ({
        commands: char === ' ' ? [] : BOX(size),
      }),
    }),
    getKerningValue: () => 0,
  } as unknown as Font;
  return {
    font,
    unitsPerEm: UPEM,
    metrics: { advanceOf: () => ADVANCE, kernOf: () => 0 },
    bytes: new ArrayBuffer(8),
  };
}

describe('WordCaches.glyph', () => {
  it('returns the same geometry object for a repeated (font, char, depth)', () => {
    const caches = new WordCaches();
    const font = stubFont();
    expect(caches.glyph(font, 'A', 0.3)).toBe(caches.glyph(font, 'A', 0.3));
  });

  it('discriminates the font, the char and the depth one at a time', () => {
    const caches = new WordCaches();
    const font = stubFont();
    const other = stubFont();
    const base = caches.glyph(font, 'A', 0.3);
    expect(caches.glyph(other, 'A', 0.3)).not.toBe(base);
    expect(caches.glyph(font, 'B', 0.3)).not.toBe(base);
    expect(caches.glyph(font, 'A', 0.4)).not.toBe(base);
  });

  it('disposes every geometry it built and refuses to build after dispose', () => {
    const caches = new WordCaches();
    const font = stubFont();
    const geo = caches.glyph(font, 'A', 0.3);
    let disposed = false;
    geo.addEventListener('dispose', () => {
      disposed = true;
    });
    caches.dispose();
    expect(disposed).toBe(true);
    expect(() => caches.glyph(font, 'A', 0.3)).toThrow(/after dispose/);
  });
});
```

- [ ] **Step 4: Run it to make sure it fails**

Run: `npx vitest run packages/core/test/render/caches.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/render/caches.js"`.

- [ ] **Step 5: Write the store**

Create `packages/core/src/render/caches.ts`:

```ts
import type * as THREE from 'three';
import type { LoadedFont } from '../text/font.js';
import { buildGlyphGeometry, DEFAULT_GLYPH_OPTIONS, EM } from '../text/glyphs.js';

/**
 * Object-valued key parts (a loaded font, a tube spec) become numbers, so one flat string key can
 * discriminate them. Weak, because an id outliving its object would hold the object alive.
 */
class Interner {
  private readonly ids = new WeakMap<object, number>();
  private next = 0;

  id(value: object): number {
    let id = this.ids.get(value);
    if (id === undefined) {
      id = this.next++;
      this.ids.set(value, id);
    }
    return id;
  }
}

/**
 * The caches that outlive a `Word` and an unmount. A `BufferGeometry` is CPU-side and re-uploads
 * itself to whatever context draws it next, which is the only reason this can be instance-scoped
 * while the renderer is not.
 */
export class WordCaches {
  private readonly interner = new Interner();
  private readonly geometries = new Map<string, THREE.ExtrudeGeometry>();
  private disposed = false;

  get size(): number {
    return this.geometries.size;
  }

  glyph(font: LoadedFont, char: string, depth: number): THREE.ExtrudeGeometry {
    if (this.disposed) throw new Error('klieg: WordCaches used after dispose');
    const key = `${this.interner.id(font)}|${char}|${depth}`;
    let geo = this.geometries.get(key);
    if (!geo) {
      geo = buildGlyphGeometry(font.font, char, EM, { ...DEFAULT_GLYPH_OPTIONS, depth });
      this.geometries.set(key, geo);
    }
    return geo;
  }

  dispose(): void {
    for (const geo of this.geometries.values()) geo.dispose();
    this.geometries.clear();
    this.disposed = true;
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run packages/core/test/render/caches.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/render/caches.ts packages/core/src/text/glyphs.ts \
  packages/core/src/render/word.ts packages/core/test/render/caches.test.ts
git commit -m "cache glyph geometry per font rather than per word"
```

---

### Task 2: `Word` borrows a glyph store

**Files:**
- Modify: `packages/core/src/render/word.ts:202`, `:225-243`, `:260`, `:288`, `:565`, `:569`, `:612`, `:978-980`
- Test: `packages/core/test/render/word.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/render/word.test.ts` (inside the top-level `describe`, next to the
other construction tests near line 124). `ROOMY` and `stubFont` already exist in that file:

```ts
  it('takes its glyph geometry from a borrowed cache and leaves it alive on dispose', () => {
    const caches = new WordCaches();
    const font = stubFont();
    const first = new Word('A', font, 'gold', ROOMY, false, undefined, undefined, null, caches);
    const geo = caches.glyph(font, 'A', DEFAULT_GLYPH_OPTIONS.depth);
    first.dispose();
    const second = new Word('A', font, 'gold', ROOMY, false, undefined, undefined, null, caches);
    expect(caches.glyph(font, 'A', DEFAULT_GLYPH_OPTIONS.depth)).toBe(geo);
    expect(geo.attributes.position?.count).toBeGreaterThan(0);
    second.dispose();
  });

  it('owns and disposes a cache of its own when it is not given one', () => {
    const word = new Word('A', stubFont(), 'gold', ROOMY);
    word.dispose();
    // Nothing to assert beyond not throwing: a borrowed cache would have been left disposed.
    expect(() => new Word('A', stubFont(), 'gold', ROOMY).dispose()).not.toThrow();
  });
```

Add to that file's imports:

```ts
import { WordCaches } from '../../src/render/caches.js';
```

`DEFAULT_GLYPH_OPTIONS` is already imported there; if it is not, add it from
`'../../src/text/glyphs.js'`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run packages/core/test/render/word.test.ts -t 'borrowed cache'`
Expected: FAIL — `Expected 8 arguments, but got 9` at typecheck, or the geometry disposed.

- [ ] **Step 3: Take the store in the constructor**

In `packages/core/src/render/word.ts`, replace the field declaration at line 202:

```ts
  private readonly cache: GlyphCache;
```

with:

```ts
  private readonly caches: WordCaches;
  /** Set only where this word made its own caches, and so is the one that disposes them. */
  private readonly ownsCaches: boolean;
```

Add the import beside the other `./` imports:

```ts
import { WordCaches } from './caches.js';
```

Replace the constructor signature's closing parameter list (lines 225–234) with:

```ts
  constructor(
    text: string,
    font: LoadedFont,
    look: Look,
    budget: Budget,
    wrap = false,
    tint?: number | ((letter: LetterInfo) => number | undefined),
    debug?: WordDebugHooks,
    envMap: THREE.Texture | null = null,
    caches?: WordCaches,
  ) {
```

Replace the cache construction (lines 241–243):

```ts
    this.cache = new GlyphCache((char, depth) =>
      buildGlyphGeometry(font.font, char, EM, { ...DEFAULT_GLYPH_OPTIONS, depth }),
    );
```

with:

```ts
    this.ownsCaches = !caches;
    this.caches = caches ?? new WordCaches();
```

- [ ] **Step 4: Route every read through the store**

Add this private helper next to `drawsInk` (around line 563):

```ts
  private glyph(char: string, depth: number): THREE.ExtrudeGeometry {
    return this.caches.glyph(this.font, char, depth);
  }
```

That needs the font on the instance. Add the field beside `metrics` (line 201):

```ts
  private readonly font: LoadedFont;
```

and set it in the constructor beside `this.metrics = font.metrics;` (line 264):

```ts
    this.font = font;
```

Then replace each `this.cache.get(` with `this.glyph(` at lines 260, 288, 565, 569 and 612. After
the edit, `grep -n 'this\.cache' packages/core/src/render/word.ts` must return nothing.

- [ ] **Step 5: Stop disposing a borrowed cache**

In `dispose()`, delete line 980:

```ts
    this.cache.dispose();
```

and add this as the last statement of the method, after `this.group.clear()`:

```ts
    if (this.ownsCaches) this.caches.dispose();
```

It has to be last rather than first: Task 5 makes `dispose()` *release* this word's tube blueprints
back to the store, and a store already disposed has nothing to release them to.

`buildGlyphGeometry` may now be unused in `word.ts`; if the linter says so, drop it from the import
block. `EM` is still used at lines 267, 691 and 749.

- [ ] **Step 6: Run the word tests**

Run: `npx vitest run packages/core/test/render/word.test.ts`
Expected: PASS, every test in the file.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/render/word.ts packages/core/test/render/word.test.ts
git commit -m "let a word borrow its glyph cache instead of owning one"
```

---

### Task 3: The instance owns the caches

**Files:**
- Modify: `packages/core/src/index.ts:376`, `:427-437`, the `destroy` path
- Test: `packages/core/test/index.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/test/index.test.ts`, in the describe block that covers repeated fires:

```ts
  it('gives two fires of the same text the same geometry, across an unmount', async () => {
    const k = create();
    k.fire('AA');
    await flush();
    const first = firstMesh().geometry;

    clock.advance(10_000);
    await flush();
    stage().unmount();

    k.fire('AA');
    await flush();
    expect(firstMesh().geometry).toBe(first);
  });

  it('disposes the shared geometry when the instance is destroyed', async () => {
    const k = create();
    k.fire('AA');
    await flush();
    const geo = firstMesh().geometry;
    let disposed = false;
    geo.addEventListener('dispose', () => {
      disposed = true;
    });
    clock.advance(10_000);
    await flush();
    k.destroy();
    expect(disposed).toBe(true);
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run packages/core/test/index.test.ts -t 'same geometry'`
Expected: FAIL — `expected ExtrudeGeometry to be ExtrudeGeometry` (two different objects).

- [ ] **Step 3: Construct and pass the caches**

In `packages/core/src/index.ts`, after the `stage` construction (line 373–377), add:

```ts
  const caches = new WordCaches();
```

with the import:

```ts
import { WordCaches } from './render/caches.js';
```

Pass it as the ninth argument to `new Word(` (line 427–437), after the env map:

```ts
      word = new Word(
        text,
        loaded,
        look,
        stage.viewportBudget(
          options.framing?.width,
          options.framing?.height,
          options.framing?.align,
          opts.lineAlign,
        ),
        opts.wrap,
        opts.tint,
        undefined,
        stage.environment?.texture ?? null,
        caches,
      );
```

- [ ] **Step 4: Dispose them on `destroy`**

In the `destroy()` method of the returned object, after the existing teardown (it aborts live
effects, releases the pointer and unmounts the stage), add:

```ts
      caches.dispose();
```

It must come after the stage unmount, so nothing is still drawing a geometry this frees.

- [ ] **Step 5: Run the index tests**

Run: `npx vitest run packages/core/test/index.test.ts`
Expected: PASS, every test in the file.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/index.ts packages/core/test/index.test.ts
git commit -m "share one glyph cache across an instance's fires"
```

---

### Task 4: The leased tube blueprint store

**Files:**
- Modify: `packages/core/src/render/caches.ts`
- Test: `packages/core/test/render/caches.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/render/caches.test.ts`:

```ts
import type { TubeBlueprint, TubeSpec } from '../../src/render/tube/index.js';

function stubBlueprint(): TubeBlueprint & { disposed: boolean } {
  const bp = {
    kind: 'tube' as const,
    runs: [],
    corners: [],
    paths: [],
    lit: [],
    dark: [],
    disposed: false,
    dispose() {
      bp.disposed = true;
    },
  };
  return bp;
}

describe('WordCaches.takeBlueprint', () => {
  const SPEC = { kind: 'tube' } as unknown as TubeSpec;

  it('rebuilds nothing for a key released and taken again', () => {
    const caches = new WordCaches();
    const font = stubFont();
    let built = 0;
    const take = () =>
      caches.takeBlueprint(font, SPEC, 'A', 0.3, 0, undefined, () => {
        built++;
        return stubBlueprint();
      });
    const first = take();
    caches.releaseBlueprint(first);
    expect(take()).toBe(first);
    expect(built).toBe(1);
  });

  it('discriminates the font, the spec, the char, the depth, the seed and the tint alone', () => {
    const caches = new WordCaches();
    const font = stubFont();
    const other = stubFont();
    const otherSpec = { kind: 'tube' } as unknown as TubeSpec;
    const build = () => stubBlueprint();
    const base = caches.takeBlueprint(font, SPEC, 'A', 0.3, 0, undefined, build);
    caches.releaseBlueprint(base);
    for (const take of [
      () => caches.takeBlueprint(other, SPEC, 'A', 0.3, 0, undefined, build),
      () => caches.takeBlueprint(font, otherSpec, 'A', 0.3, 0, undefined, build),
      () => caches.takeBlueprint(font, SPEC, 'B', 0.3, 0, undefined, build),
      () => caches.takeBlueprint(font, SPEC, 'A', 0.4, 0, undefined, build),
      () => caches.takeBlueprint(font, SPEC, 'A', 0.3, 1, undefined, build),
      () => caches.takeBlueprint(font, SPEC, 'A', 0.3, 0, 0xff0000, build),
    ]) {
      const got = take();
      expect(got).not.toBe(base);
      caches.releaseBlueprint(got);
    }
  });

  it('builds a second blueprint rather than lending one already out, and frees it on release', () => {
    const caches = new WordCaches();
    const font = stubFont();
    const build = () => stubBlueprint();
    const held = caches.takeBlueprint(font, SPEC, 'A', 0.3, 0, undefined, build);
    const borrowed = caches.takeBlueprint(font, SPEC, 'A', 0.3, 0, undefined, build);
    expect(borrowed).not.toBe(held);

    caches.releaseBlueprint(borrowed);
    expect((borrowed as ReturnType<typeof stubBlueprint>).disposed).toBe(true);
    caches.releaseBlueprint(held);
    expect((held as ReturnType<typeof stubBlueprint>).disposed).toBe(false);
  });

  it('disposes every kept blueprint on dispose', () => {
    const caches = new WordCaches();
    const font = stubFont();
    const kept = caches.takeBlueprint(font, SPEC, 'A', 0.3, 0, undefined, stubBlueprint);
    caches.releaseBlueprint(kept);
    caches.dispose();
    expect((kept as ReturnType<typeof stubBlueprint>).disposed).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run packages/core/test/render/caches.test.ts`
Expected: FAIL — `caches.takeBlueprint is not a function`.

- [ ] **Step 3: Add the store**

In `packages/core/src/render/caches.ts`, add the import:

```ts
import type { TubeBlueprint, TubeSpec } from './tube/index.js';
```

and these members to `WordCaches`:

```ts
  private readonly blueprints = new Map<string, { blueprint: TubeBlueprint; leased: boolean }>();
  /** Blueprints built because the cached one was already lent out; disposed on release. */
  private readonly onLoan = new Set<TubeBlueprint>();

  /**
   * A blueprint's lit geometry carries the run-colour buffer a live effect writes every frame, so
   * one blueprint can back one word at a time. A second taker gets its own, kept out of the cache.
   */
  takeBlueprint(
    font: LoadedFont,
    spec: TubeSpec,
    char: string,
    depth: number,
    seed: number,
    tint: number | undefined,
    build: () => TubeBlueprint,
  ): TubeBlueprint {
    if (this.disposed) throw new Error('klieg: WordCaches used after dispose');
    const key = [
      this.interner.id(font),
      this.interner.id(spec),
      char,
      depth,
      seed,
      tint ?? 'none',
    ].join('|');
    const entry = this.blueprints.get(key);
    if (!entry) {
      const blueprint = build();
      this.blueprints.set(key, { blueprint, leased: true });
      return blueprint;
    }
    if (!entry.leased) {
      entry.leased = true;
      return entry.blueprint;
    }
    const spare = build();
    this.onLoan.add(spare);
    return spare;
  }

  releaseBlueprint(blueprint: TubeBlueprint): void {
    if (this.onLoan.delete(blueprint)) {
      blueprint.dispose();
      return;
    }
    for (const entry of this.blueprints.values()) {
      if (entry.blueprint === blueprint) {
        entry.leased = false;
        return;
      }
    }
  }
```

and extend `dispose()`:

```ts
  dispose(): void {
    for (const geo of this.geometries.values()) geo.dispose();
    this.geometries.clear();
    for (const entry of this.blueprints.values()) entry.blueprint.dispose();
    this.blueprints.clear();
    for (const spare of this.onLoan) spare.dispose();
    this.onLoan.clear();
    this.disposed = true;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/core/test/render/caches.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/caches.ts packages/core/test/render/caches.test.ts
git commit -m "lend one tube blueprint to one word at a time"
```

---

### Task 5: `Word` borrows the blueprint store

**Files:**
- Modify: `packages/core/src/render/word.ts:691-699`, `:989-990`
- Test: `packages/core/test/render/word.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/test/render/word.test.ts`, beside the existing test `'disposes every tube run
geometry along with its per-letter blueprint'` (line 486), which is in the same describe block as
the `TUBE` look spec (line 409). Both new tests use that `TUBE` and the file's `groups()` helper —
a letter group's first child is the body mesh, so the tube's own meshes are `children.slice(1)`.

```ts
  /** The first tube run mesh of the word's first letter. */
  const firstRun = (word: Word) =>
    ((groups(word)[0] as THREE.Group).children[1] as THREE.Mesh).geometry;

  it('re-uses a tube blueprint the previous word released', () => {
    const caches = new WordCaches();
    const font = stubFont();
    const first = new Word('A', font, TUBE, ROOMY, false, undefined, undefined, null, caches);
    const geo = firstRun(first);
    first.dispose();
    const second = new Word('A', font, TUBE, ROOMY, false, undefined, undefined, null, caches);
    expect(firstRun(second)).toBe(geo);
    second.dispose();
  });

  it('gives two live words their own blueprints', () => {
    const caches = new WordCaches();
    const font = stubFont();
    const a = new Word('A', font, TUBE, ROOMY, false, undefined, undefined, null, caches);
    const b = new Word('A', font, TUBE, ROOMY, false, undefined, undefined, null, caches);
    expect(firstRun(b)).not.toBe(firstRun(a));
    a.dispose();
    b.dispose();
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run packages/core/test/render/word.test.ts -t 'tube blueprint'`
Expected: FAIL — the two geometries differ (nothing is cached yet).

- [ ] **Step 3: Take the blueprint from the store**

In `packages/core/src/render/word.ts`, replace lines 691–699:

```ts
      const shapes = glyphToShapes(font.font, char, EM);
      debugShapes = shapes;
      const blueprint = buildTubeBlueprint(
        shapes,
        tintedTube(decoration, tintMaterialOf(spec) === 'decoration' ? hue : undefined),
        DEFAULT_GLYPH_OPTIONS.depth,
        i,
      );
      this.tubeBlueprints[i] = blueprint;
```

with:

```ts
      const shapes = glyphToShapes(font.font, char, EM);
      debugShapes = shapes;
      const decorTint = tintMaterialOf(spec) === 'decoration' ? hue : undefined;
      const blueprint = this.caches.takeBlueprint(
        font,
        decoration,
        char,
        DEFAULT_GLYPH_OPTIONS.depth,
        i,
        decorTint,
        () =>
          buildTubeBlueprint(
            shapes,
            tintedTube(decoration, decorTint),
            DEFAULT_GLYPH_OPTIONS.depth,
            i,
          ),
      );
      this.tubeBlueprints[i] = blueprint;
```

The key takes the *untinted* `decoration` object because its identity is stable across fires
(`specOf` returns the canonical `LOOKS` entry); `tintedTube` builds a fresh object every call, so
keying on that would never hit. The tint is carried in the key as a number instead.

- [ ] **Step 4: Release rather than dispose**

In `dispose()`, replace lines 989–990:

```ts
    for (const blueprint of this.tubeBlueprints) blueprint?.dispose();
    this.tubeBlueprints.length = 0;
```

with:

```ts
    for (const blueprint of this.tubeBlueprints) {
      if (blueprint) this.caches.releaseBlueprint(blueprint);
    }
    this.tubeBlueprints.length = 0;
```

A word that owns its caches disposes them a few lines later, which disposes the blueprints it just
released — so the owned case still frees everything.

- [ ] **Step 5: Run the word and decoration tests**

Run: `npx vitest run packages/core/test/render/`
Expected: PASS, every file.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/render/word.ts packages/core/test/render/word.test.ts
git commit -m "take a word's tube blueprints from the instance cache"
```

---

### Task 6: The warm

**Files:**
- Create: `packages/core/src/render/warm.ts`
- Modify: `packages/core/src/index.ts:169-186` (`KliegOptions`), `createKlieg`
- Test: `packages/core/test/index.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/test/index.test.ts`. `stubStage()` already records `'mount'` and `'idle'` into
`calls`, which is what these assert against. Add this idle-callback stub next to `stubListeners`:

```ts
let idleCallbacks: (() => void)[];

/** node has no requestIdleCallback; the warm falls back to setTimeout, so drive it by hand. */
function stubIdle(): void {
  idleCallbacks = [];
  vi.stubGlobal('requestIdleCallback', (fn: () => void) => {
    idleCallbacks.push(fn);
    return idleCallbacks.length;
  });
  vi.stubGlobal('cancelIdleCallback', () => {});
}

const runIdle = async () => {
  for (const fn of idleCallbacks.splice(0)) fn();
  await flush();
};
```

Call `stubIdle()` from the existing `beforeEach`, beside `stubListeners()`. Then the tests:

```ts
describe('the warm', () => {
  it('mounts, renders once and arms the idle teardown', async () => {
    create();
    await runIdle();
    expect(calls).toEqual(['mount', 'idle']);
    expect(renders).toBe(1);
  });

  it('does not warm an unsupported instance', async () => {
    stubWebgl(false);
    create();
    await runIdle();
    expect(calls).toEqual([]);
  });

  it('does not warm once a fire has already started', async () => {
    const k = create();
    k.fire('A');
    await flush();
    const after = calls.length;
    await runIdle();
    expect(calls.length).toBe(after);
  });

  it('leaves the geometry it built in the cache for the first fire', async () => {
    const k = create({ warmLook: 'gold' });
    await runIdle();
    k.fire('AA');
    await flush();
    expect(firstMesh().geometry.attributes.position?.count).toBeGreaterThan(0);
  });

  it('destroys cleanly when the warm never ran', () => {
    const k = create();
    expect(() => k.destroy()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run packages/core/test/index.test.ts -t 'the warm'`
Expected: FAIL — `expected [] to equal ['mount', 'idle']`.

- [ ] **Step 3: Write the warm**

Create `packages/core/src/render/warm.ts`:

```ts
import * as THREE from 'three';
import type { LoadedFont } from '../text/font.js';
import type { WordCaches } from './caches.js';
import type { Look } from './looks.js';
import type { Stage } from './stage.js';
import { Word } from './word.js';

/** One glyph is enough: the driver links a program per look, not per character. */
const WARM_TEXT = 'A';

export interface WarmDeps {
  stage: Stage;
  font(): Promise<LoadedFont>;
  look: Look;
  caches: WordCaches;
  /** True once the instance is destroyed or a fire has started; both make the warm pointless. */
  stale(): boolean;
}

/**
 * Pays the mount's GL cost before a fire needs it. `renderer.compile()` is not enough — the driver
 * links on the first draw — so this draws, to a one-pixel target rather than the canvas the mount
 * just appended, which would otherwise flash a stray glyph seconds before anything was fired.
 */
export function scheduleWarm(deps: WarmDeps): () => void {
  let cancelled = false;
  const idle =
    typeof globalThis.requestIdleCallback === 'function'
      ? (fn: () => void) => globalThis.requestIdleCallback(() => fn())
      : (fn: () => void) => setTimeout(fn, 1);

  idle(() => {
    if (cancelled) return;
    void warm(deps, () => cancelled);
  });

  return () => {
    cancelled = true;
  };
}

async function warm(deps: WarmDeps, cancelled: () => boolean): Promise<void> {
  const skip = () => cancelled() || deps.stale();
  if (skip()) return;

  let loaded: LoadedFont;
  try {
    loaded = await deps.font();
  } catch {
    // A warm is a bet on a fire that has not happened; a font that will not load is that fire's
    // error to report, not this one's.
    return;
  }
  if (skip()) return;

  const renderer = deps.stage.mount();
  const target = new THREE.WebGLRenderTarget(1, 1);
  let word: Word | null = null;
  try {
    word = new Word(
      WARM_TEXT,
      loaded,
      deps.look,
      deps.stage.viewportBudget(),
      false,
      undefined,
      undefined,
      deps.stage.environment?.texture ?? null,
      deps.caches,
    );
    deps.stage.scene.add(word.group);
    renderer.setRenderTarget(target);
    renderer.render(deps.stage.scene, deps.stage.camera);
  } finally {
    renderer.setRenderTarget(null);
    if (word) {
      deps.stage.scene.remove(word.group);
      word.dispose();
    }
    target.dispose();
    // A fire that started while this ran arms its own teardown when it settles; arming here too
    // would set an 8s timer against an effect that has not finished.
    if (!skip()) deps.stage.scheduleIdleTeardown();
  }
}
```

- [ ] **Step 4: Add `warmLook` and wire it up**

In `packages/core/src/index.ts`, add to `KliegOptions` after `framing` (line 186):

```ts
  /**
   * The look whose shader programs the warm links, on an idle callback after `createKlieg`. The
   * link is the driver's and lands per look, so warming `gold` buys a page that only fires `neon`
   * nothing. Defaults to `'gold'`.
   */
  warmLook?: Look;
```

In `createKlieg`, after the `caches` construction from Task 3, add a `fired` flag and the schedule.
The flag must be set by `fire()`, not by `run()`, so a queued fire counts before it starts:

```ts
  let fired = false;
```

and at the top of the returned `fire(text, opts = {})`, before anything else:

```ts
      fired = true;
```

Then, after `caches` is constructed:

```ts
  const cancelWarm = supported
    ? scheduleWarm({
        stage,
        font,
        look: options.warmLook ?? 'gold',
        caches,
        stale: () => destroyed || fired,
      })
    : () => {};
```

`destroyed` and `fired` are declared with `let counter = 0; let destroyed = false;` further down the
function — move both `let` declarations up to sit beside `let pointerClient` (line 379) so the
closure reads them, and delete the later declarations.

Add the import:

```ts
import { scheduleWarm } from './render/warm.js';
```

In `destroy()`, before `caches.dispose()`:

```ts
      cancelWarm();
```

- [ ] **Step 5: Run the index tests**

Run: `npx vitest run packages/core/test/index.test.ts`
Expected: PASS, every test in the file.

- [ ] **Step 6: Run the whole suite, the linter and the typechecker**

Run: `npm run lint && npm run typecheck && npx vitest run`
Expected: exit 0 on all three; the test count is at or above the 1274 the branch started with.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/render/warm.ts packages/core/src/index.ts packages/core/test/index.test.ts
git commit -m "link a look's programs on an idle callback after construction"
```

---

### Task 7: Document the new option

**Files:**
- Modify: `README.md`, `CHANGELOG.md`
- Test: `packages/core/test/readme.test.ts`

- [ ] **Step 1: Add `warmLook` to the README's options table**

In the `createKlieg` options section, beside `idleTimeoutMs`:

```md
| `warmLook` | `Look` | `'gold'` | The look whose shader programs are linked on an idle callback after construction. The link is per look: a page that only fires `neon` should say so, or the warm buys it nothing. |
```

- [ ] **Step 2: Add the changelog entry**

Under the unreleased heading in `CHANGELOG.md`:

```md
- Glyph geometry and tube blueprints are now cached per instance rather than per fire, and survive
  the idle unmount. A repeated fire re-uses them.
- `warmLook` names the look whose shader programs are linked on an idle callback after
  `createKlieg`, moving the first fire's program-link cost off the critical path.
```

- [ ] **Step 3: Run the whole suite one more time**

Run: `npm run lint && npm run typecheck && npx vitest run`
Expected: exit 0 on all three.

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "document warmLook and the cross-fire caches"
```

---

## What this plan does not do

The spec defers both of these; neither is in scope here.

- **Prebaking the PMREM environment.** The largest number on the table (296ms cold), and fully
  deterministic — but whether three can load an already-prefiltered environment without re-running
  the pass is unconfirmed. Confirm that before designing around it.
- **A host-driven `warm()`.** The automatic warm covers the common case; a second public surface
  needs a real need for controlling the instant.
