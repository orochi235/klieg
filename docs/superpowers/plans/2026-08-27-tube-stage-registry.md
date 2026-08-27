# Tube Stage Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `buildTubeBlueprint`'s fixed sequence into an ordered `TUBE_STAGES` registry it folds over, so a lab can name a step, draw its output, and switch it off — without changing a single pixel of what ships.

**Architecture:** A new `render/tube/stages.ts` holds `TUBE_STAGES`, an ordered array over the ids `generate`, `wander`, `cut`, `assign`, `sweep`. Each entry has `run(state, ctx)` and, where passing the step through means something, `bypass(state, ctx)`. `buildTubeBlueprint` keeps its four positional arguments and gains a fifth optional `TubeBuildOptions` carrying `stages?` (which ids run) and `onStage?` (called after each). Both absent is today's behavior exactly, which is what every shipped caller passes.

**Tech Stack:** TypeScript, vitest, three.js. Playwright for the pixel guard.

**Read first:** `docs/superpowers/specs/2026-08-23-pipeline-lab-design.md` — the whole design this is slice 1 of. In particular "The two registries" and "Traps". `packages/core/src/render/tube/index.ts:115-205` is the function being folded.

**Not in this plan:** `CUT_REPAIRS` (slice 2) and the lab itself (slice 3). The design's own prerequisite — replacing `markAuthored`'s `WeakSet` with `Run.from` provenance — already shipped; do not redo it.

---

## What "skipping a stage" means, and why `bypass` exists

The design gives `buildTubeBlueprint` an `enabled` set and says nothing about what a skipped stage
leaves behind. Taken literally — skip means the step's code does not run — switching off `cut` gives
an empty blueprint, and a lab toggle that blanks the canvas is not a lab toggle. So a stage may
declare `bypass`, which runs in the disabled stage's place and passes the pipeline through:

| Stage | `run` | disabled |
| --- | --- | --- |
| `generate` | contours + connectors | nothing; the blueprint is empty |
| `wander` | bends face paths in z | nothing — identical to `amplitude: 0` |
| `cut` | corner stage, runs, corner records | **one run per path**, whole path, no corner records |
| `assign` | picks which runs light, deals colours | nothing — runs keep `lit: true`, `color: 0` from the cut |
| `sweep` | run geometry | nothing; `lit` and `dark` stay empty |

Bypassing `cut` is the interesting one: sweeping a raw contour draws a tube through corners no
fillet has softened, so it self-intersects. That is the point. The design's trap list already says
a switched-off repair "can produce self-intersecting geometry… but the tile has to survive drawing
it rather than throw", and the same holds a level up.

## Two typed sets, not one set of strings

The design writes `enabled?: ReadonlySet<string>` at both levels. A single untyped set shared by
stages and repairs has a silent failure in it: a caller that passes only repair ids disables all
five stages and gets an empty blueprint with nothing thrown. This plan types the stage set as
`ReadonlySet<TubeStageId>` so a repair id passed to it is a compile error. Slice 2 adds a separate
`repairs?: ReadonlySet<CutRepairId>` alongside it, forwarded down to `cutIntoRuns`.

## Traps

**`stages.ts` imports `TubeSpec` from `index.ts`, which imports `TUBE_STAGES` back.** The back
edge must stay `import type` — types are erased at emit, so there is no runtime cycle. A value
import in that direction is a real cycle and will bite at module init.

**`onStage` hands out live state, and `wander` mutates path points in place.** A lab that keeps a
`generate` snapshot and looks at it after `wander` sees wandered points. Clone in the consumer;
this plan does not clone on the way out, because every shipped caller passes no `onStage` at all
and cloning every stage would cost them.

**Stages mutate `state`'s arrays; they must never reassign them.** `buildTubeBlueprint` returns
`state.runs` and closes `dispose()` over the same arrays, so a stage that assigned a fresh array
would leave the blueprint holding the old one. The `TubeStageState` fields are declared `readonly`
to make that a compile error.

**`assign` mutates its input and returns the same array**, which the `assign` stage relies on. That
contract is not currently asserted anywhere — Task 4 pins it.

**Order around connectors is load-bearing, and merging them early is safe for one specific
reason.** Today `generateConnectors` runs on unwandered front paths, then `wanderPaths` runs on
`paths` only, then `cutPaths = [...paths, ...links]`. The `generate` stage concatenates up front
instead, so `wander` sees connectors too — harmless only because `wanderPaths` returns early on any
path whose surface is not `front` or `back`, and connectors are `'connector'`. If that guard ever
goes, this changes behavior silently. `Run.from.path` indexes into the concatenated array, and the
order (contours then links) is unchanged, so indices still mean what they meant.

**And the concat order reaches further than provenance.** `wanderPaths` seeds its rng from the
`forEach` index, so a path's index is part of how it bends. Connectors sorting after contours is
what keeps every contour's index — and therefore every wander seed — byte-identical to before the
fold. Reordering the concatenation would silently re-baseline every wandered look, which no type
and no test outside the look snapshots would catch.

**`CornerWeights` has no `return` weight.** It is `{ break, connect, hairpin? }`. `return` is a
`CornerStrategy` the cut produces from `blockout`, not something a spec weights — and an excess
property on an object literal is only a type error where TypeScript checks it, so a scratch script
run through vitest alone will not catch one.

**Do not measure a pipeline through `JSON.stringify`.** `tightestBend` returns `Infinity` for a run
with no curvature, and `JSON.stringify(Infinity)` is `null` — so a script that prints its findings
as JSON reports six straight runs as `null` and pins the artifact rather than the value. This plan
had exactly that bug in its first draft.

**The corner-record clone moves from after `assign` to the end of the `cut` stage.** Its comment
says it must happen after `wander`, and it still does. Nothing between cut and assign moves a
point, so the two placements are equivalent — but a lab reading an `onStage('cut', …)` snapshot
gets safe clones this way instead of vectors aliasing the paths.

## No CHANGELOG entry

Every new symbol is `@internal` and nothing on the public entry changes. There is nothing here for
someone deciding whether to upgrade.

---

## Task 1: Pin what the pipeline produces today

The refactor's whole claim is "behavior unchanged", so the assertions come first — against the
current code, green on the first run. **These are characterization tests, not red-green.** Do not
expect a failure in Step 2; a failure there means the numbers in this plan are stale and the
refactor must not start until that is understood.

**Files:**
- Create: `packages/core/test/render/tube/stages.test.ts`

- [x] **Step 1: Write the characterization test**

**Done — the file is committed at `166717d`.** It is the source of truth; this plan does not carry a
second copy to rot. What it pins, so a reader knows what a red run means:

| Fixture | What it reaches that the others do not | Pinned |
| --- | --- | --- |
| `SPEC` | all-break corners, one surface, everything lit | run point counts, geometry vertex counts, 1 path, 4 corners, 6 lit, 0 dark |
| `RICH` | wander, connectors, three surfaces, partial selection | surfaces, point counts, tightest bends, lit flags, path surfaces, `from.path` per run, 5 paths, 12 corners, 7 lit, 7 dark |
| `CONNECT` | fillets, so the corner stage builds analytic points | corner strategies, point counts, bends at `0.1`, null-`from` counts, geometry vertex counts |

Three things the review changed, which anyone re-deriving this file should not undo:

- **Assertions are `expect.soft` and ordered along the pipeline** — generate, cut, assign, sweep. A
  hard `expect` stops at the first failure, so a broken `generate` reported a run-point-count
  mismatch and never reached the path-count assertion that names the real stage.
- **`RICH` pins `bp.paths.map(p => p.surface)` and `bp.runs.map(r => r.from.find(s => s)?.path)`** —
  `['front', 'back', 'wall', 'connector', 'connector']` and `[0,0,0,0,1,1,1,1,2,2,2,2,3,4]`. This is
  the guard on the concatenation trap below: if the fold ever hands `cutIntoRuns` one array while
  exposing another as `blueprint.paths`, provenance indexes into the wrong one with nothing thrown.
- **`round` is plain `Math.round(n * 1e6) / 1e6`.** `Math.round(Infinity)` is already `Infinity`, so
  a `Number.isFinite` guard is dead code — and the twelve `Infinity` literals in the assertions
  already say the walls and connectors are straight.

- [x] **Step 2: Run it and confirm it is green on today's code**

Run: `npx vitest run packages/core/test/render/tube/stages.test.ts`
Expected: PASS, 3 tests. A failure means the pinned numbers are stale — stop and re-measure before
refactoring anything.

- [x] **Step 3: Commit**

```bash
git add packages/core/test/render/tube/stages.test.ts
git commit -m "pin what the tube pipeline builds before naming its steps"
```

---

## Task 2: The registry, and the fold

`buildTubeBlueprint` keeps its four positional arguments. The five stages move out of it verbatim.

**Files:**
- Create: `packages/core/src/render/tube/stages.ts`
- Modify: `packages/core/src/render/tube/index.ts:110-205`
- Test: `packages/core/test/render/tube/stages.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/render/tube/stages.test.ts`:

```ts
import { TUBE_STAGES } from '../../../src/render/tube/stages.js';

describe('TUBE_STAGES', () => {
  it('names the pipeline in the order it runs', () => {
    expect(TUBE_STAGES.map((s) => s.id)).toEqual([
      'generate',
      'wander',
      'cut',
      'assign',
      'sweep',
    ]);
  });

  it('gives every stage a label to put in a lab', () => {
    for (const stage of TUBE_STAGES) {
      expect(stage.label.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/core/test/render/tube/stages.test.ts`
Expected: FAIL — `Failed to load url ../../../src/render/tube/stages.js`

- [ ] **Step 3: Write `stages.ts`**

Create `packages/core/src/render/tube/stages.ts`:

```ts
import type * as THREE from 'three';
import { assign } from './assign.js';
import {
  type GeneratedPath,
  generateConnectors,
  generatePaths,
} from './generators.js';
import type { TubeSpec } from './index.js';
import { type CornerRecord, cutIntoRuns, polyLength, type Run } from './runs.js';
import { surfacesOf } from './surfaces.js';
import { sweepRun } from './sweep.js';
import { wanderPaths } from './wander.js';

/** Grid cells per side for the face field, and the margin exterior levels need. */
const RESOLUTION = 256;
const PAD = 0.35;

/** @internal */
export type TubeStageId = 'generate' | 'wander' | 'cut' | 'assign' | 'sweep';

/** What every stage reads and none of them writes. @internal */
export interface TubeStageContext {
  shapes: THREE.Shape[];
  spec: TubeSpec;
  depth: number;
  seed: number;
}

/**
 * What the pipeline carries from one stage to the next. Every field is `readonly` because
 * `buildTubeBlueprint` returns these arrays and disposes through them: a stage that reassigned one
 * would leave the blueprint holding the old array. Push and splice, never assign.
 * @internal
 */
export interface TubeStageState {
  readonly paths: GeneratedPath[];
  readonly runs: Run[];
  readonly corners: CornerRecord[];
  readonly lit: THREE.BufferGeometry[];
  readonly dark: THREE.BufferGeometry[];
}

/** @internal */
export interface TubeStage {
  id: TubeStageId;
  label: string;
  run(state: TubeStageState, ctx: TubeStageContext): void;
  /** Runs in `run`'s place when the stage is switched off, to pass the pipeline through. */
  bypass?(state: TubeStageState, ctx: TubeStageContext): void;
}

/** @internal */
export const TUBE_STAGES: readonly TubeStage[] = [
  {
    id: 'generate',
    label: 'Generate paths',
    run(state, { shapes, spec, depth }) {
      const surfaces = surfacesOf(shapes, depth);
      const paths = generatePaths(surfaces, spec.surfaces, {
        level: spec.level,
        spacing: spec.spacing,
        wallDepth: spec.wallDepth ?? 0.5,
        wallRise: spec.wallRise,
        resolution: RESOLUTION,
        pad: PAD,
        source: spec.pathSource,
      });
      const links =
        spec.connectors && spec.connectors > 0
          ? generateConnectors(paths, {
              count: spec.connectors,
              overshoot: spec.connectorOvershoot ?? 0.05,
            })
          : [];
      state.paths.push(...paths, ...links);
    },
  },
  {
    id: 'wander',
    label: 'Wander off the plane',
    run(state, { spec, seed }) {
      // Before the cut: a bend wander introduces is a bend the corner stage has to see.
      wanderPaths(state.paths, spec.amplitude ?? 0, seed);
    },
  },
  {
    id: 'cut',
    label: 'Cut into runs',
    run(state, { spec, seed }) {
      const cut = cutIntoRuns(state.paths, {
        runs: spec.runs,
        minRun: spec.minRun,
        corners: spec.corners,
        spacing: spec.spacing,
        bend: spec.bend,
        radius: spec.radius,
        blockout: spec.blockout,
        shortRun: spec.shortRun,
        rejoin: spec.rejoin,
        hairpin: spec.hairpin,
        seed,
      });
      state.runs.push(...cut.runs);
      // Cloned after wander, not before: wander moves path points in place, and every corner
      // interior to a run — every `connect` and `loop` — moves with them.
      state.corners.push(...cut.corners.map((c) => ({ ...c, point: c.point.clone() })));
    },
    bypass(state) {
      state.paths.forEach((path, index) => {
        if (path.points.length < 2) return;
        state.runs.push({
          points: path.points,
          from: path.points.map((_, i) => ({ path: index, index: i })),
          surface: path.surface,
          length: polyLength(path.points),
          index: state.runs.length,
          lit: true,
          color: 0,
        });
      });
    },
  },
  {
    id: 'assign',
    label: 'Light and colour',
    run(state, { spec, seed }) {
      assign(
        state.runs,
        spec.select,
        spec.colors,
        seed,
        spec.surfaceColors,
        spec.surfaces,
        spec.gradient,
      );
    },
  },
  {
    id: 'sweep',
    label: 'Sweep to geometry',
    run(state, { spec }) {
      // The letter domain needs each run's slice of the glyph's lit length, and this is the only
      // place that has the glyph's whole run list.
      const litRuns = state.runs.filter((r) => r.lit);
      const litTotal = litRuns.reduce((a, r) => a + r.length, 0);
      const spans = new Map<number, { start: number; span: number }>();
      let walked = 0;
      for (const run of litRuns) {
        spans.set(run.index, {
          start: litTotal > 0 ? walked / litTotal : 0,
          span: litTotal > 0 ? run.length / litTotal : 0,
        });
        walked += run.length;
      }

      for (const run of state.runs) {
        const place = spec.gradient && run.lit ? spans.get(run.index) : undefined;
        const geo = sweepRun(
          run,
          spec.radius,
          spec.segments,
          spec.gradient && place ? { domain: spec.gradient.domain, place } : undefined,
        );
        if (!geo) continue;
        (run.lit ? state.lit : state.dark).push(geo);
      }
    },
  },
];
```

- [ ] **Step 4: Export `polyLength` from `runs.ts`**

In `packages/core/src/render/tube/runs.ts:152`, change:

```ts
function polyLength(points: THREE.Vector3[]): number {
```

to:

```ts
/** @internal */
export function polyLength(points: THREE.Vector3[]): number {
```

- [ ] **Step 5: Fold `buildTubeBlueprint` over the registry**

In `packages/core/src/render/tube/index.ts`, delete the `RESOLUTION` and `PAD` constants — they moved
to `stages.ts` — and thin the imports to types only, keeping every `export type`/`export` re-export
line below them exactly as it is:

- `./assign.js` — drop the `assign` value; keep `type SelectSpec`.
- `./generators.js` — drop `generateConnectors` and `generatePaths`; keep `type GeneratedPath` and
  `type PathSource`.
- `./runs.js` — drop `cutIntoRuns`; keep `type CornerRecord`, `type CornerWeights`, `type Rejoin`,
  `type Run`, `type ShortRun`.
- `./surfaces.js` — drop `surfacesOf`; keep `type SurfaceKind`.
- `./sweep.js` and `./wander.js` — the whole import line goes.

Then add:

```ts
import type { TubeStageId, TubeStageState } from './stages.js';
import { TUBE_STAGES } from './stages.js';

export type { TubeStageId, TubeStageState } from './stages.js';

/** @internal */
export interface TubeBuildOptions {
  /**
   * Which stages run. Absent runs all five, which is what every shipped caller passes. A stage
   * left out runs its `bypass` instead, where it has one.
   */
  stages?: ReadonlySet<TubeStageId>;
  /** Called after each stage that ran, with the live state — nothing is cloned. */
  onStage?(id: TubeStageId, state: TubeStageState): void;
}
```

Then replace the body of `buildTubeBlueprint` with the fold:

```ts
export function buildTubeBlueprint(
  shapes: THREE.Shape[],
  spec: TubeSpec,
  depth: number,
  seed: number,
  opts?: TubeBuildOptions,
): TubeBlueprint {
  const ctx = { shapes, spec, depth, seed };
  const state: TubeStageState = { paths: [], runs: [], corners: [], lit: [], dark: [] };

  for (const stage of TUBE_STAGES) {
    if (opts?.stages && !opts.stages.has(stage.id)) {
      stage.bypass?.(state, ctx);
      continue;
    }
    stage.run(state, ctx);
    opts?.onStage?.(stage.id, state);
  }

  return {
    kind: 'tube',
    runs: state.runs,
    corners: state.corners,
    paths: state.paths,
    lit: state.lit,
    dark: state.dark,
    dispose() {
      for (const g of state.lit) g.dispose();
      for (const g of state.dark) g.dispose();
      state.lit.length = 0;
      state.dark.length = 0;
      state.runs.length = 0;
      state.corners.length = 0;
    },
  };
}
```

- [ ] **Step 6: Run the tube tests**

Run: `npx vitest run packages/core/test/render/tube/`
Expected: PASS — including Task 1's three characterization tests, unchanged.

- [ ] **Step 7: Run the whole check**

Run: `npm run check`
Expected: PASS at 1149 tests — 1144 at the branch point, plus three in Task 1 and two here.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/render/tube/stages.ts packages/core/src/render/tube/index.ts packages/core/src/render/tube/runs.ts packages/core/test/render/tube/stages.test.ts
git commit -m "fold buildTubeBlueprint over a named stage registry"
```

---

## Task 3: `onStage` reports each stage as it finishes

**Files:**
- Test: `packages/core/test/render/tube/stages.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `describe('TUBE_STAGES', …)`:

```ts
  it('reports each stage in order, once', () => {
    const seen: string[] = [];
    const bp = buildTubeBlueprint([square()], SPEC, 0.3, 0, {
      onStage: (id) => seen.push(id),
    });
    expect(seen).toEqual(['generate', 'wander', 'cut', 'assign', 'sweep']);
    bp.dispose();
  });

  it('reports state that has grown by the time each stage is named', () => {
    const at = new Map<string, { paths: number; runs: number; geo: number }>();
    const bp = buildTubeBlueprint([square()], SPEC, 0.3, 0, {
      onStage: (id, state) =>
        at.set(id, {
          paths: state.paths.length,
          runs: state.runs.length,
          geo: state.lit.length + state.dark.length,
        }),
    });
    expect(at.get('generate')).toEqual({ paths: 1, runs: 0, geo: 0 });
    expect(at.get('wander')).toEqual({ paths: 1, runs: 0, geo: 0 });
    expect(at.get('cut')).toEqual({ paths: 1, runs: 6, geo: 0 });
    expect(at.get('assign')).toEqual({ paths: 1, runs: 6, geo: 0 });
    expect(at.get('sweep')).toEqual({ paths: 1, runs: 6, geo: 6 });
    bp.dispose();
  });

  it('builds the same blueprint whether or not anyone is watching', () => {
    const watched = buildTubeBlueprint([square()], SPEC, 0.3, 0, { onStage: () => {} });
    const plain = buildTubeBlueprint([square()], SPEC, 0.3, 0);
    expect(watched.runs.map((r) => [r.points.length, r.lit, r.color])).toEqual(
      plain.runs.map((r) => [r.points.length, r.lit, r.color]),
    );
    watched.dispose();
    plain.dispose();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/core/test/render/tube/stages.test.ts`
Expected: PASS — `onStage` was built in Task 2. If it fails, the fold is wrong; fix Task 2 rather
than this test.

This task's tests are a guard on Task 2's wiring rather than a driver for new code. They are worth
their own commit because the "grown by the time each stage is named" test is what would catch a
stage silently reordered later.

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/render/tube/stages.test.ts
git commit -m "pin the order and the growth onStage reports"
```

---

## Task 4: `stages` switches a step off, and `bypass` passes it through

**Files:**
- Test: `packages/core/test/render/tube/stages.test.ts`
- Test: `packages/core/test/render/tube/assign.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new `describe` to `packages/core/test/render/tube/stages.test.ts`:

```ts
const ALL = new Set<TubeStageId>(['generate', 'wander', 'cut', 'assign', 'sweep']);
const without = (...off: TubeStageId[]) => {
  const on = new Set(ALL);
  for (const id of off) on.delete(id);
  return on;
};

describe('switching a stage off', () => {
  it('runs every stage when the set names them all', () => {
    const gated = buildTubeBlueprint([square()], SPEC, 0.3, 0, { stages: ALL });
    const plain = buildTubeBlueprint([square()], SPEC, 0.3, 0);
    expect(gated.runs.map((r) => r.points.length)).toEqual(
      plain.runs.map((r) => r.points.length),
    );
    gated.dispose();
    plain.dispose();
  });

  it('leaves wander off exactly as amplitude zero does', () => {
    const off = buildTubeBlueprint([square()], RICH, 0.3, 7, { stages: without('wander') });
    const flat = buildTubeBlueprint([square()], { ...RICH, amplitude: 0 }, 0.3, 7);
    expect(off.runs.map((r) => r.points.map((p) => p.z))).toEqual(
      flat.runs.map((r) => r.points.map((p) => p.z)),
    );
    off.dispose();
    flat.dispose();
  });

  it('passes the whole contour through as one run when the cut is off', () => {
    const seen: { paths: number } = { paths: 0 };
    const bp = buildTubeBlueprint([square()], RICH, 0.3, 7, {
      stages: without('cut'),
      onStage: (id, state) => {
        if (id === 'wander') seen.paths = state.paths.length;
      },
    });
    expect(bp.runs).toHaveLength(seen.paths);
    expect(bp.runs.map((r) => r.points.length)).toEqual(
      bp.paths.map((p) => p.points.length),
    );
    expect(bp.runs.map((r) => r.surface)).toEqual(bp.paths.map((p) => p.surface));
    // Nothing was built, so every vertex resolves to a contour vertex.
    expect(bp.runs.every((r) => r.from.every((s) => s !== null))).toBe(true);
    expect(bp.corners).toHaveLength(0);
    bp.dispose();
  });

  it('draws an uncut contour rather than throwing on it', () => {
    const bp = buildTubeBlueprint([square()], SPEC, 0.3, 0, { stages: without('cut') });
    expect(bp.lit.length + bp.dark.length).toBeGreaterThan(0);
    bp.dispose();
  });

  it('leaves the cut colours in place when assign is off', () => {
    const bp = buildTubeBlueprint([square()], RICH, 0.3, 7, { stages: without('assign') });
    expect(bp.runs.every((r) => r.color === 0)).toBe(true);
    expect(bp.runs.every((r) => r.lit)).toBe(true);
    bp.dispose();
  });

  it('keeps the runs and drops the geometry when the sweep is off', () => {
    const bp = buildTubeBlueprint([square()], SPEC, 0.3, 0, { stages: without('sweep') });
    expect(bp.runs).toHaveLength(6);
    expect(bp.lit).toHaveLength(0);
    expect(bp.dark).toHaveLength(0);
    bp.dispose();
  });

  it('empties out rather than throwing when nothing generates', () => {
    const bp = buildTubeBlueprint([square()], SPEC, 0.3, 0, { stages: without('generate') });
    expect(bp.paths).toHaveLength(0);
    expect(bp.runs).toHaveLength(0);
    expect(bp.lit).toHaveLength(0);
    bp.dispose();
  });
});
```

Add `TubeStageId` to the import at the top of the file:

```ts
import { TUBE_STAGES, type TubeStageId } from '../../../src/render/tube/stages.js';
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/core/test/render/tube/stages.test.ts`
Expected: PASS if Task 2 was implemented as written. If `passes the whole contour through` fails,
`bypass` on the `cut` stage is missing or wrong.

- [ ] **Step 3: Pin the contract the assign stage rests on**

The `assign` stage calls `assign(state.runs, …)` and throws the return value away, which is only
correct because `assign` mutates in place. Append to
`packages/core/test/render/tube/assign.test.ts`:

```ts
it('mutates the run list it was handed rather than returning a new one', () => {
  const given = runs(4);
  const out = assign(given, { by: 'seed', amount: 1 }, COLORS, 3);
  expect(out).toBe(given);
});
```

`runs(n)` and `COLORS` are the file's own helpers at the top; `assign` and `Run` are already
imported. Add nothing to the imports.

- [ ] **Step 4: Run the whole check**

Run: `npm run check`
Expected: PASS at 1160 tests — 1149 after Task 2, plus three in Task 3, seven here, and one in `assign.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/test/render/tube/stages.test.ts packages/core/test/render/tube/assign.test.ts
git commit -m "gate the tube stages and pass the pipeline through the ones switched off"
```

---

## Task 5: Keep the registry off the published surface

The design's trap list is explicit: "`TUBE_STAGES` must not become public API surface — the
registry is internal, and the lab reaches it the way the corner lab already reaches
`@core/render/tube/*`."

**Files:**
- Test: `packages/core/test/render/tube/stages.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('the registry is internal', () => {
  it('is not reachable from the published entry', async () => {
    const published = await import('../../../src/index.js');
    expect(Object.keys(published)).not.toContain('TUBE_STAGES');
    expect(Object.keys(published)).not.toContain('buildTubeBlueprint');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/core/test/render/tube/stages.test.ts`
Expected: PASS — `src/index.ts` exports neither today. The test exists to keep it that way; if it
fails, something in Task 2 re-exported through the entry and must be reverted.

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/render/tube/stages.test.ts
git commit -m "guard the stage registry against reaching the published entry"
```

---

## Task 6: Prove no pixel moved

**Files:** none — this is the acceptance gate.

- [ ] **Step 1: Check the machine is not loaded**

Run: `uptime`
Expected: a 1-minute load average under about 8. Above that, `visual.spec.ts` fails three known
tests — `bloom path`, `two-line block`, and `wrap breaks a long line into rows` — for reasons that
predate this branch. Wait rather than reading those as a regression.

- [ ] **Step 2: Run the look snapshots**

Run: `npx playwright test looks.spec.ts`
Expected: 19 passed. `look-tubing` and `look-piping` are the two the design names; a byte difference
in either means the fold changed geometry and the task is not done.

- [ ] **Step 3: Run the rest of the visual suite**

Run: `npx playwright test`
Expected: green, or exactly the three known load-flaky failures above and nothing else.

- [ ] **Step 4: Run the unit suite one last time**

Run: `npm run check`
Expected: PASS at 1161 tests.

- [ ] **Step 5: Update the handoff**

In `docs/superpowers/HANDOFF.md`, find the paragraph under "What is worth doing next" beginning
"It is a **different lab** from **kliegsminister**". Replace that paragraph with:

```markdown
  It is a **different lab** from **kliegsminister**, the stage-and-repair lab in
  [the pipeline lab design](specs/2026-08-23-pipeline-lab-design.md) — that one is about tube
  geometry, this one about time.

  **kliegsminister is under way, in three slices.** The design's prerequisite shipped long ago:
  `markAuthored`'s `WeakSet` is gone and `Run.from` provenance replaced it, which is also how
  `corner-lab`'s `scene.ts` already finds its run. Slice 1 — `TUBE_STAGES`, `buildTubeBlueprint`
  folded over a named registry with `stages` and `onStage` — is on branch `kliegsminister`, look
  snapshots unmoved. Slice 2 is `CUT_REPAIRS`, and it is the hard one: `mergeArc` interleaves the
  bridge, relax and resume paths with the arc push, so the `applies`/`apply` seam the design asks
  for is not visible from the outside yet. Slice 3 is the lab itself.
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/HANDOFF.md
git commit -m "record that the tube stage registry landed"
```

---

## Acceptance

From the design, the lines this slice is responsible for:

- Every shipped look renders byte-identical — `looks.spec.ts`, 19 passed, `look-tubing` and
  `look-piping` in particular. **Task 6 Step 2.**
- With the new options absent, `buildTubeBlueprint` produces the same runs and geometry as before
  the refactor, asserted on run count, per-run point counts and tightest bend. **Task 1.**
- `npm run check` and `npx playwright test` stay green. **Task 6.**

The design's other acceptance lines — repair toggles, ghost geometry, `scene.ts` finding its run
through provenance — belong to slices 2 and 3 and are not gated here.
