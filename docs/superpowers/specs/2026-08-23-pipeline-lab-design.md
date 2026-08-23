# Pipeline lab — design

**For:** whoever implements it. **Answers:** how the tube pipeline becomes a list of steps a lab can
switch off one at a time, how far down the pipeline that can go, and what has to be fixed first.

Today `buildTubeBlueprint` is a fixed sequence and the corner repairs are locals inside a 768-line
`cutIntoRuns`. Nothing outside can name a step, so a lab can only vary inputs and look at outputs.
This makes the steps addressable and lets the `junction` instrument toggle them live.

## How far the pipeline can go modular

Steps up to and including the sweep have an input and an output a lab can name and draw, so they
become a registry. Two segments after that do not, and are rendered rather than stepped:

- **Materials.** `tintByRunColor` rewrites GLSL in `onBeforeCompile` and parts the program cache
  with `customProgramCacheKey`. There is no before-and-after value to snapshot — only two compiled
  programs.
- **Assembly.** `Word` and `Stage` own per-frame animation and the GL context lifetime.

Both attach at `WordDebugHooks` (`render/word.ts`), which already exists, is covered by a test in
`test/render/word.test.ts`, and has no consumer. Its docstring refers to a `debug.ts` that is not in
the tree; fix the reference while connecting it.

## Fix authoredness first

`markAuthored` adds analytically built points to a module-level `WeakSet` keyed on `Vector3`
identity, and `smoothedPoints` reads it to hold fillet and biarc arcs fixed through smoothing. A
registry whose steps return fresh spans churns that identity, and the flag vanishes with nothing
thrown: the sweep smooths an arc built at exactly the bend floor and the run ships under minimum.
The corner lab already works around it by reading `isAuthored` before it clones.

Authoredness becomes data. `Run` gains `authored: boolean[]`, parallel to `points`; `smoothedPoints`
reads that instead of the set; `markAuthored` and `isAuthored` are deleted. The mask does not need
threading through the primitives — `mergeArc` already knows which points came from the fillet
because it pushes them, so it is built where the span is assembled.

Do this on its own, with the look snapshots as the guard, before any registry work.

## The two registries

**Stages.** `TUBE_STAGES` is an ordered array of `{ id, label, run(input, ctx) }` over the ids
`generate`, `wander`, `cut`, `assign`, `sweep`, and `buildTubeBlueprint` becomes a fold over it.
Behavior is unchanged; the sequence is merely named.

**Repairs.** `CUT_REPAIRS` is the same shape one level down, over `fillet`, `stretch`, `setback`,
`resume`, `close`, `return`, and `mergeArc` folds over it instead of doing the work inline.

Each repair splits into `applies(ctx)` and `apply(span, ctx) → span`. The split is the point: with a
repair switched off the lab still runs `applies`, so it can draw where the repair would have fired
and what it would have drawn, instead of showing a worse path and leaving the reader to infer why.

Four of the six are already shaped this way — `resumeAt` returns an index, `eatenBy` and `legGap`
return numbers, `dropHead`, `dropTail` and `splitReturn` return new arrays. Only `trimTail` (returns
`void`) and `closeLoop` (mutates both arguments) need real surgery.

`cutIntoRuns` and `buildTubeBlueprint` each gain two optional parameters: `enabled?:
ReadonlySet<string>` and `onStage?(id, snapshot)`. Both absent is exactly today's behavior, which is
what every shipped caller passes.

`wanderPaths` stays where it is in the order and stays in place. It runs before the cut so the corner
stage sees the bends it introduces, and corner records alias the vectors it moves. It is a stage in
the registry, not a pure one; switching it off is setting amplitude to zero.

## What the lab becomes

Extend the existing `junction` instrument rather than adding a third lab. labkit's `Lab` already
renders one trial per record in a grid with clone, reset, snapshot and reorder, so varying samples
needs no design: clone a trial and change the letter. What varies across tiles is whatever is being
chased that session.

The config gains:

- **stage** — which step's output the canvas draws.
- **six repair toggles** — with ghost geometry for the ones switched off.
- **subject** — one hard corner, or the whole letter.

`scene.ts` should come out thinner, not fatter. It currently both finds corners and hand-rolls
repairs; `blendAcross` and `relaxAcross` move into core as registry entries, and the lab stops
owning geometry.

## Traps

**A switched-off repair can produce self-intersecting geometry.** That is the point of switching it
off, but the tile has to survive drawing it rather than throw.

**`closeLoop` shifts another span's live array.** Anything that snapshots spans either side of it
sees the earlier snapshot change under it. It has to return new spans before it can be a registry
entry.

**No index survives the cut.** The corner stage rewrites the path, which is why the corner lab finds
a built run by nearest point. A per-vertex diff across that boundary needs provenance on `Run` —
source path and source index range — or it cannot exist. Out of scope here; do not let a stage
stepper imply it works.

**The sweep returns GPU resources.** A tile that rebuilds on every knob turn leaks without a
teardown. The corner lab's `blueprint.dispose()` is the pattern.

**The lab is dev-only.** The published package must not gain a dependency, and `TUBE_STAGES` must
not become public API surface — the registry is internal, and the lab reaches it the way the corner
lab already reaches `@core/render/tube/*`.

## Acceptance

- Every shipped look renders byte-identical: `apps/lab/test/looks.spec.ts` snapshots, in particular
  `look-tubing` and `look-piping`, pass unchanged after the authoredness fix, after the registries,
  and after the lab work — checked at each, not only at the end.
- With `enabled` and `onStage` both absent, `buildTubeBlueprint` produces the same runs and the same
  geometry as before the refactor — assert on run count, per-run point counts and tightest bend.
- Switching a repair off and back on returns the tile to the built path exactly.
- A repair switched off draws its ghost at the site `applies` reported.
- `npm run check` and `npx playwright test` stay green.
