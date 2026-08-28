# Kliegsminister lab implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** slice 3 of the pipeline lab — make every tube repair report honestly, then build
`dev/kliegsminister` on those reports, so a person can switch a pipeline stage or a corner repair
off and see what it would have drawn.

**Architecture:** two halves that must land in order. Part A (Tasks 1–7) fixes `onRepair` in
`packages/core/src/render/tube/`: six repairs currently report nothing, report without a side, or
report an anchor index where the lab needs the geometry. Part B (Tasks 8–14) renames
`dev/corner-lab` to `dev/kliegsminister`, deletes the geometry the lab hand-rolls, and adds four
knobs — `stages`, `draw at`, seven repair toggles, and `subject` — driven off the registries rather
than off hardcoded lists, so `@weasel-js/diagram` can render the same structure as a flowchart when
it ships.

**Tech stack:** TypeScript, three.js, vitest, Playwright, React 19, Vite, `@weasel-js/labkit`.

**Read first:** [the design](../specs/2026-08-23-pipeline-lab-design.md), in particular "Every
repair has to report before the lab can draw it", "What the lab becomes", "Built to become a
flowchart" and "Traps".

Three of that Traps section's five do **not** apply here. `closeLoop` shifting another span's live
array, being handed the same array twice, and `slice` sharing boundary points are all hazards of
making the repairs *pure* — returning fresh spans. Slice 2 gated them in place instead, so nothing
in this plan re-enters that territory. The two that do apply are a switched-off repair drawing
self-intersecting geometry (Task 13) and the sweep's GPU resources needing a `dispose()` on every
rebuild (Tasks 7, 11).

---

## Baseline

`main` at `57f9023` is green: `npx vitest run` gives **64 files, 1274 tests**. Record any number
this plan tells you to pin against that baseline, not against a remembered one.

Measured on the `square()` fixture from `packages/core/test/render/tube/repairs.test.ts` at
`ALL_CONNECT`, total run points:

| rejoin | all repairs (absent) | all repairs (explicit set) | setback off | resume off |
|---|---|---|---|---|
| `drop`   | 209 | 209 | 209  | 217 |
| `bridge` | 241 | 241 | 2769 | 241 |
| `relax`  | 225 | 225 | 241  | 225 |
| `widen`  | 209 | 209 | 209  | 217 |

Two things to read off it. **Absent and fully-populated agree under every rejoin** — that is the
invariant Task 7 pins. And **the setback-off-under-`bridge` cascade is 2769 points, not the 1505 the
handoff records**; 2769 is what the shipped code produces today and supersedes it. The cascade stays
unfixed in this slice by design.

Reports on that same fixture at `rejoin: 'drop'`: `fillet` 4, `stretch` 4, `setback` 8, `resume` 4,
`close` 1 — and no `return` or `hairpin` at all. A square never hairpins, and with `blockout` unset
nothing returns. `setback` at 8 is the only id reporting on both sides; `resume` at 4 is the exit-side
gap Task 3 closes.

---

## File structure

**Part A — core.** All changes are `@internal`; none reaches the published surface.

- `packages/core/src/render/tube/repairs.ts` — `RepairSite` widens; registry entries gain their
  attachment point. Owns *what a repair is and where it hangs*.
- `packages/core/src/render/tube/runs.ts` — the call sites that gate and report. Owns *when a repair
  fires*. Already 51KB; this plan adds to it rather than splitting it, because every edit is inside
  `mergeArc` or `stitchPath` and moving either out is a slice of its own.
- `packages/core/test/render/tube/repairs.test.ts` — extends the existing suite; its `sharpV`,
  `square` and `openL` fixtures are reused, not re-cut.
- `packages/core/test/render/tube/reports.test.ts` — **new**. The alphabet-wide guard, kept apart
  from `repairs.test.ts` because it loads a font and is an order of magnitude slower.

**Part B — the lab.** `packages/core/dev/corner-lab/` becomes `packages/core/dev/kliegsminister/`.

- `src/scene.ts` — builds what the canvas draws. **Loses** `blendAcross`, `relaxAcross`, `REPAIRS`,
  `Repair` and four `req.repair === …` branches; **gains** the collectors for `onStage`/`onRepair`.
- `src/pipeline.ts` — **new**. The graph the controls derive from: stage nodes, repair nodes, and
  which stage each repair hangs off. This is the file `@weasel-js/diagram` reads later.
- `src/instrument.tsx` — `configSchema` builds from `pipeline.ts`; new canvas layers for the ghosts.
- `src/legend.ts` — two new inks, `added` and `removed`.

---

## Task 1: Widen `RepairSite` and give the registries their attachment

**Files:**
- Modify: `packages/core/src/render/tube/repairs.ts`
- Test: `packages/core/test/render/tube/repairs.test.ts`

**The trap that makes this task worth reading.** `repairs.ts` deliberately imports nothing from
`index.ts`, and the slice 2 plan warns that a *value* import from either would be a real cycle at
module-init time, both registries being module-level array initializers. `TubeStageId` lives in
`stages.ts`, and `stages.ts` already imports `type { CutRepairId, RepairSite }` from `repairs.ts`.
Adding `import type { TubeStageId } from './stages.js'` is safe **because both directions are
type-only and erased at emit** — there is no runtime edge. Do not turn either into a value import.

- [ ] **Step 1: Write the failing test**

Append to the `describe('the repair registries', …)` block in
`packages/core/test/render/tube/repairs.test.ts`:

```ts
  it('hangs every repair off the stage it runs inside', () => {
    for (const entry of [...CORNER_REPAIRS, ...SPAN_REPAIRS, ...DECISION_REPAIRS]) {
      expect(entry.stage).toBe('cut');
    }
  });

  it('separates the three levels a repair can attach at', () => {
    expect(CORNER_REPAIRS.map((r) => r.level)).toEqual(['corner', 'corner', 'corner']);
    expect(SPAN_REPAIRS.map((r) => r.level)).toEqual(['span', 'span', 'span']);
    expect(DECISION_REPAIRS.map((r) => r.id)).toEqual(['fillet', 'hairpin']);
    expect(DECISION_REPAIRS.map((r) => r.level)).toEqual(['decision', 'decision']);
  });

  it('names every id across the three registries exactly once per level', () => {
    const all = [...CORNER_REPAIRS, ...SPAN_REPAIRS, ...DECISION_REPAIRS];
    expect(new Set(all.map((r) => r.id))).toEqual(new Set(CUT_REPAIR_IDS));
  });
```

Add `DECISION_REPAIRS` to the import block at the top of the file.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run packages/core/test/render/tube/repairs.test.ts
```

Expected: FAIL — `DECISION_REPAIRS` is not exported from `repairs.ts`.

- [ ] **Step 3: Widen the site and the entries**

In `packages/core/src/render/tube/repairs.ts`, add the type-only stage import below the existing
`import type * as THREE from 'three';`:

```ts
import type { TubeStageId } from './stages.js';
```

Replace the `RepairSite` interface with:

```ts
/**
 * Where a repair would act and what it would change there. Returned whether or not the repair is
 * switched on: a boolean cannot be ghosted, and showing a worse path without showing what was
 * skipped leaves the reader to infer the difference.
 * @internal
 */
export interface RepairSite {
  /** Index into the leg the repair acts on. */
  at: number;
  /** The geometry it would put there, empty where the repair only removes vertices. */
  points: readonly THREE.Vector3[];
  /**
   * The vertices it would take out, empty where the repair only adds. An anchor index alone is not
   * enough to ghost a removal — it draws a dot where a stretch of path was going to disappear.
   */
  removed: readonly THREE.Vector3[];
  /** Which end of the corner this site is on; absent where the repair has no side. */
  side?: RepairSide;
}
```

Replace `CornerRepair` and `SpanRepair` and add `DecisionRepair`:

```ts
/**
 * Identity, label, order, and where the repair hangs in the pipeline — no `apply`. Each id fires
 * with a body no one signature spans (`setback` trims a span entering and yields an index leaving),
 * so the gate and the site live at each call site and this is what the lab enumerates.
 * @internal
 */
export interface RepairEntry {
  id: CutRepairId;
  label: string;
  /** The stage this repair runs inside. Every one of them is `cut`; the field is what a diagram
   * reads, and the day a repair hangs off another stage nothing has to be rewritten to say so. */
  stage: TubeStageId;
  /** `corner` inside `mergeArc`, `span` at the `stitchPath` level, `decision` where a strategy is
   * chosen before either runs. */
  level: 'corner' | 'span' | 'decision';
}

/** @internal */
export type CornerRepair = RepairEntry;
/** @internal */
export type SpanRepair = RepairEntry;
```

Rewrite the two registry constants and add the third:

```ts
export const CORNER_REPAIRS: readonly RepairEntry[] = [
  { id: 'stretch', label: 'stretch', stage: 'cut', level: 'corner' },
  { id: 'setback', label: 'setback', stage: 'cut', level: 'corner' },
  { id: 'resume', label: 'resume', stage: 'cut', level: 'corner' },
];

export const SPAN_REPAIRS: readonly RepairEntry[] = [
  { id: 'stretch', label: 'stretch (break)', stage: 'cut', level: 'span' },
  { id: 'close', label: 'close the loop', stage: 'cut', level: 'span' },
  { id: 'return', label: 'return', stage: 'cut', level: 'span' },
];

/**
 * Gated where the corner's strategy is picked, ahead of both other registries: switching either off
 * does not skip a step, it changes which step runs at all.
 * @internal
 */
export const DECISION_REPAIRS: readonly RepairEntry[] = [
  { id: 'fillet', label: 'fillet', stage: 'cut', level: 'decision' },
  { id: 'hairpin', label: 'hairpin', stage: 'cut', level: 'decision' },
];
```

- [ ] **Step 4: Fix every site construction that no longer compiles**

`removed` is required, so `runs.ts` will not build. Add `removed: []` to each of the six existing
`RepairSite` literals — lines 819, 825, 840, 851, 854, 871, 964, 1042, 1089, 1111, 1142. Tasks 2–6
replace the ones that should carry real vertices; this step only restores the build.

```bash
npx tsc -b packages/core/tsconfig.json
```

Expected: no output.

- [ ] **Step 5: Run the tests**

```bash
npx vitest run packages/core/test/render/tube/
```

Expected: PASS, including the three new cases.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/render/tube/repairs.ts packages/core/test/render/tube/repairs.test.ts packages/core/src/render/tube/runs.ts
git commit -m "carry a removal's extent and its attachment point on a repair site"
```

---

## Task 2: Entry-side `stretch` and `setback` report what they remove

**Files:**
- Modify: `packages/core/src/render/tube/runs.ts:818-828`
- Test: `packages/core/test/render/tube/repairs.test.ts`

Both sites are built *before* the trim, which is what makes capturing the removed vertices possible
at all — after `popStretch` or `trimTail` they are gone from `target`.

- [ ] **Step 1: Write the failing test**

Append inside `describe('the inner pass', …)`:

```ts
  it('carries the vertices a removal would take out, not just an index', () => {
    const sites: { id: string; removed: number; ran: boolean }[] = [];
    cutIntoRuns([{ points: square(), surface: 'front' as const, closed: true }], {
      ...OPTS,
      onRepair: (id, site, ran) => {
        if ((id === 'stretch' || id === 'setback') && site) {
          sites.push({ id, removed: site.removed.length, ran });
        }
      },
    });
    // Every corner-side stretch drops the corner's whole group, so none of them is a no-op.
    expect(sites.filter((s) => s.id === 'stretch').every((s) => s.removed > 0)).toBe(true);
    // Entry setback trims by distance and reports what it took; the exit side removes nothing from
    // the accumulator, it advances a cursor, so its `removed` is empty by construction.
    expect(sites.filter((s) => s.id === 'setback').some((s) => s.removed > 0)).toBe(true);
  });

  it('reports the removal a switched-off repair would have made', () => {
    const off: number[] = [];
    cutIntoRuns([{ points: square(), surface: 'front' as const, closed: true }], {
      ...OPTS,
      repairs: new Set(['setback', 'resume', 'fillet', 'close', 'return', 'hairpin'] as const),
      onRepair: (id, site, ran) => {
        if (id === 'stretch' && !ran && site) off.push(site.removed.length);
      },
    });
    expect(off.length).toBe(4);
    expect(off.every((n) => n > 0)).toBe(true);
  });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run packages/core/test/render/tube/repairs.test.ts
```

Expected: FAIL — `removed` is `[]` everywhere, so `every((s) => s.removed > 0)` is false.

- [ ] **Step 3: Capture the extents**

In `packages/core/src/render/tube/runs.ts`, replace the entry-side stretch and setback block
(currently lines 818–828) with:

```ts
  // Drop the corner's whole stretch before trimming by distance: a shallow turn's setback can be
  // shorter than one sample step, and would leave the stretch's own vertices in the path.
  const stretchCount = Math.min(decision.groupBefore + 1, target.length);
  const stretchSite: RepairSite = {
    at: target.length - 1,
    points: [],
    removed: target.slice(target.length - stretchCount),
    side: 'entry',
  };
  const ranStretch = on('stretch');
  if (ranStretch) popStretch(target, decision.groupBefore + 1);
  report('stretch', stretchSite, ranStretch);
  // Indexes the accumulator before the trim; a consumer must not map it onto the post-trim span.
  const setbackKeep = keptByTail(target, fillet.setback, fillet.corner);
  const setbackSite: RepairSite = {
    at: target.length - 1,
    points: [],
    removed: target.slice(setbackKeep),
    side: 'entry',
  };
  const ranSetback = on('setback');
  if (ranSetback) trimTail(target, fillet.setback, fillet.corner);
  report('setback', setbackSite, ranSetback);
```

`keptByTail` does not exist yet. Find `trimTail` in the same file and add, immediately above it:

```ts
/**
 * How many vertices `trimTail` would leave. Split out so a site can name the stretch about to go
 * without running the trim — the repair may be switched off, and the report has to be the same
 * either way.
 */
function keptByTail(span: THREE.Vector3[], back: number, corner: THREE.Vector3): number {
  let keep = span.length;
  while (keep > 0 && (span[keep - 1] as THREE.Vector3).distanceTo(corner) < back) keep--;
  return keep;
}
```

Then rewrite `trimTail` (currently at `runs.ts:276`) to use it, so the two cannot drift:

```ts
function trimTail(span: THREE.Vector3[], back: number, corner: THREE.Vector3): void {
  span.length = keptByTail(span, back, corner);
}
```

**The floor is zero, not one** — the shipped loop is `while (span.length > 0 && …) span.pop()`, so
an entry setback can empty the accumulator and the arc refills it. `keep > 1` would quietly leave a
vertex behind on exactly the corners that trim hardest.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run packages/core/test/render/tube/
```

Expected: PASS, all of it. The point counts in the existing `moves the …` tests must be unchanged —
if any of 209/217/225/241 moved, `keptByTail` does not match the old `trimTail` and Step 3's warning
applies.

- [ ] **Step 5: Verify by mutation**

Change `removed: target.slice(setbackKeep)` to `removed: []` and re-run. Expected: the two new tests
redden. Restore it. A green suite under that mutation means the assertions never read `removed`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/render/tube/runs.ts packages/core/test/render/tube/repairs.test.ts
git commit -m "report the vertices the entry-side stretch and setback remove"
```

---

## Task 3: The exit-side `resume` gates and reports

**Files:**
- Modify: `packages/core/src/render/tube/runs.ts:869-890`
- Test: `packages/core/test/render/tube/repairs.test.ts:188-206`

This is the one task that changes an off-state's geometry. The tail of `mergeArc` runs
`bridgeAfter` / `relaxOnto` / `resumeAt` unconditionally and reports none of them, so the `resume`
toggle currently governs one end of the corner and the lab would draw half a story.

- [ ] **Step 1: Update the existing assertion that pins the gap**

In `packages/core/test/render/tube/repairs.test.ts`, the test `reports the resume provider that
actually answered` ends with:

```ts
    // One entry-side resume report per corner.
    expect(reports).toBe(4);
```

Replace those two lines with:

```ts
    // Both sides of all four corners.
    expect(reports).toBe(8);
```

- [ ] **Step 2: Write the failing test**

Append inside `describe('the inner pass', …)`:

```ts
  it('reports resume on both sides of every corner', () => {
    const sides: (string | undefined)[] = [];
    cutIntoRuns([{ points: square(), surface: 'front' as const, closed: true }], {
      ...OPTS,
      onRepair: (id, site) => {
        if (id === 'resume' && site) sides.push(site.side);
      },
    });
    expect(sides.filter((s) => s === 'entry')).toHaveLength(4);
    expect(sides.filter((s) => s === 'exit')).toHaveLength(4);
  });
```

- [ ] **Step 3: Run both and watch them fail**

```bash
npx vitest run packages/core/test/render/tube/repairs.test.ts
```

Expected: two FAILs — `reports` is 4 not 8, and no site carries `side: 'exit'`.

- [ ] **Step 4: Gate and report the exit side**

In `runs.ts`, replace the tail of `mergeArc` from `if (rejoin === 'bridge') {` (the second one,
around line 875, the one using `bridgeAfter`) through the end of the function with:

```ts
  const ranExitResume = on('resume');
  if (rejoin === 'bridge') {
    const blend = bridgeAfter(next, start, exit, outOf, rhoMin, spacing);
    if (blend) {
      report('resume', { at: start, points: blend.points, removed: [], side: 'exit' }, ranExitResume);
      for (let i = 1; i < blend.points.length; i++) target.push(blend.points[i] as THREE.Vector3);
      for (let i = blend.at + 1; i < next.length; i++) target.push(next[i] as THREE.Vector3);
      return;
    }
  }
  if (rejoin === 'relax' && start < next.length) {
    const relaxed = relaxOnto([penult, exit], next, start, 1, rhoMin, inherit);
    if (relaxed) {
      report('resume', { at: start, points: relaxed, removed: [], side: 'exit' }, ranExitResume);
      for (const p of relaxed) target.push(p);
      for (let i = start + relaxed.length; i < next.length; i++) {
        target.push(next[i] as THREE.Vector3);
      }
      return;
    }
  }
  const from = resumeAt(next, start, 1, exit, penult, outOf, rhoMin, spacing);
  report('resume', { at: from, points: [], removed: next.slice(start, from), side: 'exit' }, ranExitResume);
  const walkFrom = ranExitResume ? from : start;
  for (let i = walkFrom; i < next.length; i++) target.push(next[i] as THREE.Vector3);
}
```

Three things to notice. The bridge and relax branches report and then apply their geometry
**regardless of the gate**, exactly as the entry side does — the comment already on `ranResume`
explains why, and the same lie would otherwise be told twice. Only the plain walk's skip is gated.
And the `removed` extent is `next.slice(start, from)` — the leg vertices the walk skips past, which
is precisely what a ghost should draw.

- [ ] **Step 5: Run the tests**

```bash
npx vitest run packages/core/test/render/tube/
```

Expected: PASS. `pins the entry-side resume geometry the walk-off gate controls` asserts 209 with
everything on — that must not move, because the gate is on and `walkFrom === from` reproduces the
old unconditional behavior.

- [ ] **Step 6: Pin the new off-state and verify by mutation**

The resume-off count under `rejoin: 'drop'` was 217 with only the entry side gated; gating the exit
side too makes it larger. Find the number by adding the assertion to `pins the entry-side resume
geometry the walk-off gate controls` with a deliberately wrong expectation and reading the actual
out of vitest's diff:

```ts
    expect(
      countOf({
        ...OPTS,
        rejoin: 'drop',
        repairs: new Set(['stretch', 'setback', 'fillet', 'close', 'return', 'hairpin'] as const),
      }),
    ).toBe(0);
```

Replace `0` with the number vitest reports, and rename the test to `pins the resume geometry both
walk-off gates control`. Then mutate: change `const walkFrom = ranExitResume ? from : start;` to
`const walkFrom = from;` and re-run. Expected: that assertion reddens. Restore it. If it stays green
the exit gate does nothing and the number you pinned is the entry side's alone.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/render/tube/runs.ts packages/core/test/render/tube/repairs.test.ts
git commit -m "gate and report the exit-side resume"
```

---

## Task 4: `hairpin` reports

**Files:**
- Modify: `packages/core/src/render/tube/runs.ts:951-960`, `runs.ts:801-804`
- Test: `packages/core/test/render/tube/repairs.test.ts`

`hairpin` is gate-only: the decision loop flips `strategy` to `'break'` and `spliceHairpin` returns
out of `mergeArc`, so nothing tells a consumer a hairpin happened or was declined. Use `sharpV()` —
a square never hairpins.

- [ ] **Step 1: Write the failing test**

Append inside `describe('the whole-corner decisions', …)`:

```ts
  it('reports the hairpin it drew at the sharp V', () => {
    const sites: { ran: boolean; points: number }[] = [];
    cutIntoRuns([{ points: sharpV(), surface: 'front' as const, closed: false }], {
      ...OPTS,
      corners: { break: 0, connect: 0, hairpin: 1 },
      onRepair: (id, site, ran) => {
        if (id === 'hairpin' && site) sites.push({ ran, points: site.points.length });
      },
    });
    expect(sites).toHaveLength(1);
    expect(sites[0]?.ran).toBe(true);
    expect(sites[0]?.points).toBeGreaterThan(0);
  });

  it('reports the hairpin it declined when the toggle is off', () => {
    const sites: { ran: boolean; points: number }[] = [];
    cutIntoRuns([{ points: sharpV(), surface: 'front' as const, closed: false }], {
      ...OPTS,
      corners: { break: 0, connect: 0, hairpin: 1 },
      repairs: new Set(['stretch', 'setback', 'resume', 'fillet', 'close', 'return'] as const),
      onRepair: (id, site, ran) => {
        if (id === 'hairpin' && site) sites.push({ ran, points: site.points.length });
      },
    });
    expect(sites).toHaveLength(1);
    expect(sites[0]?.ran).toBe(false);
    // The site still carries what the hairpin would have drawn — that is the whole point of it.
    expect(sites[0]?.points).toBeGreaterThan(0);
  });
```

`CornerWeights` is `{ break, connect, hairpin? }` (`runs.ts:85`), so those weights are valid as
written — `hairpin` is optional and absent means no corner draws one.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run packages/core/test/render/tube/repairs.test.ts
```

Expected: FAIL — `sites` is empty; nothing reports `hairpin`.

- [ ] **Step 3: Report at the decision, not at the splice**

The site has to carry the hairpin's geometry, and the geometry only exists after `hairpinFor` runs.
So the gate has to move *below* the build. In `runs.ts`, replace:

```ts
    let hairpin: Hairpin | null = null;
    if (strategy === 'hairpin' && !on('hairpin')) strategy = 'break';
    if (strategy === 'hairpin') {
      hairpin = hairpinFor(before, after, c, shape, rhoMin, spacing);
```

with:

```ts
    let hairpin: Hairpin | null = null;
    if (strategy === 'hairpin') {
      const ranHairpin = on('hairpin');
      hairpin = hairpinFor(before, after, c, shape, rhoMin, spacing);
      if (hairpin) {
        report('hairpin', { at: c.index, points: hairpin.points, removed: [] }, ranHairpin);
      }
      if (!ranHairpin) {
        strategy = 'break';
        hairpin = null;
      }
    }
    if (strategy === 'hairpin') {
```

Building the hairpin even when the toggle is off costs one `hairpinFor` per hairpin corner and buys
the ghost. It cannot change geometry: `hairpin` is nulled and `strategy` set to `break` on exactly
the path that previously took the early exit.

`Hairpin.points` is the spliced geometry, a flat `THREE.Vector3[]` (`hairpin.ts:27`), so it can go
straight into the site.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run packages/core/test/render/tube/
```

Expected: PASS. `breaks a hairpin corner when hairpin is switched off` (line 317) must stay green —
it asserts the geometry, which this does not touch.

- [ ] **Step 5: Verify by mutation**

Delete the `report('hairpin', …)` call and re-run. Expected: both new tests redden. Restore it.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/render/tube/runs.ts packages/core/test/render/tube/repairs.test.ts
git commit -m "report the hairpin a corner draws or declines"
```

---

## Task 5: The blockout fillet and the silenced `return` report

**Files:**
- Modify: `packages/core/src/render/tube/runs.ts:962-1030`
- Test: `packages/core/test/render/tube/repairs.test.ts`

Two silences, one cause. `report('fillet', …)` fires only under `wantsFillet`, so the blockout
branch's own fillet candidate is never named. And when `fillet` is off, `strategy` never reaches
`'return'`, so `report('return', …)` never runs — the lab shows a blank panel at a corner that
plainly did something. The fix for both is to compute the candidate whether or not the gate is open,
report it, and apply only when it is.

- [ ] **Step 1: Write the failing test**

Append inside `describe('the whole-corner decisions', …)`:

```ts
  it('reports the return it would have drawn when fillet is switched off', () => {
    const path = [{ points: square(), surface: 'front' as const, closed: true }];
    const withFillet = { ...OPTS, corners: ALL_BREAK, blockout: 1 };
    const on: boolean[] = [];
    cutIntoRuns(path, {
      ...withFillet,
      onRepair: (id, _site, ran) => {
        if (id === 'return') on.push(ran);
      },
    });
    expect(on.length).toBeGreaterThan(0);
    expect(on.every(Boolean)).toBe(true);

    const off: boolean[] = [];
    cutIntoRuns(path, {
      ...withFillet,
      repairs: new Set(['stretch', 'setback', 'resume', 'close', 'return', 'hairpin'] as const),
      onRepair: (id, _site, ran) => {
        if (id === 'return') off.push(ran);
      },
    });
    // The same corners still report — as skipped, because the fillet they need is gone.
    expect(off.length).toBe(on.length);
    expect(off.some(Boolean)).toBe(false);
  });

  it('reports the blockout fillet candidate, which a connect never sees', () => {
    const seen: number[] = [];
    cutIntoRuns([{ points: square(), surface: 'front' as const, closed: true }], {
      ...OPTS,
      corners: ALL_BREAK,
      blockout: 1,
      onRepair: (id, site) => {
        if (id === 'fillet' && site) seen.push(site.points.length);
      },
    });
    // Every corner breaks, so every fillet report here is the blockout candidate.
    expect(seen.length).toBe(4);
    expect(seen.every((n) => n > 0)).toBe(true);
  });
```

`ALL_BREAK` is already imported at the top of the file.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run packages/core/test/render/tube/repairs.test.ts
```

Expected: two FAILs — `off.length` is 0 (no `return` reports at all with fillet off), and `seen` is
empty (the blockout candidate never reports).

- [ ] **Step 3: Report the blockout candidate**

In `runs.ts`, replace the blockout branch:

```ts
    if (strategy === 'break' && drawAt(k, BLOCKOUT_DRAW) < blockout) {
      const blockoutFillet = filletFor(before, after, c, rhoMin, spacing, rejoin);
      fillet = ranFillet ? blockoutFillet : null;
      if (fillet) strategy = 'return';
    }
```

with:

```ts
    if (strategy === 'break' && drawAt(k, BLOCKOUT_DRAW) < blockout) {
      const blockoutFillet = filletFor(before, after, c, rhoMin, spacing, rejoin);
      if (blockoutFillet) {
        report('fillet', { at: c.index, points: blockoutFillet.points, removed: [] }, ranFillet);
        // The return this fillet would carry, named whether or not the fillet is there to carry it:
        // with `fillet` off the strategy stays `break` and the span-level report below never runs.
        if (!ranFillet) {
          report('return', { at: c.index, points: blockoutFillet.points, removed: [] }, false);
        }
      }
      fillet = ranFillet ? blockoutFillet : null;
      if (fillet) strategy = 'return';
    }
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run packages/core/test/render/tube/
```

Expected: PASS. `reports one fillet per hard corner, all skipped, when fillet is switched off`
(line 343) and `reports the fillet as run when fillet is switched on` (line 360) use the default
`blockout`, so the new branch never fires for them and their counts are unchanged. If either moved,
they pass a nonzero `blockout` — read them and adjust the expectation to include the candidates.

- [ ] **Step 5: Verify by mutation**

Delete the `if (!ranFillet)` report and re-run. Expected: `reports the return it would have drawn
when fillet is switched off` reddens on `off.length`. Restore it.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/render/tube/runs.ts packages/core/test/render/tube/repairs.test.ts
git commit -m "report the blockout fillet and the return it would have carried"
```

---

## Task 6: The break-side `stretch` gates and reports

**Files:**
- Modify: `packages/core/src/render/tube/runs.ts:495-501`, and the three `dropHead`/`dropTail` call
  sites in `stitchPath`
- Test: `packages/core/test/render/tube/repairs.test.ts`

`SPAN_REPAIRS` declares `stretch (break)` and nothing gates it: `dropHead` and `dropTail` call
`trimStretch` directly. The entry is enumerable and inert, so the lab would render a toggle that
does nothing.

- [ ] **Step 1: Write the failing test**

Append inside `describe('the span registry', …)`:

```ts
  it('reports the break-side stretch on every break', () => {
    const sites: { removed: number; ran: boolean }[] = [];
    cutIntoRuns([{ points: square(), surface: 'front' as const, closed: true }], {
      ...OPTS,
      corners: ALL_BREAK,
      onRepair: (id, site, ran) => {
        if (id === 'stretch' && site) sites.push({ removed: site.removed.length, ran });
      },
    });
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every((s) => s.ran)).toBe(true);
    expect(sites.some((s) => s.removed > 0)).toBe(true);
  });

  it('leaves the break ends untrimmed when the break-side stretch is switched off', () => {
    const path = [{ points: square(), surface: 'front' as const, closed: true }];
    const countOf = (repairs?: Set<string>) =>
      cutIntoRuns(path, {
        ...OPTS,
        corners: ALL_BREAK,
        ...(repairs ? { repairs: repairs as never } : {}),
      }).runs.reduce((n, r) => n + r.points.length, 0);
    const on = countOf();
    const off = countOf(
      new Set(['setback', 'resume', 'fillet', 'close', 'return', 'hairpin']),
    );
    // Switching it off keeps the corner's own vertices on each span end.
    expect(off).toBeGreaterThan(on);
  });
```

Read `OPTS` in that describe block before using it — the span registry's block defines its own; if
it does not, copy the one from `describe('the inner pass', …)`.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run packages/core/test/render/tube/repairs.test.ts
```

Expected: FAIL — `sites` is empty and `off === on`.

- [ ] **Step 3: Thread the gate through**

In `runs.ts`, `dropHead` and `dropTail` have no access to `on` or `report`, so give them the site and
let the caller decide. Replace both with:

```ts
/**
 * A break cuts the whole corner stretch out, not just the vertex detection collapsed it to. The
 * neighbouring vertices are the same corner; left on a run's end they are tube still bending
 * tighter than rhoMin, with no corner stage left to fix them.
 *
 * Returns the site alongside the trimmed span so the caller can gate one and report the other; the
 * floor is two vertices, unlike the corner-side `popStretch`, because a break's product still has
 * to sweep.
 */
function dropEnd(
  span: THREE.Vector3[],
  count: number,
  end: 'head' | 'tail',
): { points: THREE.Vector3[]; site: RepairSite } {
  const kept = trimStretch(span, count, end);
  const removed =
    end === 'tail' ? span.slice(kept.length) : span.slice(0, span.length - kept.length);
  return {
    points: kept,
    site: { at: end === 'tail' ? kept.length - 1 : 0, points: [], removed },
  };
}
```

Delete `dropHead` and `dropTail`. At each of their three call sites in `stitchPath`, replace

```ts
  let current = dropHead((arcs[breakIdx] as THREE.Vector3[]).slice(), opening.groupAfter + 1);
```

with

```ts
  const opened = dropEnd((arcs[breakIdx] as THREE.Vector3[]).slice(), opening.groupAfter + 1, 'head');
  report('stretch', opened.site, on('stretch'));
  let current = on('stretch') ? opened.points : (arcs[breakIdx] as THREE.Vector3[]).slice();
```

and, in the loop:

```ts
    if (decision.strategy === 'break') {
      const tail = dropEnd(current, decision.groupBefore + 1, 'tail');
      report('stretch', tail.site, on('stretch'));
      spans.push({ points: on('stretch') ? tail.points : current });
      const head = dropEnd((arcs[arcIdx] as THREE.Vector3[]).slice(), decision.groupAfter + 1, 'head');
      report('stretch', head.site, on('stretch'));
      current = on('stretch') ? head.points : (arcs[arcIdx] as THREE.Vector3[]).slice();
    } else {
```

**Search for every remaining `dropHead`/`dropTail` before compiling** — this plan names three call
sites from a reading of `stitchPath`, and a fourth in the open-path branch would compile as a
missing-symbol error rather than silently surviving:

```bash
grep -n "dropHead\|dropTail" packages/core/src/render/tube/runs.ts
```

Expected after the edit: no matches.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run packages/core/test/render/tube/
```

Expected: PASS. `floors the break-side stretch at two vertices` (line 94) tests `trimStretch`
directly and is untouched.

- [ ] **Step 5: Verify by mutation**

Change `on('stretch') ? opened.points : …` to `opened.points` at all three sites and re-run.
Expected: `leaves the break ends untrimmed …` reddens. Restore.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/render/tube/runs.ts packages/core/test/render/tube/repairs.test.ts
git commit -m "gate and report the break-side stretch"
```

---

## Task 7: The alphabet-wide guard

**Files:**
- Create: `packages/core/test/render/tube/reports.test.ts`

Two invariants the per-fixture tests cannot reach: that all-repairs-on is byte-identical to
repairs-absent across real glyphs, and that every id actually reports somewhere in the alphabet
rather than only on a synthetic square.

- [ ] **Step 1: Write the test**

No existing test loads a real font — `test/text/font.test.ts` mocks `opentype.js` outright — so this
is the first. It reads `apps/lab/public/font.ttf` off disk and parses it directly; the labs' own
`font.ts` cannot be reused because it imports the TTF through vite's `?url`, which vitest does not
resolve. Measured cost of the whole file: about 450ms.

Create `packages/core/test/render/tube/reports.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as opentype from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { specOf } from '../../../src/render/looks.js';
import { buildTubeBlueprint } from '../../../src/render/tube/index.js';
import { CUT_REPAIR_IDS, type CutRepairId } from '../../../src/render/tube/repairs.js';
import type { TubeSpec } from '../../../src/render/tube/index.js';
import { glyphToShapes } from '../../../src/text/glyphs.js';

const LETTERS = 'ABDEGMNQRSW8';
const LOOKS = ['tubing', 'piping'] as const;

const FONT_PATH = fileURLToPath(
  new URL('../../../../../apps/lab/public/font.ttf', import.meta.url),
);

/** `opentype.parse` wants an ArrayBuffer, and a Node Buffer is a view into a pooled one. */
function labFont() {
  const buf = readFileSync(FONT_PATH);
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function specFor(name: (typeof LOOKS)[number]): TubeSpec {
  const decoration = specOf(name).decoration;
  if (decoration?.kind !== 'tube') throw new Error(`${name} has no tube decoration`);
  return decoration;
}

describe('every repair reports across the alphabet', () => {
  const font = labFont();
  const shapesOf = (letter: string) => glyphToShapes(font as never, letter, 1);

  it('reports every id at least once', () => {
    const seen = new Set<CutRepairId>();
    for (const look of LOOKS) {
      for (const letter of LETTERS) {
        const bp = buildTubeBlueprint(shapesOf(letter), specFor(look), 0.35, 0, {
          onRepair: (id) => seen.add(id),
        });
        bp.dispose();
      }
    }
    // No shipped look weights `hairpin`, so the alphabet alone can never produce one — it needs a
    // spec that asks for it. Measured: without this, `hairpin` is the only id missing.
    const hairpinSpec: TubeSpec = {
      ...specFor('tubing'),
      corners: { break: 0, connect: 0, hairpin: 1 },
    };
    for (const letter of LETTERS) {
      const bp = buildTubeBlueprint(shapesOf(letter), hairpinSpec, 0.35, 0, {
        onRepair: (id) => seen.add(id),
      });
      bp.dispose();
    }
    expect([...seen].sort()).toEqual([...CUT_REPAIR_IDS].sort());
  });

  it('reports both sides of every corner repair', () => {
    const bySide = new Map<string, number>();
    for (const letter of LETTERS) {
      const bp = buildTubeBlueprint(shapesOf(letter), specFor('tubing'), 0.35, 0, {
        onRepair: (id, site) => {
          if (!site?.side) return;
          const key = `${id}:${site.side}`;
          bySide.set(key, (bySide.get(key) ?? 0) + 1);
        },
      });
      bp.dispose();
    }
    // `setback` and `resume` are the two ids wholly inside `mergeArc`, and both fire on both ends.
    // Before slice 3 `resume` reported entry-only, at exactly half `setback`'s count.
    expect(bySide.get('setback:entry')).toBeGreaterThan(0);
    expect(bySide.get('setback:exit')).toBe(bySide.get('setback:entry'));
    expect(bySide.get('resume:entry')).toBeGreaterThan(0);
    expect(bySide.get('resume:exit')).toBe(bySide.get('resume:entry'));
  });

  it('builds identically with every repair on as with repairs absent', () => {
    const all = new Set<CutRepairId>(CUT_REPAIR_IDS);
    for (const look of LOOKS) {
      for (const letter of LETTERS) {
        const bare = buildTubeBlueprint(shapesOf(letter), specFor(look), 0.35, 0);
        const full = buildTubeBlueprint(shapesOf(letter), specFor(look), 0.35, 0, {
          repairs: all,
        });
        expect(full.runs.length).toBe(bare.runs.length);
        expect(full.runs.map((r) => r.points.length)).toEqual(
          bare.runs.map((r) => r.points.length),
        );
        full.runs.forEach((run, i) => {
          const was = bare.runs[i]?.points ?? [];
          run.points.forEach((p, j) => {
            expect(p.x).toBe(was[j]?.x);
            expect(p.y).toBe(was[j]?.y);
            expect(p.z).toBe(was[j]?.z);
          });
        });
        bare.dispose();
        full.dispose();
      }
    }
  });
});
```

`buildTubeBlueprint(shapes, spec, depth, seed, opts?)` is the signature (`index.ts:119`), with
`repairs`, `onRepair`, `stages` and `onStage` all on the optional fifth argument.

**Two of these three pass on `main` already.** `builds identically` and `reports every id at least
once` were measured green before Part A; they are regression guards, not new capability. `reports
both sides of every corner repair` is the one that can only pass after Task 3 — on `main` the
alphabet gives `setback` 296 reports against `resume`'s 148.

- [ ] **Step 2: Run it**

```bash
npx vitest run packages/core/test/render/tube/reports.test.ts
```

Expected: PASS, three tests, under a second.

- [ ] **Step 3: Run the whole suite and the visual snapshots**

```bash
npx vitest run
npx playwright test apps/lab/test/looks.spec.ts
```

Expected: vitest green at 64+ files; `look-tubing` and `look-piping` byte-identical. **A snapshot
diff here means Part A changed shipped geometry and one of Tasks 2–6 has a bug** — find it before
going on, because Part B is built on top.

- [ ] **Step 4: Commit**

```bash
git add packages/core/test/render/tube/reports.test.ts
git commit -m "pin every repair reporting across the alphabet at both tube looks"
```

---

## Task 8: Give tube-lab the `@core/*` alias

**Files:**
- Modify: `packages/core/dev/tube-lab/vite.config.ts`, `packages/core/dev/tube-lab/tsconfig.json`,
  and 9 files under `packages/core/dev/tube-lab/src/`

24 imports reach core through `../../../src/…` or `../../../../src/…` while the corner lab next door
uses `@core/*`. Fix it before Part B multiplies the pattern.

- [ ] **Step 1: Add the alias to both configs**

`packages/core/dev/tube-lab/vite.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// 5181 so this and apps/lab (5180) can run side by side, which is the point of a second lab.
export default defineConfig({
  server: { port: 5181 },
  resolve: {
    alias: { '@core': fileURLToPath(new URL('../../src', import.meta.url)) },
  },
});
```

In `packages/core/dev/tube-lab/tsconfig.json`, add to `compilerOptions`:

```json
    "paths": {
      "@core/*": ["../../src/*"]
    }
```

- [ ] **Step 2: Rewrite the imports**

```bash
cd packages/core/dev/tube-lab/src
grep -rl "\.\./\.\./\.\./src/" . | xargs sed -i '' 's|\.\./\.\./\.\./\.\./src/|@core/|g; s|\.\./\.\./\.\./src/|@core/|g'
cd -
```

**The font import must stay relative.** `src/font.ts` reaches
`../../../../../apps/lab/public/font.ttf?url`, which is outside the package and not under `src`; the
sed above does not match it, but confirm:

```bash
grep -rn "font.ttf" packages/core/dev/tube-lab/src/
```

Expected: still the relative path.

- [ ] **Step 3: Verify nothing deep survives**

```bash
grep -rn "\.\./\.\./\.\./src/" packages/core/dev/tube-lab/src/
```

Expected: no matches.

- [ ] **Step 4: Typecheck and build**

```bash
npx tsc -b packages/core/dev/tube-lab/tsconfig.json
npx vite build packages/core/dev/tube-lab
```

Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/dev/tube-lab
git commit -m "reach core through the @core alias in the tube lab"
```

---

## Task 9: Rename corner-lab to kliegsminister

**Files:**
- Rename: `packages/core/dev/corner-lab/` → `packages/core/dev/kliegsminister/`
- Modify: `packages/core/package.json`, `packages/core/dev/kliegsminister/tsconfig.json`,
  `packages/core/dev/kliegsminister/index.html`, `packages/core/dev/kliegsminister/vite.config.ts`

The instrument keeps the name `junction` — it still describes what one tile shows.

- [ ] **Step 1: Move it**

```bash
git mv packages/core/dev/corner-lab packages/core/dev/kliegsminister
```

- [ ] **Step 2: Fix the references**

In `packages/core/package.json`, replace the script:

```json
    "dev:kliegsminister": "vite dev/kliegsminister",
```

In `packages/core/dev/kliegsminister/tsconfig.json`, change `outDir` to
`"../.tsbuild/kliegsminister"`. In `vite.config.ts`, update the port comment to name the lab. Then
find everything else:

**There is a test directory mirroring the lab's name**: `packages/core/test/dev/corner-lab/legend.test.ts`
pins `INK` against `LEGEND`, and its import path breaks the moment `src` moves.

```bash
git mv packages/core/test/dev/corner-lab packages/core/test/dev/kliegsminister
```

Then fix its import and find everything else:

```bash
grep -rn "corner-lab" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist .
```

Expected after fixing: hits only in `docs/`, `CHANGELOG.md` and `README.md`, which are history and
stay as they are. Anything under `packages/`, `apps/`, `.github/` or a config file must be updated.
Watch for `.gitignore` and `playwright.config.ts`.

- [ ] **Step 3: Verify it runs**

```bash
npm --prefix packages/core run dev:kliegsminister
```

Expected: vite serves on 5182. Open it, confirm the junction tile still draws, then stop the server.

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc -b packages/core/tsconfig.json
git add -A
git commit -m "rename the corner lab to kliegsminister"
```

---

## Task 10: The pipeline graph the controls derive from

**Files:**
- Create: `packages/core/dev/kliegsminister/src/pipeline.ts`
- Test: `packages/core/test/render/tube/repairs.test.ts` (registry shape is already covered by
  Task 1; this file has no test of its own — it is derivation, and Task 12 exercises it)

One module holding the lab's view of the pipeline as nodes and edges. When `@weasel-js/diagram`
ships, this is what it reads; until then it is what builds the control panel's groups.

- [ ] **Step 1: Write it**

```ts
import {
  CORNER_REPAIRS,
  type CutRepairId,
  DECISION_REPAIRS,
  type RepairEntry,
  SPAN_REPAIRS,
} from '@core/render/tube/repairs.js';
import { TUBE_STAGES, type TubeStageId } from '@core/render/tube/stages.js';

export interface StageNode {
  kind: 'stage';
  id: TubeStageId;
  label: string;
}

export interface RepairNode {
  kind: 'repair';
  id: CutRepairId;
  label: string;
  /** The stage this hangs off, and the level it runs at within it. */
  stage: TubeStageId;
  level: RepairEntry['level'];
}

export type PipelineNode = StageNode | RepairNode;

/** `from` feeds `to`; a repair's edge points at the stage it runs inside. */
export interface PipelineEdge {
  from: string;
  to: string;
}

const keyOf = (node: PipelineNode) =>
  node.kind === 'stage' ? `stage:${node.id}` : `repair:${node.level}:${node.id}`;

export const STAGE_NODES: StageNode[] = TUBE_STAGES.map((s) => ({
  kind: 'stage',
  id: s.id,
  label: s.label,
}));

export const REPAIR_NODES: RepairNode[] = [
  ...DECISION_REPAIRS,
  ...CORNER_REPAIRS,
  ...SPAN_REPAIRS,
].map((r) => ({ kind: 'repair', id: r.id, label: r.label, stage: r.stage, level: r.level }));

export const PIPELINE_NODES: PipelineNode[] = [...STAGE_NODES, ...REPAIR_NODES];

export const PIPELINE_EDGES: PipelineEdge[] = [
  ...STAGE_NODES.slice(1).map((node, i) => ({
    from: keyOf(STAGE_NODES[i] as StageNode),
    to: keyOf(node),
  })),
  ...REPAIR_NODES.map((node) => ({ from: keyOf(node), to: `stage:${node.stage}` })),
];

export const NODE_KEY = keyOf;

/**
 * The repair toggles, grouped the way they run. `stretch` appears twice under two levels and two
 * labels but is one `CutRepairId`: the gate cannot separate them, and a panel that pretended
 * otherwise would show two switches wired to one wire.
 */
export const TOGGLE_GROUPS: { level: RepairEntry['level']; label: string; ids: CutRepairId[] }[] = [
  { level: 'decision', label: 'strategy', ids: [...new Set(DECISION_REPAIRS.map((r) => r.id))] },
  { level: 'corner', label: 'inside the corner', ids: [...new Set(CORNER_REPAIRS.map((r) => r.id))] },
  { level: 'span', label: 'across spans', ids: [...new Set(SPAN_REPAIRS.map((r) => r.id))] },
];
```

The `stretch`-appears-twice comment is the trap here: `repairs` is a `Set<CutRepairId>`, so one
switch governs both implementations. Do not render two.

- [ ] **Step 2: Typecheck**

```bash
npx tsc -b packages/core/dev/kliegsminister/tsconfig.json
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/core/dev/kliegsminister/src/pipeline.ts
git commit -m "derive the lab's pipeline graph from the stage and repair registries"
```

---

## Task 11: `scene.ts` stops owning geometry

**Files:**
- Modify: `packages/core/dev/kliegsminister/src/scene.ts`
- Modify: `packages/core/dev/kliegsminister/src/instrument.tsx`

The `built | merge | relax | biarc | cut` dropdown predates `TubeSpec.rejoin`. Core now draws every
one of those paths, and a second implementation is one that can disagree with the renderer silently.

- [ ] **Step 1: Delete the lab's geometry**

From `scene.ts`, delete: the `REPAIRS` const and `Repair` type (lines 25–26), `blendAcross`
(line 156), `relaxAcross` (line 183), and the four `if (req.repair === …)` blocks (lines 378–436).
Delete the now-unused imports — `biarcBlend` and `minCurvatureRadius3` at least; run the typecheck
to find the rest.

Change `SceneRequest`: drop `repair: Repair`, add `rejoin: Rejoin`. Import `Rejoin` and `REJOINS`
from `@core/render/tube/runs.js`.

In `buildScene`, pass the rejoin into the build:

```ts
  const blueprint = buildTubeBlueprint(
    glyphToShapes(font.font, req.letter, 1),
    { ...spec, pathSource: req.source, rejoin: req.rejoin },
    PAD,
    0,
  );
```

Note `amplitude: 0` is gone from that spread — Task 12 makes `wander` a selectable stage and the lab
should show the bends the cut actually sees.

`drawn` stays on `CornerScene` but is now always `null` until Task 13 fills it with ghosts. Leave the
field and its `repair` canvas layer in place rather than deleting and re-adding them.

- [ ] **Step 2: Swap the control**

In `instrument.tsx`, change `Config.repair: string` to `rejoin: string`, update `requestOf` to

```ts
    rejoin: (REJOINS.includes(config.rejoin as Rejoin) ? config.rejoin : 'drop') as Rejoin,
```

and replace the `repair` entry in `configSchema` with

```ts
    {
      key: 'rejoin',
      label: 'rejoin',
      type: 'select',
      default: 'drop',
      options: REJOINS.map((r) => ({ value: r, label: r })),
    },
```

Update `defaultConfig` to `rejoin: 'drop'`. `DEFAULT_REJOIN` is `drop`; use the constant if it is
exported rather than repeating the literal.

- [ ] **Step 3: Typecheck**

```bash
npx tsc -b packages/core/dev/kliegsminister/tsconfig.json
```

Expected: clean. Any "declared but never read" error names an import Step 1 missed.

- [ ] **Step 4: Look at it**

```bash
npm --prefix packages/core run dev:kliegsminister
```

Open 5182. Step the `rejoin` control through all four values on letter `B` and confirm the built run
changes shape — `bridge` visibly blends into the fillet, `drop` does not. **This is the check that
the knob is wired to the build rather than to nothing**; a select that changes no pixels is the
failure mode. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add packages/core/dev/kliegsminister/src
git commit -m "drive the real rejoin instead of the lab's own repair geometry"
```

---

## Task 12: `stages` and `draw at`

**Files:**
- Modify: `packages/core/dev/kliegsminister/src/scene.ts`,
  `packages/core/dev/kliegsminister/src/instrument.tsx`

Two orthogonal knobs. `stages` chooses what runs; `draw at` chooses which stage's output is on the
canvas.

- [ ] **Step 1: Collect the snapshots**

In `scene.ts`, add to `SceneRequest`:

```ts
  stages: ReadonlySet<TubeStageId>;
  drawAt: TubeStageId;
```

and to `CornerScene`:

```ts
  /** Paths as they stood after the selected stage, in the glyph's own space. */
  staged: THREE.Vector3[][];
  /** Stages that were switched off, so the panel can say a step was bypassed rather than empty. */
  skipped: TubeStageId[];
```

In `buildScene`, replace the `buildTubeBlueprint` call with one that collects:

```ts
  const staged: THREE.Vector3[][] = [];
  const skipped: TubeStageId[] = [];
  const blueprint = buildTubeBlueprint(
    glyphToShapes(font.font, req.letter, 1),
    { ...spec, pathSource: req.source, rejoin: req.rejoin },
    PAD,
    0,
    {
      stages: req.stages,
      onStage: (id, state, ran) => {
        if (!ran) skipped.push(id);
        if (id !== req.drawAt) return;
        // Copied, not referenced: later stages push into these same arrays, so holding the
        // reference shows the end state under every setting of `draw at`.
        const source = state.runs.length > 0 ? state.runs : state.paths;
        for (const item of source) staged.push(item.points.map((p) => p.clone()));
      },
    },
  );
```

The options object is `buildTubeBlueprint`'s optional fifth argument (`index.ts:119`), and it
carries `stages`, `onStage`, `repairs` and `onRepair` together — so Task 13 adds to this same call
rather than making a second one.

The copy is the trap the design names. Verify it: set `draw at` to `generate` and to `sweep` and
confirm the drawing differs. If it does not, the snapshot is aliasing.

- [ ] **Step 2: Add the two controls**

In `instrument.tsx`, add to `Config`:

```ts
  stages: string;
  drawAt: string;
```

labkit's `ConfigFieldType` is `'slider' | 'checkbox' | 'select' | 'number' | 'text' | 'color'`
(`node_modules/@weasel-js/labkit/dist/_dts/types-x92Kfeme.d.ts:2`), so each stage gets its own
checkbox rather than a parsed string. `Config` therefore gains one key per stage, not a `stages`
key:

```ts
interface Config {
  // …existing keys…
  drawAt: string;
  [stageOrRepair: string]: unknown;
}
```

In `requestOf`:

```ts
    stages: new Set(
      TUBE_STAGES.map((s) => s.id).filter((id) => config[`stage:${id}`] !== false),
    ),
    drawAt: (TUBE_STAGES.some((t) => t.id === config.drawAt)
      ? config.drawAt
      : 'sweep') as TubeStageId,
```

Add to `configSchema`:

```ts
    ...TUBE_STAGES.map((stage) => ({
      key: `stage:${stage.id}`,
      label: `run · ${stage.label}`,
      type: 'checkbox' as const,
      default: true,
    })),
    {
      key: 'drawAt',
      label: 'draw at',
      type: 'select',
      default: 'sweep',
      options: TUBE_STAGES.map((s) => ({ value: s.id, label: s.label })),
    },
```

and to `defaultConfig` a `true` per stage plus `drawAt: 'sweep'`.

- [ ] **Step 3: Render the pipeline as a breadcrumb**

`PIPELINE_NODES` and `PIPELINE_EDGES` have to be read by something, or they are a graph written for
a plugin that does not exist yet. The panel reads them: the five stages in order, the one being
drawn marked, the switched-off ones struck through. This is the same structure a flowchart renders
later, and it is how you see at a glance that `draw at` and `stages` are two different knobs.

In `instrument.tsx`'s `render` block, above the measures:

```tsx
        <ol className="junction__pipeline">
          {STAGE_NODES.map((node) => {
            const off = state.skipped.includes(node.id);
            const shown = node.id === requestOf(config).drawAt;
            return (
              <li
                key={NODE_KEY(node)}
                className={`stagechip${off ? ' stagechip--off' : ''}${shown ? ' stagechip--shown' : ''}`}
                title={off ? `${node.label} — switched off` : node.label}
              >
                {node.label}
              </li>
            );
          })}
        </ol>
```

Import `NODE_KEY` and `STAGE_NODES` from `./pipeline.js`. In `styles.css`, `.junction__pipeline` is
a flex row with `list-style: none`; `.stagechip--off` gets `text-decoration: line-through` and
reduced opacity; `.stagechip--shown` gets a border in `INK.staged`. The `>` separators come from
`PIPELINE_EDGES` only when the diagram plugin draws them — a breadcrumb in DOM order already says
the same thing, so use `.stagechip + .stagechip::before { content: '→'; }` rather than walking the
edge list to render arrows nothing can click.

- [ ] **Step 4: Draw the snapshot**

Add a canvas layer to `instrument.tsx`, before `built` so the runs draw over it:

```ts
      {
        id: 'staged',
        draw: (ctx, { state, zoom }) =>
          centred(ctx, zoom, () => {
            for (const span of state.staged) {
              stroke(ctx, span, state.centre, INK.staged, 1.6 / zoom);
            }
          }),
      },
```

Add `'staged'` to the `layers.ids` array in the same order. Add to `legend.ts`:

```ts
  staged: '#5b6cff',
```

and a `LEGEND` entry `{ key: 'staged', label: 'stage output', color: INK.staged }`.

`packages/core/test/dev/kliegsminister/legend.test.ts` (moved in Task 9) pins `INK` against
`LEGEND`; it fails until the entry is added, which is the point of it.

- [ ] **Step 5: Typecheck and look**

```bash
npx tsc -b packages/core/dev/kliegsminister/tsconfig.json
npm --prefix packages/core run dev:kliegsminister
```

Open 5182 and check four things: `draw at` = `generate` shows raw contours; `draw at` = `cut` shows
runs; unchecking `run · geometry` strikes `geometry` through in the breadcrumb and leaves the earlier
stages drawn rather than blanking the tile; and moving `draw at` alone changes the drawing without
striking anything through. That last one is the check that the two knobs are genuinely independent.
Stop the server.

- [ ] **Step 6: Commit**

```bash
git add packages/core/dev/kliegsminister/src
git commit -m "show any stage's output, and switch stages off independently"
```

---

## Task 13: The repair toggles and their ghosts

**Files:**
- Modify: `packages/core/dev/kliegsminister/src/scene.ts`,
  `packages/core/dev/kliegsminister/src/instrument.tsx`,
  `packages/core/dev/kliegsminister/src/legend.ts`

This is what Part A was for.

- [ ] **Step 1: Collect the sites**

In `scene.ts`, add to `SceneRequest`:

```ts
  repairs: ReadonlySet<CutRepairId>;
```

Add a ghost type and put it on `CornerScene`:

```ts
export interface Ghost {
  id: CutRepairId;
  side?: RepairSide;
  /** Geometry the repair would add. */
  added: THREE.Vector3[];
  /** Geometry it would remove. */
  removed: THREE.Vector3[];
  ran: boolean;
}
```

```ts
  /** One per report from the selected corner's neighbourhood; switched-off repairs included. */
  ghosts: Ghost[];
```

Pass the collector into the build alongside `onStage`:

```ts
      repairs: req.repairs,
      onRepair: (id, site, ran) => {
        if (!site) return;
        ghosts.push({
          id,
          side: site.side,
          added: site.points.map((p) => p.clone()),
          removed: site.removed.map((p) => p.clone()),
          ran,
        });
      },
```

Filter to the selected corner before returning, or the whole glyph's reports pile onto one tile:

```ts
  const near = (p: THREE.Vector3) => p.distanceTo(centre) < spec.spacing * 40;
  const ghosts = allGhosts.filter(
    (g) => g.added.some(near) || g.removed.some(near),
  );
```

**A site with empty `added` and empty `removed` cannot be placed** — the exit-side `setback` is one,
reporting only a cursor index. Those drop out of this filter, which is correct for now; a later slice
can resolve an index against the leg it names.

- [ ] **Step 2: Add the toggles**

In `instrument.tsx`, build the switches from `TOGGLE_GROUPS` rather than listing ids:

```ts
import { TOGGLE_GROUPS } from './pipeline.js';
```

```ts
    ...TOGGLE_GROUPS.flatMap((group) =>
      group.ids.map((id) => ({
        key: `repair:${id}`,
        label: `${group.label} · ${id}`,
        type: 'checkbox' as const,
        default: true,
      })),
    ),
```

and in `requestOf`:

```ts
    repairs: new Set(
      CUT_REPAIR_IDS.filter((id) => (config as Record<string, unknown>)[`repair:${id}`] !== false),
    ),
```

`checkbox` is the same control Task 12 used for the stages, so the two groups read alike in the
panel.

- [ ] **Step 3: Draw the ghosts**

Two inks in `legend.ts`:

```ts
  added: '#e08a20',
  removed: 'rgba(209, 69, 59, 0.55)',
```

with LEGEND entries `{ key: 'added', label: 'would add', color: INK.added, mark: 'dash' }` and
`{ key: 'removed', label: 'would remove', color: INK.removed, mark: 'band' }`.

A canvas layer, after `built`:

```ts
      {
        id: 'ghost',
        draw: (ctx, { state, zoom }) =>
          centred(ctx, zoom, () => {
            for (const ghost of state.ghosts) {
              if (ghost.ran) continue;
              stroke(ctx, ghost.removed, state.centre, INK.removed, 7 / zoom);
              ctx.setLineDash([4 / zoom, 4 / zoom]);
              stroke(ctx, ghost.added, state.centre, INK.added, 2.4 / zoom);
              ctx.setLineDash([]);
            }
          }),
      },
```

Add `'ghost'` to `layers.ids`.

Add a readout so a person can tell "reported nothing" from "reported a no-op". In the `render`
block's measures list:

```ts
          {state.ghosts
            .filter((g) => !g.ran)
            .map((g) => (
              <div className="measure" key={`${g.id}:${g.side ?? '-'}`}>
                <dt>{g.side ? `${g.id} · ${g.side}` : g.id}</dt>
                <dd>{`off — ${g.added.length} added, ${g.removed.length} removed`}</dd>
              </div>
            ))}
```

- [ ] **Step 4: Survive self-intersecting geometry**

The design's first trap: a switched-off repair can produce a self-intersecting path, and the tile
must draw it rather than throw. Test it by hand — switch `setback` off with `rejoin` on `bridge`,
which is the 2769-point cascade from the baseline table. Expected: the tile draws a mess and stays
responsive. If it throws, wrap the `buildScene` call in `onConfigChange` and `initialState` so a
failed build shows an empty scene with the error as a `bad` measure rather than blanking the lab.

Also confirm the two knobs are independent: `stretch` off with everything else on must change the
drawing, and switching it back on must return the tile to exactly what it drew before.

- [ ] **Step 5: Typecheck, run, commit**

```bash
npx tsc -b packages/core/dev/kliegsminister/tsconfig.json
npm --prefix packages/core run dev:kliegsminister
```

Check each of the seven toggles moves something on some letter — `hairpin` needs a look that weights
it, and `close` needs a closed contour, so `B` at `tubing` is the letter to try. Stop the server.

```bash
git add packages/core/dev/kliegsminister/src
git commit -m "toggle every repair and ghost the ones switched off"
```

---

## Task 14: `subject`, then the whole-repo check

**Files:**
- Modify: `packages/core/dev/kliegsminister/src/scene.ts`,
  `packages/core/dev/kliegsminister/src/instrument.tsx`
- Modify: `docs/superpowers/HANDOFF.md`

- [ ] **Step 1: Add the subject switch**

`SceneRequest` gains `subject: 'corner' | 'letter'`. In `buildScene`, when it is `'letter'`: skip the
corner-neighbourhood filter on `ghosts`, set `centre` to the glyph's bounds centre rather than the
corner vertex, and put every carried run in `carried` rather than the two either side of the corner.
When it is `'corner'`, everything behaves as it does today.

`configSchema` gains:

```ts
    {
      key: 'subject',
      label: 'subject',
      type: 'select',
      default: 'corner',
      options: [
        { value: 'corner', label: 'one corner' },
        { value: 'letter', label: 'whole letter' },
      ],
    },
```

The `corner` slider and the minimap stay visible under `letter` — the minimap is how you pick the
corner to switch back to.

- [ ] **Step 2: The full check**

```bash
npm run check
npx vitest run
npx playwright test
```

Expected: all green, vitest at 64+ files and at least 1274 tests. `look-tubing` and `look-piping`
byte-identical — the acceptance line says checked at each stage, not only at the end, so a diff
appearing only now means Part B reached shipped geometry, which it must not.

- [ ] **Step 3: Update the handoff**

In `docs/superpowers/HANDOFF.md`, find the paragraph beginning "**Slice 2 is done.**" and append:

```markdown
  **Slice 3 is done and kliegsminister is built.** `dev/corner-lab` is now
  `dev/kliegsminister` (`npm --prefix packages/core run dev:kliegsminister`, port 5182), and its
  `junction` instrument drives `stages`, `draw at`, seven repair toggles, `rejoin` and `subject`
  off the registries through `src/pipeline.ts` — the graph `@weasel-js/diagram` reads when it
  ships. Six repair reports were wrong or missing and are fixed: `RepairSite` carries `removed`
  and `side`, the exit-side `resume` gates and reports, and `hairpin`, the blockout fillet, the
  return it would have carried, and the break-side `stretch` all report now. The lab's
  `blendAcross`/`relaxAcross` are deleted, not moved — core draws all of it.

  **Left for whoever picks this up.** The `setback`-off-under-`rejoin: 'bridge'` cascade is
  **2769 points against 241** on the test square, not the 1505 recorded before; the leg-room math
  assumes the trim happened. The lab reaches that combination and draws it. And an exit-side
  `setback` site reports only a cursor index — empty `points` and empty `removed` — so it has no
  ghost; placing it needs the index resolved against the leg it names.

  **`@weasel-js/diagram` is designed, not built** (`weasel@6827cd04`), blocked on two core changes
  there: derived geometry and stroke markers. It names pipelines as a target and ships a `layered`
  DAG layout. Separately, weasel's animation timeline rig
  (`2026-08-22-animation-timeline-rig-design.md`) is a keyframe timeline on the animator's
  `virtualNow` — that one lands on the **composition lab**, whose timeline lanes were deferred, not
  on kliegsminister.
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "frame the whole letter as well as one corner"
```

---

## Acceptance

Checked against the design's slice 3 lines:

- All seven repairs report on both the sides they act on, switched off included. **Tasks 2–7.**
- Every removal-type site carries the vertices it removed; every `mergeArc` site names its side.
  **Tasks 1–3, 6.**
- All repairs on reproduces today's geometry exactly, including the newly-gated exit `resume`.
  **Task 7.**
- `dev/kliegsminister` builds; tiles survive drawing self-intersecting geometry. **Tasks 9, 13.**
- `scene.ts` defines no repair of its own. **Task 11.**
- The lab's controls derive from the registries, not from a list of ids. **Tasks 10, 12, 13.**
- `npm run check` and `npx playwright test` stay green. **Task 14.**

Not in this slice, by decision: the `setback`/`bridge` cascade, and an actual flowchart.
