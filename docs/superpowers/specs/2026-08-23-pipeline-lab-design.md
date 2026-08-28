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

## Give every vertex a source first

`markAuthored` adds analytically built points to a module-level `WeakSet` keyed on `Vector3`
identity, and `smoothedPoints` reads it to hold fillet and biarc arcs fixed through smoothing. A
registry whose steps return fresh spans churns that identity, and the flag vanishes with nothing
thrown: the sweep smooths an arc built at exactly the bend floor and the run ships under minimum.
The corner lab already works around it by reading `isAuthored` before it clones.

Replace it with provenance, which answers the same question and one more. `Run` gains `from:
(VertexSource | null)[]`, parallel to `points`: the path and index a vertex came from, or null where
a fillet or biarc built it. `smoothedPoints` holds a vertex fixed when its entry is null;
`markAuthored` and `isAuthored` are deleted.

Nothing needs threading through the stitch primitives, because vertex identity already survives the
whole cut. `arc` pushes the input's own objects rather than copying; `dropHead`, `dropTail`,
`splitReturn` and `slice` slice; `mergeArc` and `closeLoop` push existing objects; `wanderPaths`
mutates in place. The only clones that reach a span are the virtual corner at `runs.ts:305`, which
feeds `filletAt` and is authored by definition. So `cutIntoRuns` builds a `Map<Vector3,
VertexSource>` from its input paths, and resolves every run's points against it in one pass at the
end.

That map is keyed on object identity, like the `WeakSet` it replaces, and the difference matters:
it is built and consumed inside a single `cutIntoRuns` call and never escapes. Ambient state that
outlives the call is the defect; a local index is not.

Do this on its own, with the look snapshots as the guard, before any registry work.

## The two registries

**Stages.** `TUBE_STAGES` is an ordered array of `{ id, label, run(input, ctx) }` over the ids
`generate`, `wander`, `cut`, `assign`, `sweep`, and `buildTubeBlueprint` becomes a fold over it.
Behavior is unchanged; the sequence is merely named.

**Repairs.** `CUT_REPAIRS` is the same idea one level down, over `fillet`, `stretch`, `setback`,
`resume`, `close`, `return`. Each repair splits into `applies(ctx)` and `apply(span, ctx)`. The split
is the point: with a repair switched off the lab still runs `applies`, so it can draw where the
repair would have fired and what it would have drawn, instead of showing a worse path and leaving
the reader to infer why.

**It is not a fold, and it does not live in `mergeArc`.** This paragraph replaces an earlier draft
that said both; the draft was written from the function names rather than from the call graph, and
measuring it found five independent reasons a linear
`repairs.reduce((span, r) => r.apply(span, ctx), span)` cannot express the corner stage:

- **The accumulator is not one span.** `mergeArc`'s state is the pair (`target`, `next` plus a
  cursor into it). `trimTail` acts on `target`; `indexPast` yields a `start` into `next` that three
  later branches read. `next` is never mutated, deliberately — the same array is the leg for the
  neighbouring corner's decision.
- **Each id fires twice, on opposite sides, with incompatible bodies.** `setback` is
  `trimTail(target, …): void` entering and `indexPast(next, …): number` leaving. `resume` is
  `target.length = keep + 1` entering and `push(next[from..])` leaving.
- **`fillet` is spliced into the middle of `resume`.** The real order is side-major, not id-major:
  entry `stretch` → entry `setback` → entry `resume` → `fillet` → exit `stretch`+`setback` → exit
  `resume`. A fold runs each id once, in id order.
- **Two branches return out of the middle** (the exit-side `bridge` and `relax`). A reducer step
  cannot terminate the fold.
- **`apply` produces output that is not the span.** `decision.at` is written into the
  `CornerDecision` that `stitchPath` returns and `cutIntoRuns` turns into `CornerRecord`s.

**Three of the six never enter `mergeArc` at all.** `close` (`closeLoop`) and `return`
(`splitReturn`) are called only from `stitchPath`, and they are span-*list* operations —
`splitReturn` turns one span into three, `closeLoop` acts on two spans at once — so neither fits a
fold whose accumulator is a single span. `stretch` is two unrelated implementations under one name:
a bare `target.pop()` loop in `mergeArc` and `dropHead`/`dropTail` in `stitchPath`, **with different
floors** (the pop can empty the span; `dropTail` floors at 2). `fillet` straddles both scopes,
decided in `stitchPath` and applied in `mergeArc`. Only `setback` and `resume` are wholly inside
`mergeArc`, and both fire twice.

**`applies` must return a site, not a boolean** — a leg index plus the geometry that would have been
drawn, which is exactly what the lab needs to ghost. `bridgeBefore`/`bridgeAfter` already return
`{ points, at }` and `resumeAt` already returns an index, so the split is genuinely latent for
`resume` — but as *three* candidate providers behind one id (`bridge` → `relax` → walk), chosen by
`rejoin` with fallback.

**The shape that fits** is three registries, not one: a per-side inner pass inside `mergeArc` over
`[stretch, setback, resume]` run twice with `side: 'entry' | 'exit'` in a shared context, the
`fillet` splice fixed between the two passes; an outer registry at the `stitchPath` level for
`close`, `return` and the break-path half of `stretch`; and `hairpin` — a seventh repair the six ids
never named — as a whole-corner alternative that bypasses both.

`cutIntoRuns` and `buildTubeBlueprint` each gain two optional parameters. Slice 1 shipped
`buildTubeBlueprint`'s as `stages?: ReadonlySet<TubeStageId>` and
`onStage?(id, state, ran: boolean)`, typed per level rather than as one `ReadonlySet<string>`
shared by both registries: a caller passing only repair ids into a shared set would switch off all
five stages and get an empty blueprint with nothing thrown. `onStage` fires for switched-off stages
too, so a lab draws a bypassed step rather than a blank panel. Both absent is exactly today's
behavior, which is what every shipped caller passes.

**Two things had to be fixed before a repair toggle meant anything**, both found while measuring the
above and neither caused by the refactor. Both are done:

- **The seed stream keys per corner rather than per draw** — shipped. `stitchPath` used to take one
  draw in `pickStrategy` and a second only when the strategy was `break`, so switching the `fillet`
  repair off shifted the stream for *every later corner in the glyph* and the lab would have shown
  a toggle changing corners it has nothing to do with. Each corner's two draws now key on its own
  index. Forcing the second draw unconditionally is not a separate, output-preserving option: it is
  the same change, and produces byte-identical geometry, because the old key was already `corner +
  breaks before it`. Only `tubing` re-renders — `piping`'s corners never break and every other
  look's always do.
- **A relaxed vertex inherits the leg's provenance** — shipped. `relaxOnto` builds its window with
  `p.clone()`, and those copies resolved to `null` in `Run.from`, which reads as fillet-built and
  stops `smoothedPoints` smoothing them; when the chain already cleared `rhoMin` on the first pass
  it returned them unmoved, so the copies were bit-identical to the leg vertices they stood for. It
  now takes an `inherit` callback and registers each copy against its source in `cutIntoRuns`'s
  provenance map. Threaded explicitly through `stitchPath` and `mergeArc` rather than kept in a
  module-level map, which is the ambient state `markAuthored` was removed for.

`wanderPaths` stays where it is in the order and stays in place. It runs before the cut so the corner
stage sees the bends it introduces, and corner records alias the vectors it moves. It is a stage in
the registry, not a pure one; switching it off is setting amplitude to zero.

## What the lab becomes

It is called **kliegsminister**. `dev/corner-lab` is renamed to `dev/kliegsminister` when it grows
past one corner, along with the `dev:corner-lab` script in `packages/core/package.json`; the
instrument inside it keeps the name `junction`, which still describes what one tile shows.

Extend the existing `junction` instrument rather than adding a third lab. labkit's `Lab` already
renders one trial per record in a grid with clone, reset, snapshot and reorder, so varying samples
needs no design: clone a trial and change the letter. What varies across tiles is whatever is being
chased that session.

The config gains:

- **stage** — which step's output the canvas draws.
- **six repair toggles** — with ghost geometry for the ones switched off.
- **subject** — one hard corner, or the whole letter.

`scene.ts` finds its run by searching outward from the corner, not at it. A hard corner's own vertex
is never carried by any run — being acted on by the cut is what makes a corner hard, so break
deletes that vertex and fillet replaces its whole group with analytic points. Measured across
`ABDEGMNQRSW8` at both looks and all three path sources, 0 of 203 hard corners are carried. Asking
which run holds a corner returns nothing, every time; the vertices either side are carried, within
1 to 13 steps.

Searching outward surfaces what the old nearest-point search hid. **83 of the 203 corners have
carried vertices either side belonging to different runs** — the cut split the path there into two
runs, and proximity silently showed whichever was nearer. The lab draws both, in separate inks. On
the single-run corners the two strategies agree 119 of 120; the one disagreement is a corner where
proximity picked a 9-point run over the 25-point run that actually carries it.

An earlier pass measured 52 splits rather than 83. Both claimed to match on `path` and `index`, so
the discrepancy is unexplained and the 83 is the one the shipped code produces.

`scene.ts` should come out thinner, not fatter. It currently both finds corners and hand-rolls
repairs; `blendAcross` and `relaxAcross` move into core as registry entries, and the lab stops
owning geometry.

## Traps

**A switched-off repair can produce self-intersecting geometry.** That is the point of switching it
off, but the tile has to survive drawing it rather than throw.

**`closeLoop` shifts another span's live array.** Anything that snapshots spans either side of it
sees the earlier snapshot change under it. It has to return new spans before it can be a registry
entry.

**A stray clone in the stitch path reads as authored geometry.** Provenance goes null, the vertex
looks like a fillet built it, and `smoothedPoints` stops smoothing it — a subtly wrong mesh, nothing
thrown. Assert coincidence instead: a clone is bit-identical to the vertex it copied, so a
sourceless run vertex must sit where no contour vertex already sits. Counting nulls against what the
fillets contributed needs plumbing that does not exist, and a null-block-length threshold does not
work — a clone inside a loop nulls every point that loop touches, giving a long block rather than an
isolated one.

**`closeLoop` can be handed the same array twice.** Its call site passes
`closedSpans[0]?.points ?? current` as `head`, so when no return fired on that contour, `head` and
`current` are the same object: it shifts the span's own front and then pushes that shifted first
element onto the span's own end. That vertex now appears twice in one span, so the provenance map
resolves two run positions to one `VertexSource` — the same one-to-many the `slice` trap describes,
arriving by a different route. A pure version has to return both arrays, and must return the *same*
array for both when it was given the same array for both, or the no-return branch loses its shift.

**`slice` shares boundary points.** `cur = [span[i]]` reuses the object, so one source vertex maps
to the end of one run and the start of the next. Vertex to source is unambiguous; source to vertex
is one-to-many, and a reverse lookup that ignores this silently picks one of them.

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
- Every run vertex resolves to a source or to null, and the null count equals what the fillets and
  biarcs contributed — asserted in a unit test, over every letter of the alphabet at both tube looks.
- `scene.ts` finds its built run through provenance, and picks the same run the nearest-point search
  picked, for every hard corner of the alphabet.
- Switching a repair off and back on returns the tile to the built path exactly.
- A repair switched off draws its ghost at the site `applies` reported.
- `npm run check` and `npx playwright test` stay green.
