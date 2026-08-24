# Handoff — klieg, 2026-08-23

**For:** the next session picking this up. **Answers:** what is on `main`, what is in flight, and
what is worth doing next.

## In flight

Two branches, both in the worktree `.claude/worktrees/vertex-provenance`. Neither is merged, and
`main` is nine commits ahead of `origin/main` — **branch from local `main`, not `origin/main`, or
you start without the corner lab or labkit 1.1.**

**`vertex-provenance` — complete, verified, unmerged.** Ten commits. Every tube run vertex now
records the contour vertex it came from (`Run.from`, index-parallel to `Run.points`), or null where
the corner stage built it. Replaces a module-level `WeakSet` keyed on `Vector3` identity that
anything copying a point lost silently. 737 vitest, 24/24 playwright, no snapshot re-recorded. Plan
and findings: [plans/2026-08-23-vertex-provenance.md](plans/2026-08-23-vertex-provenance.md).

**`corner-lab-minimap` — in progress**, stacked on it. A top-right minimap of the whole glyph with
every hard corner clickable. Its viewport rectangle is an indicator only: labkit hands an instrument
`zoom` and `setZoom` and publishes the view read-only through `CanvasStackContext`, but exposes no
`setPan` or `onViewChange`, so drag-to-pan from a minimap cannot be built without reaching past its
public API. File it against labkit rather than working around it.

**Next, unplanned:** the stage and repair registries, then the lab —
[specs/2026-08-23-pipeline-lab-design.md](specs/2026-08-23-pipeline-lab-design.md). The registries
need a design pass first: the six corner repairs are not uniform `(span) → span` transforms, and
what a repair step receives and returns is undecided. **The lab is called kliegsminister**;
`dev/corner-lab` is renamed to it when it grows past one corner.

## State

**`main` carries the tube lab, the tube geometry rewrite, the colour gradients, the junction
reconciliation and direct paths by default, all merged.** `npm run check` green at 736 tests on
`main` (737 on `vertex-provenance`); `npx playwright test` green at 24.

**[Direct tube paths](specs/2026-08-20-direct-tube-paths-design.md) ships, and is the default.**
`TubeSpec.pathSource` (`field` | `exact` | `direct`) defaults to `direct`, which traces the glyph's
own contour rather than rasterising it to a grid — accurate, and ~95x faster to build. The tube
lab's rail still switches it. The remaining bend-minimum failures are below.

**A run's colour now renders.** `assign` had always set `run.color` and nothing ever read it —
`word.ts` gave every lit run one shared material, and both looks hid it by setting `colors` to the
value the material already carried. The sweep writes a per-vertex `runColor` attribute and
`tint.ts` patches the look's own channel from it: emissive for `tubing`, base colour for `piping`,
since three's `vertexColors` only reaches diffuse. `TubeSpec.surfaceColors` is new public API, a
palette per surface. All 24 baselines pass unchanged, which is the claim that published looks did
not move.

**`TubeSpec.gradient` ships.** A colour sweep with six domains, in `replace` or `modulate`; the
[design](specs/2026-08-20-colour-gradients-design.md) has the domain table. Neither shipped look
sets it, so every run is still flat and all 24 baselines are unmoved. A domain is evaluated wherever
its context already lives: `runIndex` and `surface` resolve in `assign` into `run.color`, touching
neither geometry nor shader; `run` and `letter` write a `gradientT` attribute in `sweep.ts`; `axis`
and `radial` are computed in the vertex shader. All six read one ramp texture, which the `Word` owns
and disposes — `material.dispose()` cannot reach a texture that lives only in a uniform
`onBeforeCompile` added. `spikes/gradient-presets.mjs` draws every preset as an SVG page, and stops
get tuned there before a look changes. With bloom on the glow fills a dim run end, so the
`electrode` preset reads close to flat at panel size; that is the interaction, not the ramp.

The geometry model is in `docs/superpowers/specs/2026-08-19-tube-geometry-design.md`, and its
`## Acceptance, as measured` section has the numbers. In short: the tube holds one diameter, corners
are classified by bend radius and filleted with a tangent arc at the material's minimum, run ends are
sealed, a corner can carry the tube past the light unlit rather than cutting it, and the loop
strategy is gone. One run of 225 on `tubing` and one of 49 on `piping` still bend tighter than
their look's minimum, against every `piping` run clamped before.

**A limb rim ships.** `rim`, 0..1 on a tube decoration's material spec, scales the emissive by
`1 - rim * ndv` over that profile's own mean `1 - rim * pi/4`, so a run reads as a cylinder rather
than a flat ribbon while the tube's width still averages to the emissive the look asked for. Without
the mean the rim sinks all of `tubing` under the bloom threshold. No shipped look sets it; absent or
0 emits the GLSL that shipped byte for byte. The tube lab's rail has the knob.

**The lab runs on labkit now**, which owns the tiling: `WorkspaceGrid` gives it a windease grid with
draggable seams and drag-to-reorder, and klieg's own split tree and direct windease dependency are
gone. The renderer is unchanged — sixteen panels, one WebGL context, a scissor rect each — but the
rects are measured from the tiles rather than read from placements.

**`@weasel-js/labkit` comes from the registry at `^1.0.4`**, which is where the windease tiling
shipped. The `file:` dependency on `~/src/weasel/packages/labkit` is gone, and with it the lab's
vite config: `fs.allow` and the react/react-dom aliases existed only because a linked package
resolves React out of its own tree, which is an "invalid hook call" from inside labkit. `npm
install` here no longer needs a weasel checkout.

**A second lab, `npm run dev:corner-lab -w klieg`, is where corner work happens now.** It is a
labkit instrument: pick a letter, look and path source, step through that letter's hard corners, and
switch what the corner draws — `built` (what ships), `merge` (leave the path alone), `relax` (push
the vertices out until they clear), `biarc`, `cut`. It reports the glyph's own bend, how far under
the floor it is, the junction chord and radius, and a radius profile either side, all against the
floor circle at true scale. Two static spikes are frozen versions of it and can go once it grows:
`junction-repair.mjs` and `fillet-view.mjs`.

**labkit 1.1 fixed every gap the corner lab reported**, so the workarounds are gone: `render()` is
now an overlay beside the canvas rather than an alternative to it, layers draw in world coordinates
with the camera already applied, a typed instrument no longer needs a cast, and `styles.css` carries
the host reset its own sizing assumes. 1.1 also renames a lab's tile from workspace to trial, which
is why the tube lab draws `<Workspace>` and styles `.lk-trial-tile`. Two gaps remain open in
`~/src/weasel/packages/labkit/docs/IDEAS.md`, uncommitted: `initialView.pan` is a screen offset an
instrument cannot know, so centring leaks back into the layer.

Run it with `npm run dev:tube-lab -w klieg` — sixteen panels on one WebGL context, one letter
each, `beauty` / `skeleton` / `ramp`, with a rail that tunes the whole `TubeSpec`. Every control
carries a hover hint saying what it does and what it interacts with badly, which is the fastest way
back into the model. Sliders that mark a real boundary have a stop the drag catches.

**Some rail controls are honest about very little, and the hints say so.** `runs` is a request
pinned between the corner count below and `minRun` above — at `bend` 4 it is pinned across its whole
range. `wall depth` and `wall rise` do nothing under either shipped look, both being front-only, and
the `surface` gradient domain is inert for the same reason. A positional gradient's bounds are per
`Word`, and every panel is its own one-letter word, so an `axis` sweep restarts in each panel rather
than running across the grid. `spikes/slider-sensitivity.mjs` sweeps every field and counts distinct
outputs; use it before believing a control does what its name says.

The spikes are the fast way back into any of it: `bend-acceptance.mjs` is the invariant across the
alphabet, `where-under-bend.mjs <look> <letters>` says whether a bad bend is inside a fillet, at a
join, or on plain path, `run-vertices.mjs` dumps one run, `corner-width.mjs` measures corner
stretches against a synthetic control, and `fillet-view.mjs` draws the corner stage's decisions as an
SVG page. For the path source work: `join-geometry.mjs` dumps a failing run per vertex,
`source-shootout.mjs` is the acceptance across all three sources, and `run-decomposition.mjs` shows
how the source changes the cut. The spec lists the rest.

## What is worth doing next

Roughly in order of value; the items are independent of each other.

- **Playwright reuses whatever owns port 5180, so a run in one worktree can test another's code.**
  `playwright.config.ts` sets `reuseExistingServer: !CI` against a hardcoded 5180, and vite's port
  is not strict — so a second checkout silently slides to 5181 while every probe keeps hitting the
  first. It fails silently and returns confident wrong answers: a session in
  `.claude/worktrees/vertex-provenance` ran its suite against main's dev server and got four bogus
  failures before noticing. Both halves need fixing — the reuse and the non-strict port. Until then,
  any visual run taken while another checkout's server is up is invalid, in either direction.
- **`visual.spec.ts` is flaky under parallel load.** `bloom path` and `two-line block` fail
  intermittently in the full suite and pass 4/4 in isolation. It predates the particle work —
  `two-line block` was seen failing before the `index.ts` changes existed. Both read the whole
  drawing buffer inside rAF and assert on a single sampled frame, which is the likely cause.
- **`K` and `k` have non-parallel arm sides, and the bevel is what makes it visible.** In Archivo
  Black's own outline the arm's two long edges are 1.31° apart on `K` and 2.56° on `k`, and both
  terminals are cut flat-horizontal — 39.8° off square to the arm. That is the typeface, not klieg:
  the contour seam is at the inner crotch (295, 394), nowhere near the top-right. But a bevel lays a
  constant-width highlight along each edge, so two edges that diverge by a degree produce a visibly
  tapering strip. Three ways out: swap the face, regularize outlines at load (klieg correcting a
  typeface, and it would touch every glyph), or leave it — in motion at display size it reads as a
  highlight taper rather than a defect.

- **The last bend-minimum failure is a junction defect, and it is wider than three corners.** See
  [tangential junctions](specs/2026-08-22-tangential-junctions-design.md), which has the mechanism,
  the five things tried and what each cost. In short: `resumeAt` clears the invariant by lengthening
  the chord between the leg and the arc, which raises circumradius without touching the direction
  mismatch — filling that chord drops `piping`'s `B` from 2.00r to 0.93r. Admitting only tangential
  junctions fixes every failure and refuses four fillets in five, so it redraws the alphabet;
  everything narrower fixes one corner and opens another. `junctionRadius` and `biarcBlend` are
  built and tested in `bend.ts` but deliberately not wired, and the doc says why.
- **Only `piping`/`direct` `B` fails in a shipped configuration.** The `exact` and `field` failures
  need a lab-only path source, and `tubing`'s `R` at 1.996r is wander — it vanishes at
  `amplitude: 0`.
- **`sequin` is applied the wrong way round and should be reworked before it is tuned.** See below.
- **The back-cap chunk waste is not worth fixing — measured, and struck from this list.** About a
  quarter of `sequin`'s chunks land on the back cap (25.1%; the same measurement put the deleted
  `pyrite` at 27.9%), but it costs nothing: real-GPU median frame time was 2.2–2.3 ms whether a
  chunk look drew 55 chunks or 1. Rejecting back-facing samples would raise visible chunks per
  letter by 39% and leave only 8.8% of positions surviving the reseed — a look change dressed as an
  optimization. The back cap is also genuinely on screen during two shipped enters.
- **`flip` drops opacity 171° from rest**, so the letter fades in nearly back-on — the opposite of
  what the step's own comment claims. `easeOutCubic(s)` hits 0.05 far later than the author expected.
  Small, self-contained, and a real defect rather than a taste question.

## What was learned that is not in the plan

- **`M` and `W` are the worst case, not `N`.** The standing `NSRE` string missed both extremes: `M`
  bends at 0.32 of its own tube radius and `W` at 0.38, against `N`'s 0.44. Every acceptance check
  uses `MWNSRE`. The tube lab's default letters are `MWSB` for the same reason. `piping` wants
  `QXY` instead — it traces inset at `level: -0.015` onto a different contour, so no one string
  serves both looks.
- **`ρmin` sits above `ρstyle`, and the spec's two-class model breaks on it.** At `bend = 2` the
  stylistic band is empty, and a corner between `ρstyle` and `ρmin` is hard yet above the detection
  threshold — never seen, never fixed, silently violating the invariant. 13 such corners on `tubing`
  at `bend = 2`, **174 at `bend = 3`**, widening linearly, so the failure got worse exactly as
  someone tuned toward stiffer material. Detection now runs at `max(ρmin, ρstyle)`. A genuinely
  stylistic class requires `bend < 1.76`, not a change to `ρstyle`.
- **`bend` does not classify — it sets setback.** 2 and 3 give near-identical hard-corner counts.
  What moves is the fillet setback and so the fallback rate. Tune against the rejected-fillet count,
  never the corner count.
- **Filleting is the ordinary path**: 228 hard corners on `tubing` and 244 on `piping`, across all 26
  letters of both. Robustness in the common case, not correctness in the rare one.
- **A corner is a stretch because of resampling, not because of the field.** `spikes/corner-width.mjs`
  measures a square with no distance field anywhere near it: arc-length resampling splits a perfectly
  sharp corner across two vertices whenever a sample does not land on it, which is the generic case.
  The direct contour carries the same stretches, and the same 20-degree shoulder outside them. Group
  filleting is needed at either fidelity, and **path fidelity neither blocks nor is blocked by this
  work** — the ordering question the spec reopened is closed.
- **The corner keeps turning past its stretch.** That shoulder is why a leg direction is averaged over
  four segments rather than taken from the segment next to the corner.
- **The field manufactures corners, so a path source change is a look change.** Its wobble creates
  corners that are not in the glyph, every corner is a candidate break, and stripping it roughly
  halves the corner count. The cut then lands elsewhere and `assign` paints a different lit pattern
  from the identical seed — tubing's `S` goes `OxO.xO` to `OO.OOx`. A look reads differently under a
  different source even though its path is the same shape, so numbers tuned against one do not carry
  to the other. `spikes/run-decomposition.mjs`.

## Traps

**Eliminate a cheap hypothesis about render state before an expensive one about geometry.** The tube
vanishing when thinned was diagnosed twice as a geometry bug and was one line of render state: a
`transparent` material still writes depth by default, so tubing's 0.08 backing was culling its own
tube. `519ae45` has the detail.

**`tightestBend` smooths three times before measuring**, calibrated for the distance field's
staircase noise. On a coarsely sampled arc it shrinks the radius about a tenth — enough to fail the
invariant it is checking. Fillets are sampled at half `spacing` for that reason, and authored points
are held out of the smoothing entirely (`markAuthored` / `isAuthored` in `bend.ts`). Anything else
that builds exact geometry into a run needs the same care.

**Smoothing masks raw kinks.** Holding fillet points fixed made joins fail that had looked fine,
because the filter had been rounding them off. A green measurement through a smoother is not evidence
the path is clean.

**A room test measured on geometry the merge does not build passes on nothing.** The fillet was
computed twice from different inputs, so the check validated an arc that was never spliced.

**Trimming a leg back by accumulated step length leaves a point *inside* the setback**, so the path
runs forward to it and then jumps back to the tangent point. That reversal reads as a *tighter* bend
than the corner it replaced. Trim by distance from the corner instead.

**A test fixture's sampling spacing is load-bearing.** Bend radius is `s / (2 sin(θ/2))`, so a 90°
turn at 0.1 spacing is a 0.071 em bend — wider than a 0.03 tube need bend, and no corner is found at
all. Sample fixtures at the pipeline's own 0.02.

**A per-pixel `threshold` is what decides whether a visual baseline can see a change at all**, and
the pixel-count ratio cannot substitute for it. Playwright's default 0.2 hid bloom entirely.
`--update-snapshots=all` rewrites **every** baseline, so grep to the ones that move.

**The visual suite cannot see `piping`'s cord.** It traces inset at `level: -0.015`, so the cord is
inside the letter body in both framings and both its baselines are blind to the change that matters
most for that look. Judge piping by `spikes/bend-acceptance.mjs` or a lab capture.

**A bloomed look at DPR 2 can exhaust Playwright's default 5s screenshot budget** while the stability
loop waits for two consecutive frames. `shoot()` passes `timeout: 20000`, and an occasional single
failure on `tubing` is this rather than instability — re-run before believing it.

**A positional gradient's bounds must be mutated, not reassigned.** The compiled shader aliases the
`Vector4` and `Vector2` sitting in `material.userData`, so a `regroup()` that hands over fresh
vectors leaves every already-compiled letter reading the pre-regroup mapping.

**The per-vertex gradient parameter is arc length, not ring index.** `ringsOf` domes each end with
4 cap rings covering about one `radius` of length, so a ring-index parameter gave a 25-point run 25%
of its range on caps that are 11% of it, and the share moved with point density. Ring index squeezes
`electrode`'s dim ends onto the domes.

**Never add `opacity` to `LookKey`.** `Word` rewrites `material.opacity` every frame, so a value
applied through `PARAM_KEYS` is gone by the first tick — and it would pass any test that never calls
`apply()`.

**Do not `git add -A`**, and do not chain `npm run check && git commit` through a `grep` — the grep
succeeds and the failed check is swallowed.

## Verify by mutation

The tube lab plan's two-stage review found a defect on all nine of its tasks, and the single
highest-yield instruction was "verify this by mutation". It has held on everything since:

- Two tests written for the geometry work passed with the code under test **deleted**. A closed-path
  seam test needed a superellipse sampled finely enough that corners span several vertices before it
  could bite; a square with single-vertex corners never straddles the seam at all.
- A `report.ts` predicate comparing bend radius against the *tube radius* instead of `ρmin` returns
  plausible booleans rather than failing, on the very panel used to judge whether the model worked.
  There is now a test whose fixture sits between the two so it discriminates.
- The plan's own mutation instruction for the wander cap had the direction backwards: `budget` is in
  the denominator, so raising it *tightens* the cap. Corrected in the plan.
- The path source work reached both its findings by a wrong turn first: the junction defect read as
  a fidelity problem, and the contour offset's first fix broke the outer contour instead of the
  counter it was aimed at. A number that agrees with the hypothesis is not evidence until the code
  under it has been deleted and the number moved.

## `sequin` is applied the wrong way round

The chunk generator samples surface points and sticks a chunk on each — dip it in glue and roll it in
sprinkles. That is right for `glitter`. It is wrong for `sequin`, which should read as discs sewn flat
onto a garment.

Four qualities the rework needs, and what each costs today:

- **Thin.** A sequin is a disc, not a nugget. `shape: 'flake'` has one `size` and no separate
  thickness, so thinness is not expressible yet.
- **Oriented parallel to the surface.** `align` does not do this — it is "0 free tumble, 1 one shared
  lattice per letter" (`decoration.ts:26`), which shares one orientation across a letter rather than
  following the surface normal. `sequin` sets `0.1`, so its flakes tumble freely. **No parameter
  expresses surface-parallel orientation; this is a new capability, not a value change.**
- **Flush on the surface.** `proud` is "how far a chunk sits proud of the surface, 0..1", and `sequin`
  sets `0.35` — a third of each flake stands off. Sewn sequins sit at ~0.
- **Regularly distributed.** `cluster` is "0 even scatter, 1 tight intergrown clumps"; `sequin` sets
  `0.2`. Note that `0` buys *random* even scatter, not *regular* spacing — real sequins are sewn in
  rows or a near-uniform lattice, which random sampling will not produce however low `cluster` goes.

Two measurements from the deleted `pyrite` look describe `sequin` too, since both ran on this
generator:

**Placement is weighted by triangle area, and the extrusion band wins.** `pyrite` put 59.2% of its
chunks on the band against 12.9% on the front cap, which is why it read as an outline effect rather
than a treated surface. `sequin` is sampled the same way. Weighting placement by *visible* area
rather than surface area is the change that would move it.

**Size and embedding are single values.** Every chunk is one `size` at the same `proud` fraction, so
the field has no scale variation.

`POOL = 512` in `decoration.ts` bounds distinct positions, and the clustering draw scans the whole
pool per chunk, so raising it makes placement quadratic. `sequin` now asks for 400 of those 512 —
little headroom, and regular spacing may want more positions rather than fewer.

**Its current numbers are provisional.** `78ba362` moved `sequin` to 400 chunks at 0.045 em from 90
at 0.055 and dropped its clearcoat, tuned to make a nugget field read well and without this section
in view. Once the primitive is a flush disc they are the wrong numbers: re-derive them, and expect
to move the `look-sequin` baseline.

## A known limitation of the lab

A spec change rebuilds all sixteen cells, ~1.45s front-only and ~2.85s with `back`/`wall`/
`connectors`. Sliders commit on release, so a drag costs one rebuild rather than twenty — but a single
step still waits. The honest fix is not rebuilding a whole `Word` per cell for a spec change.
