# Composition Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dev lab at `packages/core/dev/composition-lab/` for building a whole `fire()` by hand — motion, effects and lighting pieces on one scrubbable timeline over a live render — and reading out what each piece does per item over time.

**Architecture:** Effect resolution moves out of `Word` into `effects/frame.ts` so the lab drives the *same* code path the renderer does rather than a copy of it. The lab is a React page: a real `createKlieg` preview on a `ManualClock` at the top, lane timeline beneath, canvas-2D instrumentation panels below that, control rail on the left. Every panel reads one sampled pass; nothing in the lab reimplements targeting, stagger, or merging.

**Tech Stack:** TypeScript, React 19, vite, `@weasel-js/labkit` (styles + `Workspace` only, as `tube-lab` does), canvas 2D for instrumentation, three.js only inside the preview via klieg's public API. Tests are vitest; the React shell is not tested.

**Design:** [`specs/2026-08-27-composition-lab-design.md`](../specs/2026-08-27-composition-lab-design.md)

**Status: built, Tasks 1–12, on `main` at 1179 tests.** Five things came out differently from what
is written below; the code is right and this section is the record.

1. `SelectSpec` requires `by`, which every `target` literal in this plan omits. They are all
   `{ kind, by: 'index', amount }`.
2. `Word` had two more references to the fields Task 1 deletes — a guard in the frame loop and a
   line in `dispose`. `buildEffects` sets `effectFrame` to null when no spec targets, and the guard
   reads that.
3. The root `vitest.config.ts` had to learn the `@core/*` alias, or no test can import a lab module.
4. An element placement takes `el` and refuses `target`, so `Preview` passes
   `placement: { kind: 'element', el: target }` and no `target`.
5. Task 4's `touched` as specified means *targeted*, which makes the coverage overlay blind to
   `roving` — the one fault it exists to show. It means *moved*, and `sample.test.ts` pins that.

`roving`'s `EPOCHS` fix landed first, separately, in `bb2767f`.

**Conventions this repo already has, which every task follows:**
- `@core/*` path alias, in both `tsconfig.json` `paths` and `vite.config.ts` `resolve.alias`. Copy `dev/corner-lab/` exactly; never write `../../../src/`.
- Comments are 1–2 lines and only for what the code cannot say. Most steps below need none.
- `npm run check` is lint + typecheck + test and must be green before every commit.
- Ports: 5180 `apps/lab`, 5181 `tube-lab`, 5182 `corner-lab`, **5183 this lab**.

---

### Task 1: Move effect resolution out of `Word` into `effects/frame.ts`

The lab must not reimplement targeting, `stagger` and merging. Those happen *around* a piece, in
`Word`, and an instrument that re-derives them drifts and then reports confident wrong answers.

**Files:**
- Create: `packages/core/src/effects/frame.ts`
- Create: `packages/core/test/effects/frame.test.ts`
- Modify: `packages/core/src/render/word.ts` (the `effects` field, `buildEffects`, `applyEffects`)

- [x] **Step 1: Write the failing test**

Create `packages/core/test/effects/frame.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EffectFrame, planEffects } from '../../src/effects/frame.js';
import type { EffectPiece, EffectSpec, PartInfo } from '../../src/effects/types.js';
import { NO_CTX } from './ctx.js';

function pool(runs: number, bodies: number): PartInfo[] {
  const parts: PartInfo[] = [];
  for (let i = 0; i < bodies; i++) {
    parts.push({
      kind: 'body', index: i, count: bodies, letter: { index: i, count: bodies },
      x: i, y: 0, at: i / bodies, span: 1 / bodies,
    });
  }
  for (let i = 0; i < runs; i++) {
    parts.push({
      kind: 'run', index: i, count: runs, letter: { index: 0, count: bodies },
      x: i, y: 0, at: i / runs, span: 1 / runs,
    });
  }
  return parts;
}

const HALF: EffectPiece = { duration: 1000, at: () => ({ gain: 0.5 }) };
const DIM: EffectPiece = { duration: 1000, at: () => ({ gain: 0.2 }) };
/** Reports the phase it was called at, so stagger is observable. */
const PHASE: EffectPiece = { duration: 1000, at: (t) => ({ scale: 1 + t }) };

describe('planEffects', () => {
  it('selects only parts of the spec kind, indexed into the whole pool', () => {
    const parts = pool(3, 2);
    const [effect] = planEffects([{ piece: HALF, target: { kind: 'run', amount: 1 } }], parts);
    expect(effect?.parts).toEqual([2, 3, 4]);
  });

  it('resolves a name to its built-in piece', () => {
    const parts = pool(2, 1);
    const [effect] = planEffects([{ piece: 'flicker', target: { kind: 'run', amount: 1 } }], parts);
    expect(effect?.piece.duration).toBeGreaterThan(0);
  });

  it('reports an empty selection rather than throwing, so a caller can warn', () => {
    const parts = pool(0, 2);
    const [effect] = planEffects([{ piece: HALF, target: { kind: 'run', amount: 1 } }], parts);
    expect(effect?.parts).toEqual([]);
  });
});

describe('EffectFrame', () => {
  it('merges every layer that reaches a part', () => {
    const parts = pool(2, 0);
    const specs: EffectSpec[] = [
      { piece: HALF, target: { kind: 'run', amount: 1 } },
      { piece: DIM, target: { kind: 'run', amount: 1 } },
    ];
    const out = new EffectFrame(planEffects(specs, parts)).resolve(parts, 0, NO_CTX);
    expect(out.get(0)?.gain).toBeCloseTo(0.1);
  });

  it('writes only targeted parts', () => {
    const parts = pool(2, 1);
    const specs: EffectSpec[] = [{ piece: HALF, target: { kind: 'run', amount: 1 } }];
    const out = new EffectFrame(planEffects(specs, parts)).resolve(parts, 0, NO_CTX);
    expect([...out.keys()].sort()).toEqual([1, 2]);
  });

  it('staggers the phase per part rather than passing one pass to all of them', () => {
    const parts = pool(2, 0);
    const specs: EffectSpec[] = [
      { piece: PHASE, target: { kind: 'run', amount: 1 }, stagger: 0.5 },
    ];
    const out = new EffectFrame(planEffects(specs, parts)).resolve(parts, 500, NO_CTX);
    expect(out.get(0)?.scale).not.toBeCloseTo(out.get(1)?.scale as number);
  });

  it('skips a part the caller disowns, leaving it out of the result entirely', () => {
    const parts = pool(2, 0);
    const specs: EffectSpec[] = [{ piece: HALF, target: { kind: 'run', amount: 1 } }];
    const frame = new EffectFrame(planEffects(specs, parts));
    const out = frame.resolve(parts, 0, NO_CTX, (i) => i === 1);
    expect([...out.keys()]).toEqual([0]);
  });

  it('does not leak one frame layers into the next', () => {
    const parts = pool(1, 0);
    const specs: EffectSpec[] = [{ piece: HALF, target: { kind: 'run', amount: 1 } }];
    const frame = new EffectFrame(planEffects(specs, parts));
    frame.resolve(parts, 0, NO_CTX);
    const second = frame.resolve(parts, 0, NO_CTX);
    expect(second.get(0)?.gain).toBeCloseTo(0.5);
  });

  it('holds a piece with no duration at its first phase rather than dividing by zero', () => {
    const parts = pool(1, 0);
    const instant: EffectPiece = { duration: 0, at: (t) => ({ scale: 1 + t }) };
    const specs: EffectSpec[] = [{ piece: instant, target: { kind: 'run', amount: 1 } }];
    const out = new EffectFrame(planEffects(specs, parts)).resolve(parts, 9999, NO_CTX);
    expect(out.get(0)?.scale).toBe(1);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/core/test/effects/frame.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/effects/frame.js"`.

- [x] **Step 3: Write `effects/frame.ts`**

Create `packages/core/src/effects/frame.ts`:

```ts
import type { StaggerSpec } from '../motion/types.js';
import { stagger } from '../motion/types.js';
import { selectIndices } from '../select.js';
import { mergeOffsets } from './compositor.js';
import { EFFECTS } from './pieces.js';
import type {
  EffectPiece,
  EffectSpec,
  FrameCtx,
  PartInfo,
  PartOffset,
  ResolvedOffset,
} from './types.js';

/** One spec resolved against a pool: the built piece, and which pool positions it drives. */
export interface ResolvedEffect {
  piece: EffectPiece;
  /** Indices into the `parts` array this was planned against, not `PartInfo.index`. */
  parts: number[];
  stagger?: number | StaggerSpec;
}

/**
 * Resolves each spec's selection against the pool once. Selection is seeded and stable, so doing
 * it per frame would pick the same parts at the cost of re-selecting every frame.
 */
export function planEffects(
  specs: readonly EffectSpec[],
  parts: readonly PartInfo[],
): ResolvedEffect[] {
  return specs.map((spec) => {
    // Pool positions carry their index into `parts`: a part's `index` numbers its own kind, and
    // the two differ for every run part.
    const pool = parts
      .map((part, index) => ({ part, index }))
      .filter(({ part }) => part.kind === spec.target.kind);
    const chosen = selectIndices(
      pool.map(({ part }) => ({ index: part.index, length: part.span })),
      spec.target,
      spec.seed ?? 0,
    );
    return {
      piece: typeof spec.piece === 'string' ? EFFECTS[spec.piece]() : spec.piece,
      stagger: spec.stagger,
      parts: pool.filter(({ part }) => chosen.has(part.index)).map(({ index }) => index),
    };
  });
}

/**
 * Layers every effect that reaches a part and merges each targeted part once. Holds its own
 * buffers: the targeted set is fixed at plan time, so rebuilding it per frame is wasted work.
 */
export class EffectFrame {
  private readonly layers = new Map<number, PartOffset[]>();
  private readonly out = new Map<number, ResolvedOffset>();

  constructor(private readonly effects: readonly ResolvedEffect[]) {
    for (const effect of effects) {
      for (const index of effect.parts) {
        if (!this.layers.has(index)) this.layers.set(index, []);
      }
    }
  }

  /** Every targeted part's merged offset. `skip` drops one the caller no longer wants written. */
  resolve(
    parts: readonly PartInfo[],
    elapsed: number,
    ctx: FrameCtx,
    skip?: (index: number) => boolean,
  ): Map<number, ResolvedOffset> {
    for (const layers of this.layers.values()) layers.length = 0;
    this.out.clear();

    for (const effect of this.effects) {
      const duration = effect.piece.duration;
      const pass = duration > 0 ? (elapsed % duration) / duration : 0;
      for (const index of effect.parts) {
        if (skip?.(index)) continue;
        const part = parts[index] as PartInfo;
        const t = effect.stagger === undefined ? pass : stagger(pass, part, effect.stagger);
        (this.layers.get(index) as PartOffset[]).push(effect.piece.at(t, part, ctx));
      }
    }

    for (const [index, layers] of this.layers) {
      if (skip?.(index)) continue;
      this.out.set(index, mergeOffsets(layers));
    }
    return this.out;
  }
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/core/test/effects/frame.test.ts`
Expected: PASS, 9 tests.

- [x] **Step 5: Point `Word` at it**

In `packages/core/src/render/word.ts`:

Replace the `effects` and `effectLayers` fields (the block declaring `private readonly effects: {...}[] = []` and `private readonly effectLayers = new Map<number, PartOffset[]>()`) with:

```ts
  /** Planned once from the specs; holds the per-frame layer buffers. Null when no spec targets. */
  private effectFrame: EffectFrame | null = null;
```

Replace the whole body of `buildEffects` with:

```ts
  private buildEffects(specs: readonly EffectSpec[]): void {
    this.effectFrame = new EffectFrame(planEffects(specs, this.parts));
  }
```

Replace the whole body of `applyEffects` with:

```ts
  private applyEffects(elapsed: number, ctx: FrameCtx): void {
    const resolved = this.effectFrame?.resolve(this.parts, elapsed, ctx, (index) =>
      this.retiredPart(index),
    );
    if (!resolved) return;
    for (const [index, out] of resolved) this.writePart(index, out);
  }
```

Add to the import block at the top:

```ts
import { EffectFrame, planEffects } from '../effects/frame.js';
```

Then delete the now-unused imports: `mergeOffsets` from `'../effects/compositor.js'`, `EFFECTS` from
`'../effects/pieces.js'`, `selectIndices` from `'../select.js'`, `stagger` from `'../motion/types.js'`
(keep the `LetterInfo`/`StaggerSpec` *type* imports if other code in the file still uses them), and
the `PartOffset` type import if nothing else references it. `npm run lint` names any that are still
needed — do not guess, let it tell you.

- [x] **Step 6: Verify nothing moved**

Run: `npm run check`
Expected: lint clean, typecheck clean, **1147 tests pass**. That count is the assertion: this task
must not change any behaviour, so a changed count means something broke.

- [x] **Step 7: Verify the extraction by mutation**

Temporarily change `resolve` so it does not clear the layer buffers (delete the
`for (const layers of this.layers.values()) layers.length = 0;` line).

Run: `npx vitest run packages/core/test/effects/frame.test.ts`
Expected: FAIL on "does not leak one frame layers into the next". Restore the line and confirm PASS.

- [x] **Step 8: Commit**

```bash
git add packages/core/src/effects/frame.ts packages/core/test/effects/frame.test.ts packages/core/src/render/word.ts
git commit -m "move effect resolution out of Word into effects/frame.ts

Targeting, stagger and merging all happen around a piece rather than inside
it, so anything that wants to know what a composition does per part per frame
had to reimplement them and drift. planEffects and EffectFrame are that code
path, and Word now calls it rather than owning it.

No behaviour change: 1147 tests, unchanged."
```

---

### Task 2: Scaffold the lab so it boots

**Files:**
- Create: `packages/core/dev/composition-lab/index.html`
- Create: `packages/core/dev/composition-lab/vite.config.ts`
- Create: `packages/core/dev/composition-lab/tsconfig.json`
- Create: `packages/core/dev/composition-lab/src/main.tsx`
- Create: `packages/core/dev/composition-lab/src/App.tsx`
- Create: `packages/core/dev/composition-lab/src/styles.css`
- Modify: `packages/core/package.json` (scripts)
- Modify: `tsconfig.json` (references)
- Modify: `packages/core/tsconfig.test.json` (references)

- [x] **Step 1: Write the config files**

`packages/core/dev/composition-lab/vite.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// 5183, so this sits alongside apps/lab (5180), the tube lab (5181) and the corner lab (5182).
export default defineConfig({
  server: { port: 5183 },
  resolve: {
    alias: { '@core': fileURLToPath(new URL('../../src', import.meta.url)) },
  },
});
```

`packages/core/dev/composition-lab/tsconfig.json`:

```json
{
  "extends": "../../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "../.tsbuild/composition-lab",
    "rootDir": ".",
    "jsx": "react-jsx",
    "types": ["vite/client"],
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "paths": {
      "@core/*": ["../../src/*"]
    }
  },
  "include": ["src", "vite.config.ts"],
  "references": [{ "path": "../.." }]
}
```

`packages/core/dev/composition-lab/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>composition lab</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [x] **Step 2: Register it with the build**

In `packages/core/package.json`, add to `scripts`:

```json
"dev:composition-lab": "vite dev/composition-lab"
```

In the root `tsconfig.json`, add to `references`:

```json
{ "path": "packages/core/dev/composition-lab" }
```

In `packages/core/tsconfig.test.json`, add to `references`:

```json
{ "path": "./dev/composition-lab" }
```

- [x] **Step 3: Write the shell**

`packages/core/dev/composition-lab/src/main.tsx`:

```tsx
import '@weasel-js/labkit/styles.css';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

const host = document.getElementById('root');
if (!host) throw new Error('composition lab: the page has no #root');

createRoot(host).render(<App />);
```

`packages/core/dev/composition-lab/src/App.tsx`:

```tsx
export function App() {
  return (
    <div className="cl-shell">
      <aside className="cl-rail">rail</aside>
      <main className="cl-main">
        <section className="cl-preview">preview</section>
        <section className="cl-panels">panels</section>
      </main>
    </div>
  );
}
```

`packages/core/dev/composition-lab/src/styles.css`:

```css
.cl-shell {
  display: grid;
  grid-template-columns: 300px 1fr;
  height: 100vh;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
}

.cl-rail {
  overflow-y: auto;
  padding: 12px;
  border-right: 1px solid var(--cl-edge, #262b33);
}

.cl-main {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  padding: 12px;
}
```

- [x] **Step 4: Verify it boots**

Run: `npm run dev:composition-lab -w klieg`
Open `http://localhost:5183`. Expected: the three placeholder regions, no console errors.
Then `npm run check` — expected clean.

- [x] **Step 5: Commit**

```bash
git add packages/core/dev/composition-lab tsconfig.json packages/core/tsconfig.test.json packages/core/package.json
git commit -m "scaffold the composition lab on port 5183"
```

---

### Task 3: The composition model

One serialisable object describing a whole `fire()`, and a pure function turning it into
`FireOptions`. Everything else in the lab reads or writes this.

**Files:**
- Create: `packages/core/dev/composition-lab/src/composition.ts`
- Create: `packages/core/test/composition-lab/composition.test.ts`

- [x] **Step 1: Write the failing test**

Create `packages/core/test/composition-lab/composition.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMPOSITION,
  type Composition,
  toFireOptions,
} from '../../dev/composition-lab/src/composition.js';

describe('toFireOptions', () => {
  it('carries text settings straight through', () => {
    const c: Composition = { ...DEFAULT_COMPOSITION, look: 'tubing', hold: 4000 };
    expect(toFireOptions(c).look).toBe('tubing');
    expect(toFireOptions(c).hold).toBe(4000);
  });

  it('builds an effect spec per enabled effect layer, and omits disabled ones', () => {
    const c: Composition = {
      ...DEFAULT_COMPOSITION,
      effects: [
        { id: 'a', kind: 'flicker', enabled: true, params: {}, target: 'run', amount: 1, seed: 0 },
        { id: 'b', kind: 'hue', enabled: false, params: {}, target: 'run', amount: 1, seed: 0 },
      ],
    };
    expect(toFireOptions(c).effects).toHaveLength(1);
  });

  it('wraps a layer in roving when the layer asks for it', () => {
    const c: Composition = {
      ...DEFAULT_COMPOSITION,
      effects: [
        {
          id: 'a', kind: 'flicker', enabled: true, params: {}, target: 'run',
          amount: 1, seed: 0, roving: { dwell: 3200, seed: 0, epochs: 96 },
        },
      ],
    };
    const piece = toFireOptions(c).effects?.[0]?.piece;
    expect(typeof piece).not.toBe('string');
    // roving's pass is many inner passes long; a bare flicker's is 1400ms.
    expect((piece as { duration: number }).duration).toBeGreaterThan(100000);
  });

  it('omits effects entirely when no layer is enabled, so the look keeps its own', () => {
    const c: Composition = { ...DEFAULT_COMPOSITION, effects: [] };
    expect(toFireOptions(c).effects).toBeUndefined();
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/core/test/composition-lab/composition.test.ts`
Expected: FAIL — cannot resolve `composition.js`.

- [x] **Step 3: Write the model**

Create `packages/core/dev/composition-lab/src/composition.ts`:

```ts
import { roving } from '@core/effects/roving.js';
import type { EffectPiece, EffectSpec, PartKind } from '@core/effects/types.js';
import type { ActiveName, EnterName, ExitName } from '@core/motion/types.js';
import type { LookName } from '@core/render/looks.js';
import { buildPiece, type PieceKind } from './pieces.js';

export interface RovingWrap {
  dwell: number;
  seed: number;
  epochs: number;
}

export interface EffectLayer {
  id: string;
  kind: PieceKind;
  enabled: boolean;
  params: Record<string, number>;
  target: PartKind;
  /** `SelectSpec.amount`: a share of the pool, so 1 is all of it. */
  amount: number;
  seed: number;
  stagger?: number;
  roving?: RovingWrap;
  /** Source for a hand-authored piece; set only when `kind` is `'draft'`. */
  source?: string;
}

export interface Composition {
  text: string;
  look: LookName;
  hold: number;
  enter: EnterName;
  active: ActiveName;
  exit: ExitName;
  effects: EffectLayer[];
}

export const DEFAULT_COMPOSITION: Composition = {
  text: 'ACRONYM',
  look: 'tubing',
  hold: 6000,
  enter: 'slam',
  active: 'none',
  exit: 'none',
  effects: [],
};

/** The piece a layer contributes, wrapper included. Null when its source will not compile. */
export function layerPiece(layer: EffectLayer): EffectPiece | null {
  const inner = buildPiece(layer.kind, layer.params, layer.source);
  if (!inner) return null;
  return layer.roving ? roving(inner, layer.roving) : inner;
}

/** The `FireOptions` this composition describes. Pure: no GL, no DOM, no clock. */
export function toFireOptions(c: Composition): {
  look: LookName;
  hold: number;
  enter: EnterName;
  active: ActiveName;
  exit: ExitName;
  effects?: EffectSpec[];
} {
  const effects: EffectSpec[] = [];
  for (const layer of c.effects) {
    if (!layer.enabled) continue;
    const piece = layerPiece(layer);
    if (!piece) continue;
    effects.push({
      piece,
      target: { kind: layer.target, amount: layer.amount },
      seed: layer.seed,
      ...(layer.stagger === undefined ? {} : { stagger: layer.stagger }),
    });
  }
  return {
    look: c.look,
    hold: c.hold,
    enter: c.enter,
    active: c.active,
    exit: c.exit,
    // Undefined rather than an empty list: `effects` replaces the look's own rather than adding
    // to it, so an empty array silently strips whatever the look declared.
    ...(effects.length > 0 ? { effects } : {}),
  };
}
```

- [x] **Step 4: Write the piece registry it depends on**

Create `packages/core/dev/composition-lab/src/pieces.ts`:

```ts
import { chase, flicker, hue } from '@core/effects/pieces.js';
import type { EffectPiece } from '@core/effects/types.js';
import { compileDraft } from './draft.js';

export type PieceKind = 'flicker' | 'hue' | 'chase' | 'draft';

export interface ParamSpec {
  key: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** What the control does, and what it interacts with badly. Shown as a hover hint. */
  hint: string;
}

export const PARAMS: Record<Exclude<PieceKind, 'draft'>, ParamSpec[]> = {
  flicker: [
    { key: 'duration', min: 200, max: 8000, step: 100, value: 1400, hint: 'One pass. A spell and a calm override this to the nearest whole number of cycles.' },
    { key: 'depth', min: 0, max: 1, step: 0.01, value: 0, hint: 'Floor of gain during a stutter. 0 is fully out.' },
    { key: 'unrest', min: 0, max: 1, step: 0.01, value: 0.18, hint: 'Share of the pass spent stuttering. This, not dwell, sets how much the sign flickers.' },
    { key: 'spell', min: 0, max: 12000, step: 100, value: 0, hint: 'Milliseconds of one flickering bout. Inert without a calm.' },
    { key: 'calm', min: 0, max: 30000, step: 100, value: 0, hint: 'Quiet between bouts. Inert without a spell, and lengthens the pass to fit whole cycles.' },
  ],
  hue: [
    { key: 'duration', min: 500, max: 20000, step: 100, value: 6000, hint: 'One trip round the wheel.' },
    { key: 'from', min: 0, max: 1, step: 0.01, value: 0, hint: 'Where the sweep starts, in turns.' },
    { key: 'span', min: -2, max: 2, step: 0.01, value: 1, hint: 'Turns travelled per pass. Only 1 meets itself at the loop seam; anything else snaps back.' },
    { key: 'spread', min: -1, max: 1, step: 0.01, value: 0, hint: 'Hue offset across the word, per unit of part.at. 0 is one synchronized sign.' },
    { key: 'luminance', min: 0, max: 1, step: 0.01, value: 0.5, hint: 'Rec.709 luma the sweep holds, so it stays one side of the bloom threshold all the way round.' },
  ],
  chase: [
    { key: 'duration', min: 200, max: 12000, step: 100, value: 2400, hint: 'One trip of the ramp along the part.' },
    { key: 'laps', min: -4, max: 4, step: 0.1, value: 1, hint: 'Ramp lengths per trip. Negative runs the other way.' },
    { key: 'spread', min: -2, max: 2, step: 0.01, value: 0, hint: 'Ramp offset between consecutive parts. Inert on a look with no gradient — both shipped tube looks are flat.' },
  ],
};

/** Defaults for a kind, as a plain params object. */
export function defaultParams(kind: PieceKind): Record<string, number> {
  if (kind === 'draft') return {};
  return Object.fromEntries(PARAMS[kind].map((p) => [p.key, p.value]));
}

/** Null when a draft's source will not compile; every built-in always builds. */
export function buildPiece(
  kind: PieceKind,
  params: Record<string, number>,
  source?: string,
): EffectPiece | null {
  if (kind === 'draft') return source ? compileDraft(source) : null;
  if (kind === 'flicker') return flicker(params);
  if (kind === 'hue') return hue(params);
  return chase(params);
}
```

- [x] **Step 5: Write the draft compiler stub it depends on**

Create `packages/core/dev/composition-lab/src/draft.ts`. This is the real implementation, not a
stub — Task 9 only adds the editing UI around it:

```ts
import type { EffectPiece } from '@core/effects/types.js';

export interface DraftResult {
  piece: EffectPiece | null;
  error: string | null;
}

/**
 * Compiles a hand-authored piece. The source is a module body returning `{ duration, at }`, run
 * through a blob URL so it is real JS with real closures rather than a `new Function` fragment.
 * Synchronous callers get the cached result; a first compile resolves on the next tick.
 */
const cache = new Map<string, DraftResult>();

export function compileDraft(source: string): EffectPiece | null {
  return cache.get(source)?.piece ?? null;
}

export function draftError(source: string): string | null {
  return cache.get(source)?.error ?? null;
}

/** Compiles and caches. Resolves to the same result `compileDraft` will then return. */
export async function loadDraft(source: string): Promise<DraftResult> {
  const hit = cache.get(source);
  if (hit) return hit;

  const url = URL.createObjectURL(
    new Blob([`export default () => {\n${source}\n};`], { type: 'text/javascript' }),
  );
  let result: DraftResult;
  try {
    const mod = (await import(/* @vite-ignore */ url)) as { default: () => unknown };
    const piece = mod.default() as EffectPiece;
    if (typeof piece?.at !== 'function' || typeof piece?.duration !== 'number') {
      result = { piece: null, error: 'must return { duration, at }' };
    } else {
      result = { piece, error: null };
    }
  } catch (err) {
    result = { piece: null, error: err instanceof Error ? err.message : String(err) };
  } finally {
    URL.revokeObjectURL(url);
  }
  cache.set(source, result);
  return result;
}
```

- [x] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run packages/core/test/composition-lab/composition.test.ts`
Expected: PASS, 4 tests.

- [x] **Step 7: Commit**

```bash
git add packages/core/dev/composition-lab/src packages/core/test/composition-lab
git commit -m "give the composition lab a composition model and piece registry"
```

---

### Task 4: The pure sampler

Every instrumentation panel reads one sampled pass. Sampling is a pure function so it can be
tested without a canvas.

**Files:**
- Create: `packages/core/dev/composition-lab/src/sample.ts`
- Create: `packages/core/test/composition-lab/sample.test.ts`

- [x] **Step 1: Write the failing test**

Create `packages/core/test/composition-lab/sample.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EffectFrame, planEffects } from '../../src/effects/frame.js';
import type { EffectPiece, PartInfo } from '../../src/effects/types.js';
import { samplePass } from '../../dev/composition-lab/src/sample.js';
import { NO_CTX } from '../effects/ctx.js';

function pool(count: number): PartInfo[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'run' as const, index, count, letter: { index: 0, count: 1 },
    x: index, y: 0, at: index / count, span: 1 / count,
  }));
}

/** Gain falls linearly across the pass, so a sample grid is trivially checkable. */
const RAMP: EffectPiece = { duration: 1000, at: (t) => ({ gain: 1 - t }) };

describe('samplePass', () => {
  it('returns one row per part and one column per sample', () => {
    const parts = pool(3);
    const frame = new EffectFrame(planEffects([{ piece: RAMP, target: { kind: 'run', amount: 1 } }], parts));
    const s = samplePass(frame, parts, 1000, 10, NO_CTX);
    expect(s.samples).toBe(10);
    expect(s.gain).toHaveLength(3);
    expect(s.gain[0]).toHaveLength(10);
  });

  it('walks the whole pass, so the last column is the pass end and not the start', () => {
    const parts = pool(1);
    const frame = new EffectFrame(planEffects([{ piece: RAMP, target: { kind: 'run', amount: 1 } }], parts));
    const s = samplePass(frame, parts, 1000, 10, NO_CTX);
    expect(s.gain[0]?.[0]).toBeCloseTo(1);
    expect(s.gain[0]?.[9]).toBeCloseTo(0.1);
  });

  it('reports an untouched part as resting rather than as zero, which would read as fully dark', () => {
    const parts = pool(2);
    const frame = new EffectFrame(
      planEffects([{ piece: RAMP, target: { kind: 'run', amount: 0.5, by: 'index' } }], parts),
    );
    const s = samplePass(frame, parts, 1000, 4, NO_CTX);
    const untouched = s.touched.indexOf(false);
    expect(untouched).toBeGreaterThanOrEqual(0);
    expect(s.gain[untouched]?.every((g) => g === 1)).toBe(true);
  });

  it('marks which parts the composition ever touches, so coverage is readable', () => {
    const parts = pool(4);
    const frame = new EffectFrame(
      planEffects([{ piece: RAMP, target: { kind: 'run', amount: 0.5, by: 'index' } }], parts),
    );
    const s = samplePass(frame, parts, 1000, 8, NO_CTX);
    expect(s.touched.filter(Boolean).length).toBeLessThan(4);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/core/test/composition-lab/sample.test.ts`
Expected: FAIL — cannot resolve `sample.js`.

- [x] **Step 3: Write the sampler**

Create `packages/core/dev/composition-lab/src/sample.ts`:

```ts
import type { EffectFrame } from '@core/effects/frame.js';
import type { FrameCtx, PartInfo } from '@core/effects/types.js';

/** One pass sampled on a grid: a row per part, a column per sample. */
export interface PassSamples {
  samples: number;
  /** Multiplicative channels rest at 1; an untouched part is all-1, not all-0. */
  gain: number[][];
  scale: number[][];
  dark: number[][];
  crawl: number[][];
  /** Packed 0xRRGGBB, or -1 where no layer wrote a colour. */
  color: number[][];
  /** Whether any layer ever reached this part across the whole pass. */
  touched: boolean[];
}

/**
 * Samples the composition across one pass. Drives the renderer's own `EffectFrame`, so what this
 * plots is what the sign does — an instrument that resolved its own layers would drift.
 */
export function samplePass(
  frame: EffectFrame,
  parts: readonly PartInfo[],
  duration: number,
  samples: number,
  ctx: FrameCtx,
): PassSamples {
  const grid = (fill: number) =>
    Array.from({ length: parts.length }, () => new Array<number>(samples).fill(fill));

  const out: PassSamples = {
    samples,
    gain: grid(1),
    scale: grid(1),
    dark: grid(0),
    crawl: grid(0),
    color: grid(-1),
    touched: new Array<boolean>(parts.length).fill(false),
  };

  for (let s = 0; s < samples; s++) {
    const resolved = frame.resolve(parts, (s / samples) * duration, ctx);
    for (const [index, o] of resolved) {
      out.touched[index] = true;
      (out.gain[index] as number[])[s] = o.gain;
      (out.scale[index] as number[])[s] = o.scale;
      (out.dark[index] as number[])[s] = o.dark;
      (out.crawl[index] as number[])[s] = o.crawl;
      (out.color[index] as number[])[s] = o.color ?? -1;
    }
  }
  return out;
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/core/test/composition-lab/sample.test.ts`
Expected: PASS, 4 tests.

- [x] **Step 5: Commit**

```bash
git add packages/core/dev/composition-lab/src/sample.ts packages/core/test/composition-lab/sample.test.ts
git commit -m "sample a composition's pass through the renderer's own EffectFrame"
```

---

### Task 5: The part pool, and the empty-target warning

**Files:**
- Create: `packages/core/dev/composition-lab/src/pool.ts`
- Create: `packages/core/test/composition-lab/pool.test.ts`

- [x] **Step 1: Write the failing test**

Create `packages/core/test/composition-lab/pool.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { syntheticPool, poolCounts } from '../../dev/composition-lab/src/pool.js';

describe('syntheticPool', () => {
  it('gives the requested number of parts', () => {
    expect(syntheticPool(12, 3).filter((p) => p.kind === 'run')).toHaveLength(12);
  });

  it('spans exactly the pool: the last part ends at 1', () => {
    const runs = syntheticPool(9, 3).filter((p) => p.kind === 'run');
    const last = runs[runs.length - 1] as { at: number; span: number };
    expect(last.at + last.span).toBeCloseTo(1);
  });

  it('varies span, because a real word has uneven runs and an even pool flatters every spread', () => {
    const spans = syntheticPool(12, 3).filter((p) => p.kind === 'run').map((p) => p.span);
    expect(new Set(spans.map((s) => s.toFixed(4))).size).toBeGreaterThan(1);
  });
});

describe('poolCounts', () => {
  it('counts each kind, so an empty target can be flagged before it silently does nothing', () => {
    expect(poolCounts(syntheticPool(5, 2))).toEqual({ run: 5, body: 2 });
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/core/test/composition-lab/pool.test.ts`
Expected: FAIL — cannot resolve `pool.js`.

- [x] **Step 3: Write it**

Create `packages/core/dev/composition-lab/src/pool.ts`:

```ts
import type { PartInfo, PartKind } from '@core/effects/types.js';
import { hash01 } from '@core/motion/types.js';

/**
 * A pool with deliberately uneven `at`/`span`. Real run lengths are uneven, and `chase` and `hue`
 * read `part.at` — an evenly spaced pool would flatter every spread.
 */
export function syntheticPool(runs: number, letters: number): PartInfo[] {
  const parts: PartInfo[] = [];
  for (let i = 0; i < letters; i++) {
    parts.push({
      kind: 'body', index: i, count: letters, letter: { index: i, count: letters },
      x: i - (letters - 1) / 2, y: 0, line: 0, column: i, lineCount: 1, columnCount: letters,
      at: i / letters, span: 1 / letters,
    });
  }

  const lengths = Array.from({ length: runs }, (_, i) => 0.4 + hash01(i * 5.9 + 2.3) * 1.6);
  const total = lengths.reduce((a, b) => a + b, 0);
  let walked = 0;
  for (let i = 0; i < runs; i++) {
    const span = (lengths[i] as number) / total;
    const letter = Math.min(letters - 1, Math.floor((i / runs) * letters));
    parts.push({
      kind: 'run', index: i, count: runs, letter: { index: letter, count: letters },
      x: letter - (letters - 1) / 2, y: 0,
      line: 0, column: letter, lineCount: 1, columnCount: letters,
      at: walked, span,
    });
    walked += span;
  }
  return parts;
}

/** How many parts of each kind the pool holds. Zero is the silent no-op a layer needs warning about. */
export function poolCounts(parts: readonly PartInfo[]): Record<PartKind, number> {
  return {
    run: parts.filter((p) => p.kind === 'run').length,
    body: parts.filter((p) => p.kind === 'body').length,
  };
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/core/test/composition-lab/pool.test.ts`
Expected: PASS, 4 tests.

- [x] **Step 5: Add the real pool source**

Append to `packages/core/dev/composition-lab/src/pool.ts`:

```ts
import { Word } from '@core/render/word.js';
import type { LookName } from '@core/render/looks.js';
import type { LoadedFont } from '@core/text/font.js';

/**
 * The pool a real word builds. `Word` needs no GL context — it builds geometry and meshes, and
 * nothing touches a renderer until something draws it — so this costs a layout, not a frame.
 */
export function realPool(text: string, font: LoadedFont, look: LookName): PartInfo[] {
  const word = new Word(text, font, look, { width: 6, height: 2 });
  return [...word.partsOf('body'), ...word.partsOf('run')];
}
```

- [x] **Step 6: Verify and commit**

Run: `npm run check`
Expected: clean.

```bash
git add packages/core/dev/composition-lab/src/pool.ts packages/core/test/composition-lab/pool.test.ts
git commit -m "give the composition lab a synthetic pool with uneven spans, and a real one"
```

---

### Task 6: The preview, on a scrubbable clock

**Files:**
- Create: `packages/core/dev/composition-lab/src/Preview.tsx`
- Create: `packages/core/dev/composition-lab/src/font.ts`
- Modify: `packages/core/dev/composition-lab/src/App.tsx`

- [x] **Step 1: Write the font module**

Create `packages/core/dev/composition-lab/src/font.ts`, mirroring `tube-lab/src/font.ts`:

```ts
// The lab font, read from apps/lab rather than copied: one binary, and a move over there breaks
// this import loudly instead of leaving two fonts to drift.
import fontUrl from '../../../../../apps/lab/public/font.ttf?url';

export { fontUrl };
```

- [x] **Step 2: Write the preview**

Create `packages/core/dev/composition-lab/src/Preview.tsx`:

```tsx
import { createKlieg, ManualClock } from '@core/index.js';
import { useEffect, useRef } from 'react';
import { type Composition, toFireOptions } from './composition.js';
import { fontUrl } from './font.js';

export interface PreviewProps {
  composition: Composition;
  /** Milliseconds into the fire. A decrease rebuilds; an increase advances. */
  elapsed: number;
}

/**
 * A real fire on a clock the lab owns. Seeking backward rebuilds and jumps straight to the target
 * in one advance, which is byte-identical to playing there at 60fps — `spikes/seek-rebuild/`
 * measures it. Seeking forward just advances, because a rebuild is the expensive half.
 */
export function Preview({ composition, elapsed }: PreviewProps) {
  const host = useRef<HTMLDivElement>(null);
  const rig = useRef<{ clock: ManualClock; at: number; destroy: () => void } | null>(null);
  const key = JSON.stringify(composition);

  useEffect(() => {
    const target = host.current;
    if (!target) return;

    let live = true;
    const clock = new ManualClock();
    const instance = createKlieg({ target, clock, fontUrl });
    void instance.fire(composition.text, toFireOptions(composition)).catch(() => {});
    rig.current = {
      clock,
      at: 0,
      destroy: () => {
        live = false;
        instance.destroy();
      },
    };
    return () => {
      if (live) rig.current?.destroy();
      rig.current = null;
    };
    // `key` is the whole composition: any change to it rebuilds the fire, which is the only way
    // to apply a new look or a new effect list to an already-running one.
  }, [key, composition]);

  useEffect(() => {
    const r = rig.current;
    if (!r) return;
    if (elapsed >= r.at) {
      r.clock.advance(elapsed - r.at);
      r.at = elapsed;
    }
    // A backward seek is handled by the rebuild the key change triggers; when the composition has
    // not changed, the caller rebuilds by bumping `key` itself.
  }, [elapsed]);

  return <div className="cl-preview-host" ref={host} />;
}
```

- [x] **Step 3: Wire it into the App with a transport**

Replace `packages/core/dev/composition-lab/src/App.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { type Composition, DEFAULT_COMPOSITION } from './composition.js';
import { Preview } from './Preview.js';

/** How far past `hold` the transport runs, so an exit is visible. */
const TAIL_MS = 2000;

export function App() {
  const [composition] = useState<Composition>(DEFAULT_COMPOSITION);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const last = useRef(performance.now());
  const span = composition.hold + TAIL_MS;

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = (now: number) => {
      const dt = now - last.current;
      last.current = now;
      setElapsed((e) => (e + dt) % span);
      raf = requestAnimationFrame(tick);
    };
    last.current = performance.now();
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, span]);

  /** A backward seek needs a rebuilt fire, so it bumps the epoch the preview is keyed on. */
  const seek = (to: number) => {
    setPlaying(false);
    if (to < elapsed) setEpoch((n) => n + 1);
    setElapsed(to);
  };

  return (
    <div className="cl-shell">
      <aside className="cl-rail">rail</aside>
      <main className="cl-main">
        <section className="cl-preview">
          <Preview key={epoch} composition={composition} elapsed={elapsed} />
        </section>
        <section className="cl-transport">
          <button type="button" onClick={() => setPlaying((p) => !p)}>
            {playing ? 'pause' : 'play'}
          </button>
          <input
            type="range" min={0} max={span} step={10} value={elapsed}
            onChange={(e) => seek(Number(e.target.value))}
          />
          <span>{(elapsed / 1000).toFixed(2)}s / {(span / 1000).toFixed(1)}s</span>
        </section>
        <section className="cl-panels">panels</section>
      </main>
    </div>
  );
}
```

- [x] **Step 4: Style the preview host**

Append to `packages/core/dev/composition-lab/src/styles.css`:

```css
.cl-preview-host {
  position: relative;
  width: 100%;
  height: 320px;
}

.cl-transport {
  display: flex;
  gap: 10px;
  align-items: center;
}

.cl-transport input[type='range'] {
  flex: 1;
}
```

- [x] **Step 5: Verify by eye**

Run: `npm run dev:composition-lab -w klieg`, open `http://localhost:5183`.
Expected: `ACRONYM` renders in `tubing` and plays; pause holds it; dragging the scrubber backward
re-renders at that time rather than freezing. No console errors.

Then `npm run check` — expected clean.

- [x] **Step 6: Commit**

```bash
git add packages/core/dev/composition-lab/src
git commit -m "put a real fire on a scrubbable clock in the composition lab"
```

---

### Task 7: The raster, with a coverage overlay

The panel that makes a `roving`-class fault visible: every part down, one pass across, and an
explicit mark on parts the composition never touches.

**Files:**
- Create: `packages/core/dev/composition-lab/src/Raster.tsx`
- Modify: `packages/core/dev/composition-lab/src/App.tsx`
- Modify: `packages/core/dev/composition-lab/src/styles.css`

- [x] **Step 1: Write the raster**

Create `packages/core/dev/composition-lab/src/Raster.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import type { PassSamples } from './sample.js';

export interface RasterProps {
  samples: PassSamples;
  /** 0..1 within the pass, drawn as a playhead. */
  at: number;
}

/** Lit is background; a drop is warm. An untouched row is struck through, because "never dark"
 * and "never addressed" look identical otherwise and only one of them is a bug. */
export function Raster({ samples, at }: RasterProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = Math.max(60, samples.gain.length * 6);
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    canvas.style.height = `${h}px`;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    g.clearRect(0, 0, w, h);

    const rows = samples.gain.length;
    const rh = h / Math.max(1, rows);
    for (let r = 0; r < rows; r++) {
      const row = samples.gain[r] as number[];
      for (let s = 0; s < samples.samples; s++) {
        const gain = row[s] as number;
        if (gain > 0.999) continue;
        g.fillStyle = `rgb(255,${Math.round(90 + gain * 90)},${Math.round(40 + gain * 40)})`;
        g.fillRect((s / samples.samples) * w, r * rh, Math.max(1, w / samples.samples), rh - 1);
      }
      if (!samples.touched[r]) {
        g.fillStyle = 'rgba(120,130,145,0.35)';
        g.fillRect(0, r * rh + rh / 2 - 0.5, w, 1);
      }
    }

    g.strokeStyle = '#5aa9e6';
    g.beginPath();
    g.moveTo(at * w, 0);
    g.lineTo(at * w, h);
    g.stroke();
  }, [samples, at]);

  const untouched = samples.touched.filter((t) => !t).length;
  return (
    <div className="cl-panel">
      <h2>
        part × time
        {untouched > 0 ? (
          <span className="cl-warn"> — {untouched} of {samples.touched.length} never touched</span>
        ) : null}
      </h2>
      <canvas ref={ref} />
    </div>
  );
}
```

- [x] **Step 2: Feed it from the App**

In `App.tsx`, add the imports:

```tsx
import { EffectFrame, planEffects } from '@core/effects/frame.js';
import { useMemo } from 'react';
import { toFireOptions } from './composition.js';
import { syntheticPool } from './pool.js';
import { Raster } from './Raster.js';
import { samplePass } from './sample.js';
```

Add inside `App`, after the `span` line:

```tsx
  const parts = useMemo(() => syntheticPool(24, 7), []);
  const samples = useMemo(() => {
    const specs = toFireOptions(composition).effects ?? [];
    const frame = new EffectFrame(planEffects(specs, parts));
    const longest = Math.max(1, ...specs.map((s) => (s.piece as { duration: number }).duration));
    return { pass: longest, data: samplePass(frame, parts, longest, 600, NO_CTX) };
  }, [composition, parts]);
```

Add the `NO_CTX` constant near the top of `App.tsx`:

```tsx
/** The lab's own frame context. The pointer panel replaces this in a later task. */
const NO_CTX = { pointer: null, pointerInWord: null, dt: 16.7 };
```

Replace the `panels` section with:

```tsx
        <section className="cl-panels">
          <Raster samples={samples.data} at={(elapsed % samples.pass) / samples.pass} />
        </section>
```

- [x] **Step 3: Style the panel**

Append to `styles.css`:

```css
.cl-panel {
  border: 1px solid var(--cl-edge, #262b33);
  border-radius: 5px;
  padding: 10px;
}

.cl-panel h2 {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin: 0 0 6px;
}

.cl-panel canvas {
  display: block;
  width: 100%;
}

.cl-warn {
  color: #ffb347;
  text-transform: none;
  letter-spacing: 0;
}
```

- [x] **Step 4: Verify by eye, then commit**

Run the lab. With no effect layers the raster is empty and reports 24 of 24 never touched — that
is correct, and is the empty-target warning doing its job before any layer exists.

Run: `npm run check`. Expected clean.

```bash
git add packages/core/dev/composition-lab/src
git commit -m "draw the part-by-time raster with an untouched-part overlay"
```

---

### Task 8: The rail — layers, params, targeting

**Files:**
- Create: `packages/core/dev/composition-lab/src/Rail.tsx`
- Modify: `packages/core/dev/composition-lab/src/App.tsx`
- Modify: `packages/core/dev/composition-lab/src/styles.css`

- [x] **Step 1: Write the rail**

Create `packages/core/dev/composition-lab/src/Rail.tsx`:

```tsx
import type { PartKind } from '@core/effects/types.js';
import { LOOK_NAMES } from '@core/index.js';
import type { LookName } from '@core/render/looks.js';
import type { Composition, EffectLayer } from './composition.js';
import { defaultParams, PARAMS, type PieceKind } from './pieces.js';

export interface RailProps {
  composition: Composition;
  onChange: (next: Composition) => void;
  counts: Record<PartKind, number>;
}

const KINDS: PieceKind[] = ['flicker', 'hue', 'chase'];

export function Rail({ composition, onChange, counts }: RailProps) {
  const setLayer = (id: string, patch: Partial<EffectLayer>) =>
    onChange({
      ...composition,
      effects: composition.effects.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    });

  const add = (kind: PieceKind) =>
    onChange({
      ...composition,
      effects: [
        ...composition.effects,
        {
          id: `${kind}-${composition.effects.length}`,
          kind,
          enabled: true,
          params: defaultParams(kind),
          target: 'run',
          amount: 1,
          seed: 0,
        },
      ],
    });

  return (
    <>
      <h2>word</h2>
      <label className="cl-row">
        <span>text</span>
        <input
          value={composition.text}
          onChange={(e) => onChange({ ...composition, text: e.target.value })}
        />
      </label>
      <label className="cl-row">
        <span>look</span>
        <select
          value={composition.look}
          onChange={(e) => onChange({ ...composition, look: e.target.value as LookName })}
        >
          {LOOK_NAMES.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
      <label className="cl-row">
        <span>hold</span>
        <input
          type="range" min={1000} max={30000} step={500} value={composition.hold}
          onChange={(e) => onChange({ ...composition, hold: Number(e.target.value) })}
        />
        <output>{composition.hold}</output>
      </label>

      <h2>pool</h2>
      <p className="cl-note">
        run {counts.run}, body {counts.body}
      </p>

      <h2>layers</h2>
      {composition.effects.map((layer) => (
        <div className="cl-layer" key={layer.id}>
          <label className="cl-row">
            <input
              type="checkbox" checked={layer.enabled}
              onChange={(e) => setLayer(layer.id, { enabled: e.target.checked })}
            />
            <strong>{layer.kind}</strong>
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...composition,
                  effects: composition.effects.filter((l) => l.id !== layer.id),
                })
              }
            >
              ×
            </button>
          </label>

          <label className="cl-row" title="Which pool this layer draws from. A kind the look does not build is an empty pool, and the layer silently does nothing.">
            <span>target</span>
            <select
              value={layer.target}
              onChange={(e) => setLayer(layer.id, { target: e.target.value as PartKind })}
            >
              <option value="run">run</option>
              <option value="body">body</option>
            </select>
          </label>
          {counts[layer.target] === 0 ? (
            <p className="cl-warn">
              this look builds no {layer.target} parts — the layer does nothing
            </p>
          ) : null}

          <label className="cl-row" title="Share of the pool this layer drives. roving wants 1: it picks its holder from the whole pool, so against a subset the fault lands where nothing is driven.">
            <span>amount</span>
            <input
              type="range" min={0} max={1} step={0.05} value={layer.amount}
              onChange={(e) => setLayer(layer.id, { amount: Number(e.target.value) })}
            />
            <output>{layer.amount.toFixed(2)}</output>
          </label>

          {layer.kind !== 'draft'
            ? PARAMS[layer.kind].map((p) => (
                <label className="cl-row" key={p.key} title={p.hint}>
                  <span>{p.key}</span>
                  <input
                    type="range" min={p.min} max={p.max} step={p.step}
                    value={layer.params[p.key] ?? p.value}
                    onChange={(e) =>
                      setLayer(layer.id, {
                        params: { ...layer.params, [p.key]: Number(e.target.value) },
                      })
                    }
                  />
                  <output>{layer.params[p.key] ?? p.value}</output>
                </label>
              ))
            : null}

          <label className="cl-row" title="Moves this layer's affliction from part to part. Its pass is many inner passes long, so a short hold may never reach a second handover.">
            <input
              type="checkbox" checked={layer.roving !== undefined}
              onChange={(e) =>
                setLayer(layer.id, {
                  roving: e.target.checked ? { dwell: 3200, seed: 0, epochs: 96 } : undefined,
                })
              }
            />
            <span>roving</span>
          </label>
          {layer.roving ? (
            <>
              <label className="cl-row" title="Roughly how long one part keeps the fault. This picks WHO flickers, never how much — that is unrest.">
                <span>dwell</span>
                <input
                  type="range" min={400} max={9000} step={100} value={layer.roving.dwell}
                  onChange={(e) =>
                    setLayer(layer.id, {
                      roving: { ...(layer.roving as NonNullable<EffectLayer['roving']>), dwell: Number(e.target.value) },
                    })
                  }
                />
                <output>{layer.roving.dwell}</output>
              </label>
              <label className="cl-row" title="Handovers to a pass, and so the ceiling on how many parts a pass can reach before it loops. Below the pool size, some parts never take the fault at all.">
                <span>epochs</span>
                <input
                  type="range" min={4} max={192} step={4} value={layer.roving.epochs}
                  onChange={(e) =>
                    setLayer(layer.id, {
                      roving: { ...(layer.roving as NonNullable<EffectLayer['roving']>), epochs: Number(e.target.value) },
                    })
                  }
                />
                <output>{layer.roving.epochs}</output>
              </label>
            </>
          ) : null}
        </div>
      ))}

      <div className="cl-row">
        {KINDS.map((k) => (
          <button type="button" key={k} onClick={() => add(k)}>
            + {k}
          </button>
        ))}
      </div>
    </>
  );
}
```

- [x] **Step 2: Wire it in**

In `App.tsx`, replace `<aside className="cl-rail">rail</aside>` with:

```tsx
      <aside className="cl-rail">
        <Rail composition={composition} onChange={setComposition} counts={poolCounts(parts)} />
      </aside>
```

Change `const [composition] = useState(...)` to `const [composition, setComposition] = useState(...)`,
and add `import { Rail } from './Rail.js';` and `poolCounts` to the `./pool.js` import.

- [x] **Step 3: Style the rail**

Append to `styles.css`:

```css
.cl-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
}

.cl-row > span:first-child {
  flex: 0 0 66px;
}

.cl-row input[type='range'] {
  flex: 1;
  min-width: 0;
}

.cl-row output {
  flex: 0 0 48px;
  text-align: right;
}

.cl-layer {
  border-top: 1px solid var(--cl-edge, #262b33);
  padding-top: 8px;
  margin-bottom: 10px;
}

.cl-note {
  margin: 0 0 10px;
  opacity: 0.7;
}
```

- [x] **Step 4: Verify by eye**

Run the lab. Add a `flicker` layer, tick `roving`, and confirm: the raster fills, the untouched
count falls, and dragging `epochs` down to 8 makes the untouched count climb — which is the
`EPOCHS` finding reproduced live, in the instrument built to catch it.

Switch the look to `neon` and confirm the rail warns that the look builds no `run` parts.

Run: `npm run check`. Expected clean.

- [x] **Step 5: Commit**

```bash
git add packages/core/dev/composition-lab/src
git commit -m "give the composition lab a control rail with an empty-target warning"
```

---

### Task 9: The channel plot

**Files:**
- Create: `packages/core/dev/composition-lab/src/Plot.tsx`
- Modify: `packages/core/dev/composition-lab/src/App.tsx`

- [x] **Step 1: Write it**

Create `packages/core/dev/composition-lab/src/Plot.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import type { PassSamples } from './sample.js';

export type Channel = 'gain' | 'scale' | 'dark' | 'crawl';

export interface PlotProps {
  samples: PassSamples;
  channel: Channel;
  /** Which part's row to draw. */
  part: number;
  at: number;
}

export function Plot({ samples, channel, part, at }: PlotProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = 110;
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    canvas.style.height = `${h}px`;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    g.clearRect(0, 0, w, h);

    const row = samples[channel][part];
    if (!row) return;
    let lo = Math.min(...row);
    let hi = Math.max(...row);
    // A flat channel would divide by zero and draw nothing; show it as a line at its own value.
    if (hi - lo < 1e-9) { lo -= 0.5; hi += 0.5; }

    g.strokeStyle = '#ffb347';
    g.beginPath();
    for (let s = 0; s < row.length; s++) {
      const y = h - 3 - (((row[s] as number) - lo) / (hi - lo)) * (h - 6);
      const x = (s / (row.length - 1)) * w;
      s ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();

    g.strokeStyle = '#5aa9e6';
    g.beginPath();
    g.moveTo(at * w, 0);
    g.lineTo(at * w, h);
    g.stroke();
  }, [samples, channel, part, at]);

  const row = samples[channel][part];
  const range = row ? `${Math.min(...row).toFixed(3)} … ${Math.max(...row).toFixed(3)}` : 'no data';
  return (
    <div className="cl-panel">
      <h2>{channel} — part {part} <span className="cl-note">{range}</span></h2>
      <canvas ref={ref} />
    </div>
  );
}
```

- [x] **Step 2: Wire it in with a channel and part selector**

In `App.tsx`, add state and render it in the panels section:

```tsx
  const [channel, setChannel] = useState<Channel>('gain');
  const [focus, setFocus] = useState(0);
```

```tsx
          <div className="cl-row">
            <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
              {(['gain', 'scale', 'dark', 'crawl'] as const).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <input
              type="range" min={0} max={Math.max(0, parts.length - 1)} step={1} value={focus}
              onChange={(e) => setFocus(Number(e.target.value))}
            />
            <output>part {focus}</output>
          </div>
          <Plot
            samples={samples.data} channel={channel} part={focus}
            at={(elapsed % samples.pass) / samples.pass}
          />
```

Add `import { Plot, type Channel } from './Plot.js';`.

- [x] **Step 3: Verify and commit**

Run the lab, confirm the plot tracks the raster's playhead and that switching to `crawl` with a
`chase` layer shows a ramp.

Run: `npm run check`. Expected clean.

```bash
git add packages/core/dev/composition-lab/src
git commit -m "plot one part's channel across a pass"
```

---

### Task 10: Emit the composition

**Files:**
- Create: `packages/core/dev/composition-lab/src/emit.ts`
- Create: `packages/core/test/composition-lab/emit.test.ts`
- Modify: `packages/core/dev/composition-lab/src/Rail.tsx`

- [x] **Step 1: Write the failing test**

Create `packages/core/test/composition-lab/emit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPOSITION } from '../../dev/composition-lab/src/composition.js';
import { emit } from '../../dev/composition-lab/src/emit.js';

describe('emit', () => {
  it('writes a fire call with the look and hold', () => {
    const out = emit({ ...DEFAULT_COMPOSITION, look: 'piping', hold: 4000 });
    expect(out).toContain("look: 'piping'");
    expect(out).toContain('hold: 4000');
  });

  it('writes an effects list with the factory call for each enabled layer', () => {
    const out = emit({
      ...DEFAULT_COMPOSITION,
      effects: [
        { id: 'a', kind: 'flicker', enabled: true, params: { unrest: 0.4 }, target: 'run', amount: 1, seed: 0 },
      ],
    });
    expect(out).toContain('flicker({');
    expect(out).toContain('unrest: 0.4');
  });

  it('wraps in roving when the layer does', () => {
    const out = emit({
      ...DEFAULT_COMPOSITION,
      effects: [
        {
          id: 'a', kind: 'flicker', enabled: true, params: {}, target: 'run', amount: 1, seed: 0,
          roving: { dwell: 3200, seed: 0, epochs: 96 },
        },
      ],
    });
    expect(out).toContain('roving(flicker({');
    expect(out).toContain('dwell: 3200');
  });

  it('omits a disabled layer', () => {
    const out = emit({
      ...DEFAULT_COMPOSITION,
      effects: [
        { id: 'a', kind: 'hue', enabled: false, params: {}, target: 'run', amount: 1, seed: 0 },
      ],
    });
    expect(out).not.toContain('hue(');
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/core/test/composition-lab/emit.test.ts`
Expected: FAIL — cannot resolve `emit.js`.

- [x] **Step 3: Write it**

Create `packages/core/dev/composition-lab/src/emit.ts`:

```ts
import type { Composition, EffectLayer } from './composition.js';

const args = (params: Record<string, number>) =>
  Object.entries(params)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

function layerSource(layer: EffectLayer): string {
  const inner =
    layer.kind === 'draft'
      ? `/* draft */ { duration: 1000, at(t, part) {\n${layer.source ?? ''}\n} }`
      : `${layer.kind}({ ${args(layer.params)} })`;
  const piece = layer.roving
    ? `roving(${inner}, { dwell: ${layer.roving.dwell}, seed: ${layer.roving.seed}, epochs: ${layer.roving.epochs} })`
    : inner;
  const stagger = layer.stagger === undefined ? '' : `\n      stagger: ${layer.stagger},`;
  return `    {
      piece: ${piece},
      target: { kind: '${layer.target}', amount: ${layer.amount} },
      seed: ${layer.seed},${stagger}
    },`;
}

/** The `fire()` call this composition describes, ready to paste. */
export function emit(c: Composition): string {
  const layers = c.effects.filter((l) => l.enabled).map(layerSource);
  const effects = layers.length > 0 ? `\n  effects: [\n${layers.join('\n')}\n  ],` : '';
  return `klieg.fire(${JSON.stringify(c.text)}, {
  look: '${c.look}',
  enter: '${c.enter}',
  active: '${c.active}',
  exit: '${c.exit}',
  hold: ${c.hold},${effects}
});`;
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/core/test/composition-lab/emit.test.ts`
Expected: PASS, 4 tests.

- [x] **Step 5: Add the copy button to the rail**

In `Rail.tsx`, add `import { emit } from './emit.js';` and append before the closing fragment:

```tsx
      <h2>emit</h2>
      <button type="button" onClick={() => void navigator.clipboard.writeText(emit(composition))}>
        copy fire() call
      </button>
      <pre className="cl-emit">{emit(composition)}</pre>
```

Append to `styles.css`:

```css
.cl-emit {
  white-space: pre-wrap;
  font-size: 11px;
  opacity: 0.75;
  overflow-x: auto;
}
```

- [x] **Step 6: Verify and commit**

Run: `npm run check`. Expected clean.

```bash
git add packages/core/dev/composition-lab/src packages/core/test/composition-lab/emit.test.ts
git commit -m "emit the tuned composition as a pasteable fire() call"
```

---

### Task 11: Persist the lab's state

**Files:**
- Create: `packages/core/dev/composition-lab/src/persist.ts`
- Modify: `packages/core/dev/composition-lab/src/main.tsx`, `src/App.tsx`

- [x] **Step 1: Write it**

Create `packages/core/dev/composition-lab/src/persist.ts`, mirroring `tube-lab/src/persist.ts`:

```ts
import { type Composition, DEFAULT_COMPOSITION } from './composition.js';

const KEY = 'klieg:composition-lab';

export function save(composition: Composition): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(composition));
  } catch {
    // A private window with storage blocked is not a reason to lose the lab.
  }
}

export function restore(): Composition {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_COMPOSITION;
    // Spread over the default so a composition saved before a field existed still loads.
    return { ...DEFAULT_COMPOSITION, ...(JSON.parse(raw) as Partial<Composition>) };
  } catch {
    return DEFAULT_COMPOSITION;
  }
}

export function clear(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // As above.
  }
}
```

- [x] **Step 2: Use it**

In `App.tsx`, change the initial state to `useState<Composition>(restore)` and add:

```tsx
  useEffect(() => {
    save(composition);
  }, [composition]);
```

Add `import { restore, save } from './persist.js';`.

- [x] **Step 3: Verify and commit**

Run the lab, add a layer, reload, confirm it survives.

Run: `npm run check`. Expected clean.

```bash
git add packages/core/dev/composition-lab/src
git commit -m "persist the composition lab's state across reloads"
```

---

### Task 12: Document the lab

**Files:**
- Modify: `docs/superpowers/HANDOFF.md`
- Modify: `README.md` (dev labs list, if one exists; otherwise skip)

- [x] **Step 1: Write the handoff entry**

Replace the "A composition lab, so effect pieces get built by hand" bullet in
`docs/superpowers/HANDOFF.md` with what shipped: the command to run it, what each panel answers,
and the two things it is honest and dishonest about (time, intensity). Note that
`spikes/seek-rebuild/` is the evidence for the scrub, and that its ports are copies while the lab
imports core.

- [x] **Step 2: Commit**

```bash
git add docs/superpowers/HANDOFF.md README.md
git commit -m "point the handoff at the composition lab"
```

---

## Self-review

**Spec coverage.** Preview as primary view — Task 6. Timeline lanes — **not covered; deferred**, see
below. Channel plot — Task 9. Raster with coverage overlay — Task 7. Swatch grid — **built in
[round two](2026-09-01-composition-lab-round-two.md)**. Tenure/jump readout — **built in round
two**. Sweep — **built in round two**.
`resolveFrame` — Task 1. Pool sources — Task 5. Empty-target warning — Tasks 5 and 8. Authoring —
partly: `draft.ts` lands in Task 3, the editing UI is **deferred**. Emit — Task 10. Persist —
Task 11. Testing — Tasks 1, 3, 4, 5, 10.

**Deferred, deliberately.** Tasks 1–12 are the spine: a composition you can build, watch, scrub,
measure and paste. The timeline lanes, swatch grid, tenure readout, param sweep and the draft
editing pane are each additive panels over the same `PassSamples` and `Composition` types, and
none of them changes an interface the spine defines. They are worth a second plan once the spine
is real, rather than a longer first one — the spine is what proves the shape.

That second plan is [round two](2026-09-01-composition-lab-round-two.md), which built the swatch
grid, the tenure readout and the sweep. Timeline lanes and the draft editing pane are still
deferred.

**Types.** `PassSamples` is defined in Task 4 and consumed in Tasks 7 and 9 under the same field
names. `Composition`/`EffectLayer` are defined in Task 3 and consumed in Tasks 6, 8, 10, 11.
`PieceKind` is defined in Task 3's `pieces.ts` and used in Tasks 3, 8, 10. `EffectFrame`/
`planEffects` are defined in Task 1 and used in Tasks 4 and 7.

**Known risk.** Task 6's preview rebuilds the whole fire on every composition change, including a
slider drag, because `key` is the serialised composition. If that stutters, the fix is to debounce
the key rather than to make the preview stateful — the design's fallback (caching resolved frames)
is the second resort.
