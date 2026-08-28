# Cut repairs registry implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the corner stage's six repairs addressable — each one named, switchable, and able to
report where it *would* have fired when it is off — so the kliegsminister lab can ghost a repair
instead of showing a worse path with no explanation.

**Architecture:** Three registries, not one. `CORNER_REPAIRS` runs inside `mergeArc` twice per
corner, once per side, over `stretch`/`setback`/`resume`; `SPAN_REPAIRS` runs at the `stitchPath`
level over `close`/`return`/the break-path `stretch`; `hairpin` is a whole-corner alternative that
bypasses both. Each repair computes its **site** — where it would act and what it would draw —
before the toggle is consulted, and reports it either way, which is what makes ghosting possible.

The registries carry identity, label and order; they do not carry an `apply`. Two of the design's
five reasons are why: each id fires twice on opposite sides with incompatible bodies (`setback` is
`trimTail(target, …): void` entering and `indexPast(next, …): number` leaving), and two exit-side
branches `return` out of `mergeArc` mid-way. No single signature spans those, so the gate and the
site live at each call site and the registry is what the lab enumerates and orders.

**Tech Stack:** TypeScript, three.js, vitest, Playwright.

**Read first:** `docs/superpowers/specs/2026-08-23-pipeline-lab-design.md`, in particular "The two
registries" and "Traps". That section was rewritten against the call graph after an earlier draft
described this as a fold; the five reasons it is not are load-bearing for every task below.

---

## Why this is not a fold

An earlier draft of the design said `CUT_REPAIRS` was `repairs.reduce((span, r) => r.apply(span,
ctx), span)` living in `mergeArc`. Measuring it against the call graph killed that, and the reasons
are the constraints this plan is built around. Do not re-derive them from the function names —
they read as a fold and are not one.

- **The accumulator is not one span.** `mergeArc`'s state is the pair (`target`, `next` plus a
  cursor into it). `trimTail` acts on `target`; `indexPast` yields a `start` into `next` that three
  later branches read. `next` is never mutated, deliberately — the same array is the leg for the
  neighbouring corner's decision.
- **Each id fires twice, on opposite sides, with incompatible bodies.** `setback` is
  `trimTail(target, …): void` entering and `indexPast(next, …): number` leaving. `resume` is
  `target.length = keep + 1` entering and `push(next[from..])` leaving.
- **`fillet` is spliced into the middle of `resume`.** The real order is side-major, not id-major:
  entry `stretch` → entry `setback` → entry `resume` → `fillet` → exit `stretch`+`setback` → exit
  `resume`.
- **Two branches return out of the middle** — the exit-side `bridge` and `relax` both `return`
  from `mergeArc`. A reducer step cannot terminate the fold.
- **`apply` produces output that is not the span.** `decision.at` is written into the
  `CornerDecision` that `stitchPath` returns and `cutIntoRuns` turns into `CornerRecord`s.

And three of the six never enter `mergeArc` at all: `close` (`closeLoop`) and `return`
(`splitReturn`) are called only from `stitchPath` and are span-*list* operations, and `stretch` is
two unrelated implementations under one name — a bare `target.pop()` loop in `mergeArc` (which can
empty the span) and `dropHead`/`dropTail` in `stitchPath` (which floor at 2).

## File structure

- **Create `packages/core/src/render/tube/repairs.ts`** — the repair ids, the site and context
  types, and both registries. It is a sibling of `stages.ts` and follows its shape: `@internal`
  types, one exported `readonly` array per registry, no side effects at module scope.
- **Modify `packages/core/src/render/tube/runs.ts`** — `mergeArc` and `stitchPath` call the
  registries instead of inlining the repairs. `cutIntoRuns` grows `repairs` and `onRepair`.
- **Modify `packages/core/src/render/tube/stages.ts`** — the `cut` stage forwards the two new
  options. This is the widening slice 1 deliberately left undone.
- **Modify `packages/core/src/render/tube/index.ts`** — `TubeStageContext` carries the options the
  `cut` stage now needs.
- **Create `packages/core/test/render/tube/repairs.test.ts`** — the registry's own tests.
- **Modify `packages/core/test/render/tube/runs.test.ts`** — characterization tests pinning the
  corner stage before it moves.

## Two traps this plan is shaped around

**`repairs` must be its own typed set, never merged with `stages`.** Slice 1 learned this the hard
way: a caller passing only repair ids into one `ReadonlySet<string>` shared by both levels would
switch off all five stages and get an empty blueprint with nothing thrown. `TubeStageId` and
`CutRepairId` stay separate unions and separate sets.

**A repair reports a site, not a boolean.** A boolean cannot be ghosted. `bridgeBefore` and
`bridgeAfter` already return `{ points, at }` and `resumeAt` already returns an index, so the shape
is latent for `resume` — but as *three* candidate providers behind one id, chosen by `rejoin` with
fallback, and the report has to say which one answered.

## No CHANGELOG entry

Every new symbol is `@internal` and nothing on the public entry changes. There is nothing here for
someone deciding whether to upgrade.

---

## Task 1: Pin the corner stage before it moves

The refactor's whole claim is "behavior unchanged", so the assertions come first. **These are
characterization tests, not red-green.** Do not expect a failure in Step 2 — a failure there means
this plan is stale and the refactor must not start until that is understood.

**Files:**
- Modify: `packages/core/test/render/tube/runs.test.ts`

- [ ] **Step 1: Write the characterization test**

Add at the end of `packages/core/test/render/tube/runs.test.ts`:

```typescript
describe('the corner stage, pinned before the repair registry', () => {
  const GEOM = { runs: 1, minRun: 0, radius: 0.03, bend: 2, spacing: 0.02, seed: 0 };

  /** Every rejoin against every corner policy: the matrix the registry must not move. */
  for (const rejoin of REJOINS) {
    for (const [name, corners] of [
      ['connect', ALL_CONNECT],
      ['break', ALL_BREAK],
    ] as const) {
      it(`holds ${name} corners under rejoin '${rejoin}'`, () => {
        const square = cutIntoRuns([PATH(squarePath())], { ...GEOM, corners, rejoin });
        const open = cutIntoRuns([PATH(openLPath())], { ...GEOM, corners, rejoin });
        expect({
          squareRuns: square.runs.length,
          squarePoints: square.runs.map((r) => r.points.length),
          squareNulls: square.runs.map((r) => r.from.filter((f) => f === null).length),
          squareStrategies: square.corners.map((c) => c.strategy),
          openRuns: open.runs.length,
          openPoints: open.runs.map((r) => r.points.length),
        }).toMatchInlineSnapshot();
      });
    }
  }

  it('holds a return corner, which is the only path through splitReturn', () => {
    const { runs, corners } = cutIntoRuns([PATH(squarePath())], {
      ...GEOM,
      corners: ALL_BREAK,
      blockout: 1,
    });
    expect(corners.map((c) => c.strategy)).toContain('return');
    expect(runs.map((r) => r.points.length)).toMatchInlineSnapshot();
    expect(runs.filter((r) => r.dark).length).toBeGreaterThan(0);
  });

  it('holds a hairpin corner, which bypasses both registries', () => {
    const { runs, corners } = cutIntoRuns([PATH(squarePath())], {
      ...GEOM,
      corners: { break: 0, connect: 0, hairpin: 1 },
    });
    expect(corners.map((c) => c.strategy)).toMatchInlineSnapshot();
    expect(runs.map((r) => r.points.length)).toMatchInlineSnapshot();
  });
});
```

`PATH`, `squarePath`, `openLPath`, `REJOINS`, `ALL_BREAK` and `ALL_CONNECT` are already imported or
defined in that file; add nothing to the import list except what the typechecker asks for.

**Inline, not a `.snap` file.** The values land in the test file itself, so a reviewer reads them in
the diff and a careless `-u` shows up as a source change rather than a silently rewritten baseline.
That failure mode is not hypothetical here — it is what left `effect-roving` byte-identical to
`look-tubing` and still green earlier on this branch.

- [ ] **Step 2: Fill the snapshots in, then read them**

Run: `npx vitest run packages/core/test/render/tube/runs.test.ts -t "pinned before the repair" -u`
Expected: PASS, with vitest writing the measured values into the `toMatchInlineSnapshot()` calls.

Now read what it wrote. Every `squarePoints` array should have at least two entries and no zeros,
and `squareStrategies` under `ALL_CONNECT` should be four `connect` or `return`, never four
`break` — four breaks means the fillets never fit and the matrix is pinning the degenerate case
rather than the corner stage. If that is what you see, stop: the geometry constants in `GEOM` are
wrong for this path and every later task would be measured against nothing.

- [ ] **Step 3: Re-run without `-u` and confirm it is stable**

Run: `npx vitest run packages/core/test/render/tube/runs.test.ts -t "pinned before the repair"`
Expected: PASS. A failure on the second run means something in the cut is not deterministic, which
has to be understood before the refactor starts.

- [ ] **Step 4: Commit**

```bash
git add packages/core/test/render/tube/runs.test.ts
git commit -m "pin the corner stage before naming its repairs"
```

---

## Task 2: Name the repairs and widen the options

No behavior yet — the ids, the sets, and the plumbing that carries them from `buildTubeBlueprint`
down to `mergeArc`. Everything is unused at the end of this task and the pinned snapshots are
untouched, which is the point: the plumbing lands separately from the geometry.

**Files:**
- Create: `packages/core/src/render/tube/repairs.ts`
- Modify: `packages/core/src/render/tube/runs.ts`
- Test: `packages/core/test/render/tube/repairs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/render/tube/repairs.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { CORNER_REPAIRS, CUT_REPAIR_IDS, SPAN_REPAIRS } from '../../../src/render/tube/repairs.js';

describe('the repair registries', () => {
  it('names every repair the design does, and nothing else', () => {
    expect([...CUT_REPAIR_IDS]).toEqual([
      'stretch',
      'setback',
      'resume',
      'fillet',
      'close',
      'return',
      'hairpin',
    ]);
  });

  it('splits the two registries by where they run, with stretch in both', () => {
    expect(CORNER_REPAIRS.map((r) => r.id)).toEqual(['stretch', 'setback', 'resume']);
    expect(SPAN_REPAIRS.map((r) => r.id)).toEqual(['stretch', 'close', 'return']);
  });

  it('gives every repair a label, since the lab shows it to a person', () => {
    for (const r of [...CORNER_REPAIRS, ...SPAN_REPAIRS]) {
      expect(r.label.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/tube/repairs.test.ts`
Expected: FAIL — `Cannot find module '../../../src/render/tube/repairs.js'`.

- [ ] **Step 3: Write the minimal registry**

Create `packages/core/src/render/tube/repairs.ts`:

```typescript
import type * as THREE from 'three';

/**
 * What the corner stage does to make a fillet meet its legs. `stretch` appears in both registries:
 * the name covers two unrelated implementations with different floors, and splitting them is what
 * makes each one switchable on its own.
 * @internal
 */
export type CutRepairId =
  | 'stretch'
  | 'setback'
  | 'resume'
  | 'fillet'
  | 'close'
  | 'return'
  | 'hairpin';

/** @internal */
export const CUT_REPAIR_IDS: readonly CutRepairId[] = [
  'stretch',
  'setback',
  'resume',
  'fillet',
  'close',
  'return',
  'hairpin',
];

/** Which end of the corner a pass is working, since every inner repair fires on both. @internal */
export type RepairSide = 'entry' | 'exit';

/**
 * Where a repair would act and what it would draw there. Returned by `applies` whether or not the
 * repair is switched on: a boolean cannot be ghosted, and showing a worse path without showing
 * what was skipped leaves the reader to infer the difference.
 * @internal
 */
export interface RepairSite {
  /** Index into the leg the repair acts on. */
  at: number;
  /** The geometry it would put there, empty where the repair only removes vertices. */
  points: readonly THREE.Vector3[];
}

/**
 * Identity, label and order — no `apply`. Each id fires twice per corner with incompatible bodies
 * (`setback` trims a span entering and yields an index leaving), so no one signature spans them;
 * the gate and the site live at each call site and this is what the lab enumerates.
 * @internal
 */
export interface CornerRepair {
  id: CutRepairId;
  label: string;
}

/** As `CornerRepair`, at the level where the accumulator is a span list. @internal */
export interface SpanRepair {
  id: CutRepairId;
  label: string;
}

/**
 * Runs inside `mergeArc`, twice per corner — once per side, with the `fillet` splice fixed between
 * the two passes. Order is the order the sides are worked, not the order of the ids.
 * @internal
 */
export const CORNER_REPAIRS: readonly CornerRepair[] = [
  { id: 'stretch', label: 'stretch' },
  { id: 'setback', label: 'setback' },
  { id: 'resume', label: 'resume' },
];

/**
 * Runs at the `stitchPath` level, where the accumulator is a list of spans rather than one span:
 * `return` turns one span into three and `close` acts on two at once, so neither fits the inner
 * pass. `stretch` here is the break path's `dropHead`/`dropTail`, which floors at 2 — the inner
 * `stretch` is a `pop()` loop that can empty the span.
 * @internal
 */
export const SPAN_REPAIRS: readonly SpanRepair[] = [
  { id: 'stretch', label: 'stretch (break)' },
  { id: 'close', label: 'close the loop' },
  { id: 'return', label: 'return' },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/render/tube/repairs.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/tube/repairs.ts packages/core/test/render/tube/repairs.test.ts
git commit -m "name the cut repairs and split them by where they run"
```

---

## Task 3: Carry the toggles into cutIntoRuns

**Files:**
- Modify: `packages/core/src/render/tube/runs.ts:99-133` (the `CutOptions` interface)
- Test: `packages/core/test/render/tube/runs.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/test/render/tube/runs.test.ts`, inside the pinned describe from Task 1:

```typescript
it('reports every repair it considered, switched on or off', () => {
  const seen: { id: string; ran: boolean }[] = [];
  cutIntoRuns([PATH(squarePath())], {
    runs: 1,
    minRun: 0,
    radius: 0.03,
    bend: 2,
    spacing: 0.02,
    seed: 0,
    corners: ALL_CONNECT,
    onRepair: (id, _site, ran) => seen.push({ id, ran }),
  });
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((s) => s.ran)).toBe(true);
  expect(new Set(seen.map((s) => s.id))).toContain('setback');
});

it('treats an absent repair set as every repair on', () => {
  const all = cutIntoRuns([PATH(squarePath())], {
    runs: 1,
    minRun: 0,
    radius: 0.03,
    bend: 2,
    spacing: 0.02,
    seed: 0,
    corners: ALL_CONNECT,
    repairs: new Set(CUT_REPAIR_IDS),
  });
  const absent = cutIntoRuns([PATH(squarePath())], {
    runs: 1,
    minRun: 0,
    radius: 0.03,
    bend: 2,
    spacing: 0.02,
    seed: 0,
    corners: ALL_CONNECT,
  });
  expect(all.runs.map((r) => r.points.length)).toEqual(absent.runs.map((r) => r.points.length));
});
```

Add `import { CUT_REPAIR_IDS } from '../../../src/render/tube/repairs.js';` to the file's imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/tube/runs.test.ts -t "reports every repair"`
Expected: FAIL — `onRepair` is not a property of `CutOptions`, so tsc rejects it and `seen` stays
empty.

- [ ] **Step 3: Widen `CutOptions`**

In `packages/core/src/render/tube/runs.ts`, add to the `CutOptions` interface, after `blockout`:

```typescript
  /**
   * Which repairs run. Absent is every repair on, which is what every shipped caller passes. Typed
   * as its own union rather than sharing one set with `TubeStageId`: a caller passing only repair
   * ids into a shared set would switch off all five stages and get an empty blueprint.
   */
  repairs?: ReadonlySet<CutRepairId>;
  /** Fires for every repair considered, switched off ones included, so a lab can ghost them. */
  onRepair?(id: CutRepairId, site: RepairSite | null, ran: boolean): void;
```

Add to the imports at the top of the file:

```typescript
import type { CutRepairId, RepairSite } from './repairs.js';
```

Then, inside `cutIntoRuns`, after the `seed` line, add the two helpers every later task uses:

```typescript
  const enabled = opts.repairs;
  const on = (id: CutRepairId) => !enabled || enabled.has(id);
  const report = (id: CutRepairId, site: RepairSite | null, ran: boolean) =>
    opts.onRepair?.(id, site, ran);
```

- [ ] **Step 4: Thread both into `stitchPath` and `mergeArc`**

`stitchPath` and `mergeArc` already take `rejoin`, `spacing` and `inherit` as plain parameters;
add two more in the same style rather than introducing an options object. In `runs.ts`, change
`stitchPath`'s signature to end:

```typescript
  drawAt: (corner: number, draw: Draw) => number,
  inherit: Inherit,
  on: (id: CutRepairId) => boolean,
  report: (id: CutRepairId, site: RepairSite | null, ran: boolean) => void,
): { spans: Span[]; decisions: CornerDecision[] } {
```

and `mergeArc`'s to end:

```typescript
  rejoin: Rejoin,
  inherit: Inherit,
  on: (id: CutRepairId) => boolean,
  report: (id: CutRepairId, site: RepairSite | null, ran: boolean) => void,
): void {
```

Pass `on` and `report` at the one `stitchPath` call site and all three `mergeArc` call sites.
Nothing reads them yet.

- [ ] **Step 5: Make the first repair report itself**

In `mergeArc`, replace the `trimTail` line:

```typescript
  trimTail(target, fillet.setback, fillet.corner);
```

with:

```typescript
  const setbackSite: RepairSite = { at: target.length - 1, points: [] };
  if (on('setback')) trimTail(target, fillet.setback, fillet.corner);
  report('setback', setbackSite, on('setback'));
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run packages/core/test/render/tube/runs.test.ts`
Expected: PASS, including Task 1's inline snapshots unchanged. A snapshot diff here means the toggle
plumbing changed geometry, which it must not.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/render/tube/runs.ts packages/core/test/render/tube/runs.test.ts
git commit -m "carry repair toggles and a repair report into the cut"
```

---

## Task 4: Split `stretch` into its two implementations

`stretch` is the one id covering two functions with different floors. Splitting it is a
prerequisite for switching either off, because the two cannot share an `applies`.

**Files:**
- Modify: `packages/core/src/render/tube/runs.ts:481-493` (`dropHead`, `dropTail`) and the
  `target.pop()` loop in `mergeArc`
- Test: `packages/core/test/render/tube/repairs.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/test/render/tube/repairs.test.ts`:

```typescript
import * as THREE from 'three';
import { popStretch, trimStretch } from '../../../src/render/tube/repairs.js';

describe('the two stretches', () => {
  const line = () =>
    Array.from({ length: 5 }, (_, i) => new THREE.Vector3(i / 10, 0, 0));

  it('lets the corner-side stretch empty a span', () => {
    const span = line();
    popStretch(span, 99);
    expect(span).toHaveLength(0);
  });

  it('floors the break-side stretch at two vertices', () => {
    expect(trimStretch(line(), 99, 'tail')).toHaveLength(2);
    expect(trimStretch(line(), 99, 'head')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/tube/repairs.test.ts -t "two stretches"`
Expected: FAIL — `popStretch` and `trimStretch` are not exported from `repairs.ts`.

- [ ] **Step 3: Move both implementations into `repairs.ts`**

Add to `packages/core/src/render/tube/repairs.ts`:

```typescript
/**
 * The corner side's stretch: drops the corner's whole group before the setback trims by distance.
 * No floor — it can empty the span, and `mergeArc`'s later `target.length` writes depend on that.
 * @internal
 */
export function popStretch(span: THREE.Vector3[], count: number): void {
  for (let i = 0; i <= count && span.length > 0; i++) span.pop();
}

/**
 * The break side's stretch. Floors at two vertices, because a break's product is a span that still
 * has to sweep — unlike the corner side, where an emptied `target` is refilled by the arc.
 * @internal
 */
export function trimStretch(
  span: THREE.Vector3[],
  count: number,
  end: 'head' | 'tail',
): THREE.Vector3[] {
  const keep = Math.max(2, span.length - count);
  return end === 'tail' ? span.slice(0, keep) : span.slice(span.length - keep);
}
```

- [ ] **Step 4: Point `runs.ts` at them**

In `runs.ts`, replace the bodies of `dropHead` and `dropTail` with calls to `trimStretch`, and
replace the `mergeArc` pop loop:

```typescript
  for (let i = 0; i <= decision.groupBefore && target.length > 0; i++) target.pop();
```

with:

```typescript
  const stretchSite: RepairSite = { at: target.length - 1, points: [] };
  if (on('stretch')) popStretch(target, decision.groupBefore);
  report('stretch', stretchSite, on('stretch'));
```

Import `popStretch` and `trimStretch` from `./repairs.js`.

- [ ] **Step 5: Run the whole tube suite**

Run: `npx vitest run packages/core/test/render/tube/`
Expected: PASS, Task 1's inline snapshots unchanged. `trimStretch` must reproduce `dropHead`/`dropTail`
exactly — if a snapshot moves, the floor or the slice bound is off by one.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/render/tube/repairs.ts packages/core/src/render/tube/runs.ts packages/core/test/render/tube/repairs.test.ts
git commit -m "split stretch into the pop loop and the floored trim"
```

---

## Task 5: Give `setback` and `resume` a side-major inner pass

This is the task the design's five reasons are about. The two sides run as two passes over the same
registry with a shared context, and the `fillet` splice sits between them.

**Files:**
- Modify: `packages/core/src/render/tube/runs.ts:775-865` (`mergeArc`)
- Modify: `packages/core/src/render/tube/repairs.ts`
- Test: `packages/core/test/render/tube/repairs.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/test/render/tube/repairs.test.ts`:

```typescript
import { cutIntoRuns, ALL_CONNECT } from '../../../src/render/tube/runs.js';

describe('the inner pass', () => {
  const square = () => {
    const corners = [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ];
    const pts: THREE.Vector3[] = [];
    for (let c = 0; c < 4; c++) {
      const [ax, ay] = corners[c] as number[];
      const [bx, by] = corners[(c + 1) % 4] as number[];
      for (let i = 0; i < 50; i++) {
        const t = i / 50;
        pts.push(
          new THREE.Vector3(
            (ax as number) + ((bx as number) - (ax as number)) * t,
            (ay as number) + ((by as number) - (ay as number)) * t,
            0,
          ),
        );
      }
    }
    return pts;
  };
  const OPTS = {
    runs: 1,
    minRun: 0,
    radius: 0.03,
    bend: 2,
    spacing: 0.02,
    seed: 0,
    corners: ALL_CONNECT,
  };

  it('fires each inner repair twice per corner, once per side', () => {
    const sides: string[] = [];
    cutIntoRuns([{ points: square(), surface: 'front' as const, closed: true }], {
      ...OPTS,
      onRepair: (id, site) => {
        if (id === 'setback' && site) sides.push(`${site.at}`);
      },
    });
    // Four corners, entry and exit apiece.
    expect(sides).toHaveLength(8);
  });

  it('reports a site for a repair it did not run', () => {
    const off: { id: string; hadSite: boolean }[] = [];
    cutIntoRuns([{ points: square(), surface: 'front' as const, closed: true }], {
      ...OPTS,
      repairs: new Set(['stretch', 'resume', 'fillet', 'close', 'return', 'hairpin'] as const),
      onRepair: (id, site, ran) => {
        if (!ran) off.push({ id, hadSite: site !== null });
      },
    });
    expect(off.length).toBeGreaterThan(0);
    expect(off.every((o) => o.id === 'setback')).toBe(true);
    expect(off.every((o) => o.hadSite)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/tube/repairs.test.ts -t "inner pass"`
Expected: FAIL on the first test — `setback` currently reports once per corner, not twice, so
`sides` has 4 entries rather than 8.

- [ ] **Step 3: Add the exit-side setback to the registry pass**

In `mergeArc`, the exit side's setback is the `indexPast` call. Replace:

```typescript
  const start = indexPast(next, decision.groupAfter + 1, fillet.setback, fillet.corner);
```

with:

```typescript
  const exitSetback = indexPast(next, decision.groupAfter + 1, fillet.setback, fillet.corner);
  report('setback', { at: exitSetback, points: [] }, on('setback'));
  const start = on('setback') ? exitSetback : decision.groupAfter + 1;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/render/tube/repairs.test.ts -t "inner pass"`
Expected: PASS, both tests.

- [ ] **Step 5: Run the whole tube suite**

Run: `npx vitest run packages/core/test/render/tube/`
Expected: PASS with Task 1's inline snapshots unchanged — with `setback` on, `start` is still
`indexPast`'s answer, so nothing moves.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/render/tube/runs.ts packages/core/test/render/tube/repairs.test.ts
git commit -m "run setback on both sides of the corner through the registry"
```

---

## Task 6: Make `resume` report which of its three providers fired

`resume` is one id with three candidate providers — `bridge`, then `relax`, then the `resumeAt`
walk — chosen by `rejoin` with fallback. The lab needs to know which one answered, not just that
the corner resumed.

**Files:**
- Modify: `packages/core/src/render/tube/runs.ts:795-855` (both sides of `mergeArc`)
- Test: `packages/core/test/render/tube/repairs.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/test/render/tube/repairs.test.ts`, inside the `inner pass` describe:

```typescript
it('reports the resume provider that actually answered', () => {
  const points: number[] = [];
  cutIntoRuns([{ points: square(), surface: 'front' as const, closed: true }], {
    ...OPTS,
    rejoin: 'bridge',
    onRepair: (id, site) => {
      if (id === 'resume' && site) points.push(site.points.length);
    },
  });
  // A bridge answers with a blend; the plain walk answers with an index and no geometry.
  expect(points.some((n) => n > 0)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/tube/repairs.test.ts -t "resume provider"`
Expected: FAIL — nothing reports `resume` yet, so `points` is empty.

- [ ] **Step 3: Report the entry-side resume**

In `mergeArc`, wrap the entry-side block. Replace:

```typescript
  if (!bridgedIn) {
    let relaxed: THREE.Vector3[] | null = null;
    if (rejoin === 'relax') {
```

with:

```typescript
  if (bridgedIn) report('resume', { at: target.length - 1, points: bridgedIn }, on('resume'));
  if (!bridgedIn) {
    let relaxed: THREE.Vector3[] | null = null;
    if (rejoin === 'relax') {
```

and after the `resumeAt` fallback inside that block, replace:

```typescript
    if (!relaxed) {
      const keep = resumeAt(target, target.length - 1, -1, entry, second, into, rhoMin, spacing);
      target.length = keep + 1;
    }
```

with:

```typescript
    if (relaxed) {
      report('resume', { at: target.length - 1, points: relaxed }, on('resume'));
    } else {
      const keep = resumeAt(target, target.length - 1, -1, entry, second, into, rhoMin, spacing);
      report('resume', { at: keep, points: [] }, on('resume'));
      if (on('resume')) target.length = keep + 1;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/render/tube/repairs.test.ts -t "resume provider"`
Expected: PASS.

- [ ] **Step 5: Run the whole tube suite**

Run: `npx vitest run packages/core/test/render/tube/`
Expected: PASS, Task 1's inline snapshots unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/render/tube/runs.ts packages/core/test/render/tube/repairs.test.ts
git commit -m "report which resume provider answered a corner"
```

---

## Task 7: Put `close` and `return` behind the span registry

These two never enter `mergeArc`. `return` turns one span into three and `close` acts on two at
once, so they gate at the `stitchPath` level.

**Files:**
- Modify: `packages/core/src/render/tube/runs.ts:975-1065` (the three `splitReturn` sites and the
  one `closeLoop` site)
- Test: `packages/core/test/render/tube/repairs.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/test/render/tube/repairs.test.ts`:

```typescript
describe('the span registry', () => {
  const OPTS = {
    runs: 1,
    minRun: 0,
    radius: 0.03,
    bend: 2,
    spacing: 0.02,
    seed: 0,
  };

  it('leaves a return span whole when return is switched off', () => {
    const path = { points: square(), surface: 'front' as const, closed: true };
    const on = cutIntoRuns([path], { ...OPTS, corners: ALL_BREAK, blockout: 1 });
    const off = cutIntoRuns([{ ...path, points: square() }], {
      ...OPTS,
      corners: ALL_BREAK,
      blockout: 1,
      repairs: new Set(['stretch', 'setback', 'resume', 'fillet', 'close', 'hairpin'] as const),
    });
    expect(on.runs.filter((r) => r.dark).length).toBeGreaterThan(0);
    expect(off.runs.filter((r) => r.dark)).toHaveLength(0);
  });
});
```

Import `ALL_BREAK` alongside `ALL_CONNECT`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/tube/repairs.test.ts -t "span registry"`
Expected: FAIL — `return` is not gated, so the dark span appears in both.

- [ ] **Step 3: Gate `return` at all three call sites**

`splitReturn` is called from three places in `stitchPath` — the open branch, the no-break closed
walk, and the rotated closed branch. Each has the identical shape; gate each one the same way.
Replace every occurrence of:

```typescript
        if (decision.strategy === 'return' && decision.fillet) {
```

with:

```typescript
        if (decision.strategy === 'return' && decision.fillet && on('return')) {
```

and add, immediately before each of those three `if` statements:

```typescript
        if (decision.strategy === 'return' && decision.fillet) {
          report('return', { at: current.length - 1, points: decision.fillet.points }, on('return'));
        }
```

In the no-break closed branch the accumulator is named `current` inside `walk`, so the same two
lines go inside `walk`.

- [ ] **Step 4: Gate `close`**

Replace:

```typescript
    closeLoop(current, head, spacing);
```

with:

```typescript
    report('close', { at: current.length - 1, points: head.slice(0, 1) }, on('close'));
    if (on('close')) closeLoop(current, head, spacing);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/core/test/render/tube/repairs.test.ts -t "span registry"`
Expected: PASS.

- [ ] **Step 6: Run the whole tube suite**

Run: `npx vitest run packages/core/test/render/tube/`
Expected: PASS, Task 1's inline snapshots unchanged.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/render/tube/runs.ts packages/core/test/render/tube/repairs.test.ts
git commit -m "gate close and return at the span level"
```

---

## Task 8: Gate `fillet` and `hairpin`, the two whole-corner decisions

`fillet` straddles both scopes — decided in `stitchPath`, applied in `mergeArc` — and `hairpin`
bypasses both registries entirely. Both are gated where the decision is made, not where it lands.

**Files:**
- Modify: `packages/core/src/render/tube/runs.ts:909-938` (the decision map)
- Test: `packages/core/test/render/tube/repairs.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/test/render/tube/repairs.test.ts`:

```typescript
describe('the whole-corner decisions', () => {
  const OPTS = { runs: 1, minRun: 0, radius: 0.03, bend: 2, spacing: 0.02, seed: 0 };

  it('breaks every hard corner when fillet is switched off', () => {
    const { corners } = cutIntoRuns(
      [{ points: square(), surface: 'front' as const, closed: true }],
      {
        ...OPTS,
        corners: ALL_CONNECT,
        repairs: new Set(['stretch', 'setback', 'resume', 'close', 'return', 'hairpin'] as const),
      },
    );
    expect(corners.every((c) => c.strategy === 'break')).toBe(true);
  });

  it('breaks a hairpin corner when hairpin is switched off', () => {
    const { corners } = cutIntoRuns(
      [{ points: square(), surface: 'front' as const, closed: true }],
      {
        ...OPTS,
        corners: { break: 0, connect: 0, hairpin: 1 },
        repairs: new Set(['stretch', 'setback', 'resume', 'fillet', 'close', 'return'] as const),
      },
    );
    expect(corners.some((c) => c.strategy === 'hairpin')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/tube/repairs.test.ts -t "whole-corner"`
Expected: FAIL on both — neither id is consulted, so the corners still fillet and hairpin.

- [ ] **Step 3: Gate both in the decision map**

In `stitchPath`'s `decisions` map, replace:

```typescript
    let hairpin: Hairpin | null = null;
    if (strategy === 'hairpin') {
```

with:

```typescript
    let hairpin: Hairpin | null = null;
    if (strategy === 'hairpin' && !on('hairpin')) strategy = 'break';
    if (strategy === 'hairpin') {
```

and replace:

```typescript
    let fillet =
      strategy === 'connect' && c.hard
        ? filletFor(before, after, c, rhoMin, spacing, rejoin)
        : null;
```

with:

```typescript
    const wantsFillet = strategy === 'connect' && c.hard;
    const filletSite = wantsFillet ? filletFor(before, after, c, rhoMin, spacing, rejoin) : null;
    if (wantsFillet) {
      report(
        'fillet',
        filletSite ? { at: c.index, points: filletSite.points } : null,
        on('fillet'),
      );
    }
    let fillet = on('fillet') ? filletSite : null;
```

The `blockout` branch below uses `filletFor` a second time; gate it the same way by wrapping its
assignment in `if (on('fillet'))`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/render/tube/repairs.test.ts -t "whole-corner"`
Expected: PASS, both tests.

- [ ] **Step 5: Run the whole tube suite**

Run: `npx vitest run packages/core/test/render/tube/`
Expected: PASS, Task 1's inline snapshots unchanged. This is the task most likely to move a snapshot: `filletFor`
must still be called exactly as often as before, because it does not draw from the seed stream but
`pickStrategy` does, and a changed call order changes nothing only if the draws are untouched.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/render/tube/runs.ts packages/core/test/render/tube/repairs.test.ts
git commit -m "gate the fillet and hairpin decisions where they are made"
```

---

## Task 9: Forward the toggles from the stage registry

The widening slice 1 left undone. `TubeStageContext` carries no build options, so the `cut` stage
cannot pass repair toggles down.

**Files:**
- Modify: `packages/core/src/render/tube/stages.ts:17-24` (`TubeStageContext`) and the `cut` stage
- Modify: `packages/core/src/render/tube/index.ts:115-135` (`buildTubeBlueprint`)
- Test: `packages/core/test/render/tube/stages.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/test/render/tube/stages.test.ts`:

```typescript
it('forwards repair toggles from the blueprint down to the cut', () => {
  const seen: string[] = [];
  const bp = buildTubeBlueprint([square()], SPEC, 0.3, 0, {
    onRepair: (id) => seen.push(id),
  });
  expect(seen.length).toBeGreaterThan(0);
  bp.dispose();
});
```

`square()` and `SPEC` are already defined in that file, and `0.3` / `0` are the depth and seed its
other tests use. Note `bp.dispose()` — every test in that file disposes, and a leaked blueprint
holds GL buffers.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/render/tube/stages.test.ts -t "forwards repair toggles"`
Expected: FAIL — `buildTubeBlueprint` takes no such parameter.

- [ ] **Step 3: Widen the context**

In `stages.ts`, add to `TubeStageContext`:

```typescript
  readonly repairs?: ReadonlySet<CutRepairId>;
  readonly onRepair?: (id: CutRepairId, site: RepairSite | null, ran: boolean) => void;
```

and in the `cut` stage's `run`, destructure and forward them:

```typescript
    run(state, { spec, seed, repairs, onRepair }) {
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
        repairs,
        onRepair,
        seed,
      });
```

Import the two types from `./repairs.js`. In `index.ts`, accept them on `buildTubeBlueprint`'s
existing options parameter — the one that already carries `stages` and `onStage` — and put them on
the context it constructs.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/render/tube/stages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/render/tube/stages.ts packages/core/src/render/tube/index.ts packages/core/test/render/tube/stages.test.ts
git commit -m "forward repair toggles from the blueprint to the cut stage"
```

---

## Task 10: Prove no pixel moved

**Files:** none — this is the acceptance gate.

- [ ] **Step 1: Check the machine is not loaded**

Run: `uptime`
Expected: a 1-minute load average under about 8. Above that, `visual.spec.ts` fails three known
tests — `bloom path`, `two-line block`, and `wrap breaks a long line into rows` — for reasons that
predate this branch. Wait rather than reading those as a regression.

- [ ] **Step 2: Run the look snapshots**

Run: `npx playwright test looks.spec.ts`
Expected: 19 passed. `look-tubing` and `look-piping` are the two that carry corner geometry; a
difference in either means a repair changed behavior with every toggle on, and the task is not done.

- [ ] **Step 3: Run the rest of the visual suite**

Run: `npx playwright test`
Expected: 33 passed, or exactly the three known load-flaky failures above and nothing else.

- [ ] **Step 4: Run the unit suite**

Run: `npm run check`
Expected: PASS. The count is 1203 plus whatever this plan's tasks added.

- [ ] **Step 5: Verify by mutation, not by a green run**

A registry that never switches anything off would pass every test above. Prove the toggles bite:

```bash
npx vitest run packages/core/test/render/tube/repairs.test.ts
```

then temporarily make `on()` return `true` unconditionally in `cutIntoRuns` and re-run. Expected:
the `switched off` tests in Tasks 5, 7 and 8 redden. Restore `on()` afterwards. A green suite with
that mutation in place means the toggles are decorative — the same failure the effect snapshots had
before `EFFECT_RATIO`.

- [ ] **Step 6: Update the handoff**

In `docs/superpowers/HANDOFF.md`, find the paragraph beginning "**kliegsminister is under way**" and
replace the sentence naming slice 2 as unstarted with:

```markdown
  **Slice 2 is done.** `CUT_REPAIRS` landed as three registries in `render/tube/repairs.ts` —
  `CORNER_REPAIRS` run twice per corner inside `mergeArc`, `SPAN_REPAIRS` at the `stitchPath`
  level, and `fillet` and `hairpin` gated where the decision is made. `cutIntoRuns` takes
  `repairs` and `onRepair`; `buildTubeBlueprint` forwards both. Slice 3 is the lab.
```

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/HANDOFF.md
git commit -m "record that the cut repair registry landed"
```

---

## Acceptance

From the design, the lines this slice is responsible for:

- Six repairs named and individually switchable, plus `hairpin` as a seventh. **Tasks 2, 4–8.**
- Every repair reports a site rather than a boolean, for switched-off repairs too, so a lab can
  ghost them. **Tasks 3, 5, 6.**
- `repairs` is its own typed set beside `stages`, never one shared `ReadonlySet<string>`.
  **Task 3.**
- `stretch`'s two implementations are separable, with their different floors preserved. **Task 4.**
- `close` and `return` gate at the span level, where the accumulator is a span list. **Task 7.**
- Every shipped look renders byte-identical with all repairs on. **Task 10.**

The design's remaining acceptance lines — the `junction` instrument drawing the ghosts, the
`dev/corner-lab` → `dev/kliegsminister` rename — belong to slice 3 and are not gated here.

## Left for slice 3

**The `@core/*` alias.** `dev/tube-lab/src/render/skeleton.ts` still reaches core through
`../../../../src/render/tube/...` while `dev/corner-lab/src/scene.ts` uses the alias. Slice 3 adds
`repairs.js` imports to that same deep path; fix the alias before it multiplies.

**The type-only cycle.** `stages.ts` imports `TubeSpec` from `index.ts` as a type, which is erased.
`repairs.ts` deliberately imports nothing from `index.ts` to avoid widening that edge. The day
either needs a *value* from `index.ts` it becomes a real cycle, and because both registries are
module-level array initializers it would fail at import time rather than at first call.
