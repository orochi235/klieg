# Vertex Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every point in a finished `Run` records the contour vertex it came from, or null where a fillet or biarc built it — replacing the `WeakSet` that currently tracks only the second half of that.

**Architecture:** `Vector3` identity already survives the whole corner stage: `arc` pushes the input's own objects, every stitch primitive slices or pushes existing ones, and `wanderPaths` mutates in place. So `cutIntoRuns` builds a `Map<Vector3, VertexSource>` from its input paths and resolves each run's points against it in one pass at the end. Nothing is threaded through the stitch primitives.

**Tech Stack:** TypeScript, three.js, vitest. Dev labs on React + `@weasel-js/labkit`. Spikes are plain `.mjs` run against `packages/core/dist`.

**Source spec:** `docs/superpowers/specs/2026-08-23-pipeline-lab-design.md`

**Scope:** This plan covers the spec's first landing only. See "What this plan does not cover" at the end.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/core/src/render/tube/runs.ts` | Owns the cut; gains `VertexSource`, `Run.from`, and the resolution pass | Modify |
| `packages/core/src/render/tube/bend.ts` | Fillet and biarc primitives; loses the `AUTHORED` WeakSet | Modify |
| `packages/core/src/render/tube/sweep.ts` | Reads the hold mask from `run.from` instead of `isAuthored` | Modify |
| `packages/core/test/render/tube/runs.test.ts` | Provenance resolution and the structural invariant | Modify |
| `packages/core/test/render/tube/bend.test.ts` | Drops the `isAuthored` assertion | Modify |
| `packages/core/dev/corner-lab/src/scene.ts` | Finds its built run by provenance instead of nearest point | Modify |
| `spikes/*.mjs` (8 files) | Read `run.from[i] === null` instead of `isAuthored(point)` | Modify |

---

## Task 1: `VertexSource` and `Run.from`

**Files:**
- Modify: `packages/core/src/render/tube/runs.ts`
- Test: `packages/core/test/render/tube/runs.test.ts`

- [ ] **Step 1: Confirm the identity assumption still holds**

The whole design rests on the cut never copying a path point. Verify before building on it:

```bash
cd /Users/mike/src/blitsklieg
grep -n "clone()" packages/core/src/render/tube/runs.ts
```

Expected: 13 hits. Every one must be either a scratch vector for arithmetic (`b.clone().sub(a)`) or one of the four `virtual.clone()` calls at lines 305–311, which build the virtual corner fed to `filletAt`. **If any `.clone()` result is pushed into a span, stop — the plan's premise is broken and the resolution pass will silently mark those points authored.**

- [ ] **Step 2: Write the failing test**

Add to `packages/core/test/render/tube/runs.test.ts`, after the existing imports. The file already defines `squarePath()` and `circlePath()`; reuse them.

```ts
describe('vertex provenance', () => {
  it('resolves a run point to the identical vertex of the path it came from', () => {
    const points = squarePath();
    const paths = [{ points, surface: 'front' as const, closed: true }];
    const { runs } = cutIntoRuns(paths, {
      runs: 4,
      minRun: 0.01,
      spacing: 0.02,
      radius: 0.022,
      bend: 2,
    });

    let checked = 0;
    for (const run of runs) {
      expect(run.from).toHaveLength(run.points.length);
      run.from.forEach((source, i) => {
        if (source === null) return;
        expect(source.path).toBe(0);
        // Identical object, not merely equal coordinates: that is what makes the
        // resolution meaningful and what a stray clone would break.
        expect(run.points[i]).toBe(points[source.index]);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('leaves a circle with no null sources — nothing is built where nothing corners', () => {
    const points = circlePath();
    const { runs } = cutIntoRuns([{ points, surface: 'front' as const, closed: true }], {
      runs: 2,
      minRun: 0.01,
      spacing: 0.02,
      radius: 0.022,
      bend: 2,
    });
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) expect(run.from.every((f) => f !== null)).toBe(true);
  });

  it('marks a fillet\'s own points as having no source', () => {
    const points = squarePath();
    const { runs } = cutIntoRuns([{ points, surface: 'front' as const, closed: true }], {
      runs: 1,
      minRun: 0.01,
      spacing: 0.02,
      radius: 0.022,
      bend: 2,
      corners: ALL_CONNECT,
    });
    const nulls = runs.reduce((n, r) => n + r.from.filter((f) => f === null).length, 0);
    // Four corners, each filleted into an arc of at least five samples.
    expect(nulls).toBeGreaterThanOrEqual(20);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd /Users/mike/src/blitsklieg
npx vitest run packages/core/test/render/tube/runs.test.ts -t "vertex provenance"
```

Expected: FAIL. TypeScript reports `Property 'from' does not exist on type 'Run'`, and the assertions on `run.from` throw at runtime.

- [ ] **Step 4: Add the type and the field**

In `packages/core/src/render/tube/runs.ts`, add above `export interface Run`:

```ts
/** Where a run vertex came from, before the cut rewrote the path. */
export interface VertexSource {
  /** Index into the path array handed to `cutIntoRuns`. */
  path: number;
  /** Index of the vertex within that path's own `points`. */
  index: number;
}
```

Then add this field to `Run`, after `points`:

```ts
  /**
   * Index-parallel to `points`: the contour vertex each one came from, or null where the corner
   * stage built it. A null is what `sweepRun` holds fixed through smoothing.
   */
  from: (VertexSource | null)[];
```

- [ ] **Step 5: Resolve provenance in `cutIntoRuns`**

In `packages/core/src/render/tube/runs.ts`, inside `cutIntoRuns`, add the index immediately after the `const draw = ...` line:

```ts
  // Identity, not value: two vertices can share coordinates, and only the object the stitch
  // primitives passed through identifies which one a run point actually is.
  const origin = new Map<THREE.Vector3, VertexSource>();
  paths.forEach((path, p) => {
    path.points.forEach((point, index) => {
      if (!origin.has(point)) origin.set(point, { path: p, index });
    });
  });
```

Then in the `spans.forEach` loop at the end, add `from` to the pushed run object, immediately after `points: piece,`:

```ts
        from: piece.map((p) => origin.get(p) ?? null),
```

- [ ] **Step 6: Fix the eight hand-built `Run` literals a required field breaks**

`from` is required, not optional — an optional field would let `smoothedPoints` fall back to holding
nothing, which smooths a built arc below the bend floor, which is the exact bug this work removes.
So every `Run` written by hand in a test now fails typecheck. Find them:

```bash
grep -rn "lit: true\|lit: false" packages/core/test --include="*.ts" | grep -v "/dist/"
```

Expected: eight hits across `test/render/tube/sweep.test.ts` (5), `test/render/tube/assign.test.ts`
(1) and `test/dev/tube-lab/report.test.ts` (2).

Give each one a truthful source list rather than a filler — a fixture that lies about provenance is
the same trap in miniature. In `sweep.test.ts`, the three helpers at lines 16, 29 and 42 each end:

```ts
  return {
    points,
    from: points.map((_, i) => ({ path: 0, index: i })),
    surface: 'front',
    length,
    index: 0,
    lit: true,
    color: 0xffffff,
  };
```

The two inline literals at lines 116 and 216 take the same `from:` line. Apply the same to the
literals in `assign.test.ts` and `report.test.ts`, using each one's own `points` variable.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npx vitest run packages/core/test/render/tube/runs.test.ts
npx tsc -b
```

Expected: PASS, including the three new tests and every pre-existing one in the file, and a clean
typecheck across the workspace.

- [ ] **Step 8: Verify nothing else regressed**

```bash
npm run check
```

Expected: lint, typecheck and the full vitest suite all pass.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/render/tube/runs.ts packages/core/test/render/tube/runs.test.ts \
        packages/core/test/render/tube/sweep.test.ts packages/core/test/render/tube/assign.test.ts \
        packages/core/test/dev/tube-lab/report.test.ts
git commit -m "resolve each run vertex to the contour vertex it came from"
```

---

## Task 2: The structural invariant that catches a stray clone

**Files:**
- Test: `packages/core/test/render/tube/runs.test.ts`

A future edit that clones a leg point inside the stitch path would give that point no source. It would then read as fillet geometry, `sweepRun` would stop smoothing it, and the mesh would be subtly wrong with nothing thrown. This test converts that into a failure.

The canary is coincidence. A clone is bit-identical to the vertex it copied; an arc the corner stage drew is not. So a sourceless run vertex must sit where no contour vertex already sits. This also catches a resolution bug that drops a source, because that null lands exactly on top of the vertex it came from.

Two things this replaced, both wrong, recorded because the second is easy to re-propose: a null-block-length threshold cannot work, since a clone inside a loop nulls every point that loop touches and so produces a long block rather than an isolated one. And a mutation planted in `mergeArc`'s no-fillet branch proves nothing on a square — every 90 degree corner is hard, takes a fillet, and never reaches that branch.

- [ ] **Step 1: Write the test**

Add to the `describe('vertex provenance', ...)` block in `packages/core/test/render/tube/runs.test.ts`:

```ts
  it('gives a sourceless vertex geometry no contour vertex already holds', () => {
    const points = squarePath();
    const { runs } = cutIntoRuns([{ points, surface: 'front' as const, closed: true }], {
      runs: 6,
      minRun: 0.01,
      spacing: 0.02,
      radius: 0.022,
      bend: 2,
      corners: ALL_CONNECT,
    });

    let checked = 0;
    for (const run of runs) {
      run.from.forEach((source, i) => {
        if (source !== null) return;
        const p = run.points[i] as THREE.Vector3;
        // A clone is bit-identical to the vertex it copied; an arc the corner stage drew is not.
        expect(Math.min(...points.map((q) => p.distanceToSquared(q)))).toBeGreaterThan(0);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(0);
  });
```

The `checked` counter is not decoration: without it the test passes vacuously whenever no fillet is built.

- [ ] **Step 2: Run it and confirm it passes against the current code**

```bash
npx vitest run packages/core/test/render/tube/runs.test.ts -t "sourceless vertex geometry"
```

Expected: PASS. This guards an invariant that already holds — a regression canary, not a driver, so it is green on arrival.

- [ ] **Step 3: Confirm it actually catches the failure it exists for**

A canary that cannot fail is worse than none, because it reads as coverage. Break the invariant deliberately, at a line this test's geometry actually reaches — `mergeArc`'s `if (fillet)` branch, since every 90 degree corner on a square is hard and takes a fillet. The trailing leg loop inside that branch reads:

```ts
    for (let i = from; i < next.length; i++) {
      target.push(next[i] as THREE.Vector3);
    }
```

Change the push to `target.push((next[i] as THREE.Vector3).clone());` and re-run:

```bash
npx vitest run packages/core/test/render/tube/runs.test.ts -t "sourceless vertex geometry"
```

Expected: FAIL. Confirm the line executed rather than assuming it — put a temporary `console.error` beside the push, check it fires, and remove it. Then revert and verify the revert:

```bash
git checkout packages/core/src/render/tube/runs.ts
git diff --stat packages/core/src/render/tube/runs.ts
```

The second command must print nothing.

- [ ] **Step 4: Commit**

```bash
git add packages/core/test/render/tube/runs.test.ts
git commit -m "fail when a run carries a vertex that copies a contour it claims no source from"
```

---

## Task 3: Switch the sweep over and delete the WeakSet

**Files:**
- Modify: `packages/core/src/render/tube/sweep.ts:18-28`
- Modify: `packages/core/src/render/tube/bend.ts:113-127`, `:190`, `:294`
- Modify: `packages/core/test/render/tube/bend.test.ts:329-333`
- Test: `packages/core/test/render/tube/sweep.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/test/render/tube/sweep.test.ts`. The file imports `sweepRun` and
`tightestBend` today, so widen that import first:

```ts
import { smoothedPoints, sweepRun, tightestBend } from '../../../src/render/tube/sweep.js';
```

Then add the test. It asserts the behavior the WeakSet existed for, now expressed through `from`:

```ts
it('holds a sourceless vertex exactly where the run put it', () => {
  const run = {
    points: [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.02, 0.01, 0),
      new THREE.Vector3(0.04, 0, 0),
      new THREE.Vector3(0.06, 0.01, 0),
      new THREE.Vector3(0.08, 0, 0),
    ],
    from: [
      { path: 0, index: 0 },
      null,
      { path: 0, index: 2 },
      { path: 0, index: 3 },
      { path: 0, index: 4 },
    ],
    surface: 'front' as const,
    length: 0.08,
    index: 0,
    lit: true,
    color: 0xffffff,
  };

  const out = smoothedPoints(run);
  // The sourceless vertex is untouched; a sourced neighbour is pulled toward its own neighbours.
  expect(out[1]?.x).toBeCloseTo(0.02, 12);
  expect(out[1]?.y).toBeCloseTo(0.01, 12);
  expect(out[3]?.y).toBeLessThan(0.01);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run packages/core/test/render/tube/sweep.test.ts -t "sourceless vertex"
```

Expected: FAIL. `smoothedPoints` still reads the WeakSet, which this hand-built run never populated, so index 1 is smoothed and `out[1].y` is 0.005 rather than 0.01.

- [ ] **Step 3: Read the mask from `from`**

In `packages/core/src/render/tube/sweep.ts`, replace the body of `smoothedPoints`:

```ts
export function smoothedPoints(run: Run): THREE.Vector3[] {
  const flat = smooth(
    run.points.map((p) => ({ x: p.x, y: p.y })),
    SMOOTH_PASSES,
    'open',
    run.from.map((source) => source === null),
  );
  return run.points.map((p, i) => {
    const f = flat[i] as Point2;
    return new THREE.Vector3(f.x, f.y, p.z);
  });
}
```

Delete the now-unused import on line 2:

```ts
import { isAuthored } from './bend.js';
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run packages/core/test/render/tube/sweep.test.ts
```

Expected: PASS.

- [ ] **Step 5: Delete the WeakSet**

In `packages/core/src/render/tube/bend.ts`, delete lines 113–127 entirely — the docstring, the `AUTHORED` set, `markAuthored` and `isAuthored`:

```ts
/**
 * Points built analytically rather than extracted from the field. The sweep smooths a run to see
 * past the field's staircase, and that filter shaves a few percent off an arc built at exactly
 * `rhoMin` — so authored geometry is held fixed through it instead of being denoised.
 */
const AUTHORED = new WeakSet<THREE.Vector3>();

export function markAuthored(points: THREE.Vector3[]): THREE.Vector3[] {
  for (const p of points) AUTHORED.add(p);
  return points;
}

export function isAuthored(point: THREE.Vector3): boolean {
  return AUTHORED.has(point);
}
```

Then unwrap the two call sites. At the end of `filletAt`:

```ts
  return { points: arc, setback, index, corner: cur.clone() };
```

At the end of `biarcBlend`:

```ts
  second.points.reverse();
  return first.points.concat(second.points.slice(1));
```

- [ ] **Step 6: Update the bend test**

In `packages/core/test/render/tube/bend.test.ts`, delete `isAuthored` from the import block at lines 3–14, and delete the test at lines 329–333:

```ts
  it('marks its points authored, so the sweep holds them through smoothing', () => {
    const { p0, t0, p1, t1 } = quarter();
    const pts = biarcBlend(p0, t0, p1, t1, RHO, SPACING) as THREE.Vector3[];
    expect(pts.every((p) => isAuthored(p))).toBe(true);
  });
```

The property it covered — built arcs survive smoothing — is now covered at the run level by Task 1's fillet test and Task 3's sweep test. There is nothing left to assert about a bare `biarcBlend` return value, so this does not get a replacement in this file.

- [ ] **Step 7: Verify the shipped looks are unchanged**

This is the guard that matters: provenance must reproduce the WeakSet's behavior exactly.

```bash
npm run check
npx playwright test
```

Expected: both green. In particular `look-tubing` and `look-piping` in `apps/lab/test/looks.spec.ts` must match their committed snapshots. **A diff in either means the hold mask changed, not that the snapshot is stale — do not re-record it.**

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/render/tube/sweep.ts packages/core/src/render/tube/bend.ts \
        packages/core/test/render/tube/bend.test.ts packages/core/test/render/tube/sweep.test.ts
git commit -m "hold a built vertex through smoothing by its missing source, not a WeakSet"
```

---

## Task 4: Migrate the spikes

**Files:**
- Modify: `spikes/junction-split.mjs`, `spikes/run-vertices.mjs`, `spikes/kink-autopsy.mjs`, `spikes/join-geometry.mjs`, `spikes/junction-chord.mjs`, `spikes/fillet-view.mjs`, `spikes/where-under-bend.mjs`

Seven spikes import `isAuthored` and now import nothing. Every use is at run level, so the rule is uniform: `isAuthored(run.points[i])` becomes `run.from[i] === null`. Spikes run against `packages/core/dist`, so build first.

- [ ] **Step 1: Build, then confirm the breakage is what you expect**

```bash
cd /Users/mike/src/blitsklieg
npm --prefix packages/core run build
grep -rn "isAuthored" spikes/
```

Expected: hits in exactly the seven files listed above. If an eighth appears, migrate it by the same rule.

- [ ] **Step 2: Drop the import from all seven**

Each file has the same import shape. Change:

```js
import { isAuthored, minBendRadius } from '../packages/core/dist/render/tube/bend.js';
```

to:

```js
import { minBendRadius } from '../packages/core/dist/render/tube/bend.js';
```

In `spikes/fillet-view.mjs` the import is a multi-line block; delete the lone `isAuthored,` line from it.

- [ ] **Step 3: Rewrite the six run-level call sites**

`spikes/run-vertices.mjs:56` —

```js
    `  ${String(i).padStart(3)} ${run.from[i] === null ? 'A' : '.'}` +
```

`spikes/kink-autopsy.mjs:50` —

```js
        .map((k) => (run.points[k] && run.from[k] === null ? 'A' : '.')).join('');
```

`spikes/kink-autopsy.mjs:84` —

```js
      const authored = c.run.points[i] && c.run.from[i] === null;
```

`spikes/where-under-bend.mjs:80` —

```js
      .map((k) => (run.points[k] && run.from[k] === null ? 'A' : '.'))
```

`spikes/junction-chord.mjs:67` —

```js
      const held = run.from.map((source) => source === null);
```

`spikes/junction-split.mjs:53` —

```js
        const authored = run.from.map((source) => source === null);
```

Check the surrounding lines in `junction-split.mjs`: if `raw` is not `run.points`, the replacement is `raw.map((_, i) => run.from[i] === null)` instead, and only holds while `raw` stays index-parallel to `run.points`. Read it before editing.

`spikes/join-geometry.mjs:39` — `p` here is index-parallel to `run.points`:

```js
    console.log(`  ${String(i).padStart(2)}  ${run.from[i] === null ? 'authored' : '   .    '}   ${step.toFixed(5)}` +
```

- [ ] **Step 4: Rewrite the one site that flattens across runs**

`spikes/fillet-view.mjs:90-96` loses the index when it flattens, so it needs restructuring rather than substitution:

```js
      const built = runs
        .flatMap((r) => r.points.map((p, i) => ({ p, source: r.from[i] })))
        .filter(({ p, source }) => near(p, c) && source === null)
        .map(({ p }) => {
          const [x, y] = scale(p, c);
          return `<circle class="built" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2"/>`;
        });
```

- [ ] **Step 5: Run each migrated spike and confirm it still prints**

```bash
cd /Users/mike/src/blitsklieg
for s in junction-split run-vertices kink-autopsy join-geometry junction-chord fillet-view where-under-bend; do
  echo "--- $s ---"
  node spikes/$s.mjs 2>&1 | head -5
done
```

Expected: each prints its usual output with no `ReferenceError` or `TypeError`. The authored/`A` markers must appear in the same places as before the migration — if a spike now shows every vertex as authored, `run.from` is not being read index-parallel to `run.points`.

- [ ] **Step 6: Commit**

```bash
git add spikes/
git commit -m "read a spike's authored markers off each run's vertex sources"
```

---

## Task 5: Retire the corner lab's nearest-point search

**Files:**
- Modify: `packages/core/dev/corner-lab/src/scene.ts`

`buildScene` currently finds the run that carries a corner by walking every run and keeping the one with a point nearest the corner centre, because no index survived the cut. Provenance answers it directly.

- [ ] **Step 1: Replace the search**

In `packages/core/dev/corner-lab/src/scene.ts`, the block beginning with the comment `// What the tube actually builds here, found by proximity rather than by index` currently reads:

```ts
  let built: THREE.Vector3[] = [];
  let authored: boolean[] = [];
  let shipped = Number.POSITIVE_INFINITY;
  let nearest = Number.POSITIVE_INFINITY;
  for (const run of blueprint.runs) {
    for (const p of run.points) {
      const d = p.distanceTo(centre);
      if (d < nearest) {
        nearest = d;
        built = run.points.map((q) => q.clone());
        authored = run.points.map(isAuthored);
        shipped = tightestBend(run) / radius;
      }
    }
  }
```

Replace it with:

```ts
  let built: THREE.Vector3[] = [];
  let authored: boolean[] = [];
  let shipped = Number.POSITIVE_INFINITY;
  for (const run of blueprint.runs) {
    if (!run.from.some((source) => source?.index === corner.index)) continue;
    built = run.points.map((q) => q.clone());
    authored = run.from.map((source) => source === null);
    shipped = tightestBend(run) / radius;
    break;
  }
```

Delete `isAuthored` from the `bend.js` import block at the top of the file.

The `centre` variable is still used by the drawing code below, so leave it. Note that cloning is now safe: the authored mask is read off `run.from` rather than off the points being cloned, which is the workaround this change removes.

- [ ] **Step 2: Handle the corner the cut removed**

A `break` corner deletes its vertex, so no run will carry that index and `built` stays empty — which is a true and useful answer, not a bug, but the readout should say so rather than showing a blank panel. Add to the `measures` array, immediately after the `run ships at` entry:

```ts
    {
      label: 'carried by',
      value: built.length > 0 ? `${built.length} vertices` : 'no run — the cut removed it',
      bad: false,
    },
```

- [ ] **Step 3: Verify against the search it replaces**

The two must agree wherever the old search was right. Run the lab and step through the corners of several letters:

```bash
npm --prefix packages/core run dev:corner-lab
```

Open the printed URL. For each of `B`, `S`, `8`, `M` at both `piping` and `tubing`, step the `corner` slider across its full range and confirm: the `built` polyline still lands on the corner being inspected, `run ships at` reports the same value it did before this change, and the green authored dots sit on the same vertices.

**Take a screenshot before and after the change for at least `B` corner 1 and compare them** — this is a visual behavior change with no test covering it, and "looks about right" is not a check.

- [ ] **Step 4: Verify the build**

```bash
npm run check
```

Expected: green. The corner lab is typechecked by the root `tsc -b`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/dev/corner-lab/src/scene.ts
git commit -m "find the corner lab's built run by vertex source instead of by proximity"
```

---

## Task 6: Record what landed

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the entry**

`CHANGELOG.md` uses a `###` heading and prose under `## Unreleased`, not bullets. Match it — add
this as a new section directly under `## Unreleased`:

```markdown
### A run vertex knows where it came from

Every point in a tube run now records the contour vertex it was extracted from, or null where the
corner stage built it analytically. This replaces the `WeakSet` that tracked only the second of
those, and it is what lets a caller relate a finished run back to the glyph outline — the cut
rewrites the path, so no index survived it before.

Internal to the tube pipeline; no published API changes.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "note vertex provenance in the changelog"
```

---

## What this plan does not cover

The spec has three landings. This plan is the first.

**The stage and repair registries** are not planned here, and deliberately. Turning `mergeArc` into a fold needs a decision the spec does not make: what a repair step receives and returns. The six repairs are not uniform `(span) → span` transforms — `setback` needs the fillet, `stretch` needs the corner decision, `resume` needs both the span being built and the arc arriving next. Inventing that contract inside a plan document would be designing without saying so. It needs its own short design pass, then its own plan.

One constraint that pass inherits from this work, and must not break: **a repair step may drop, reorder or insert points, but must never clone an existing one.** Provenance is resolved by object identity at the end of `cutIntoRuns`, so a clone anywhere in the stitch path silently converts a contour vertex into apparent fillet geometry. Task 2's test is the guard.

**The lab** is not planned here either — its config binds to registry ids and snapshot shapes that do not exist yet.

---

## Self-review notes

- **Spec coverage.** The spec's "Give every vertex a source first" section maps to Tasks 1–3; its two new traps map to Task 2 (stray clone) and Task 1 Step 2's identity assertion. Its acceptance criteria map as: look snapshots to Task 3 Step 7, the null-count invariant to Task 2, `scene.ts` agreeing with the nearest-point search to Task 5 Step 3. The remaining acceptance criteria belong to the registry and lab plans.
- **Not covered by any task, by design:** the registries and the lab, as stated above.
- **Type consistency.** `VertexSource` is `{ path, index }` throughout; `Run.from` is `(VertexSource | null)[]` in the type, the resolution pass, `smoothedPoints`, both tests, all seven spikes and `scene.ts`.
