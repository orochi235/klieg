# Handoff — klieg, 2026-08-25

**For:** the next session picking this up. **Answers:** what is on `main`, what is in flight, and
what is worth doing next.

## In flight

**`sign-wrapper`, seven of twelve tasks done, unpushed.** Worktree `~/src/klieg-worktrees/sign-wrapper`,
cut from `origin/main` (which carries `framing.align`). It builds two entry points over `createKlieg`
for a **sign** — type standing in for a page heading, lit once, held until removed.

The [design](specs/2026-08-26-sign-wrapper-design.md) and [plan](plans/2026-08-26-sign-wrapper.md)
are current and carry every decision. Read them rather than this. What follows is only what they
cannot say.

**Done:** `hold: 'forever'` in core; jsdom per-file; `resolveTint`; `sign()`; `<klieg-sign>` with its
attribute layer. **Left:** the subpath exports and `sideEffects` (Task 8), the standalone bundle
(Task 9), a lab page at `/sign/` (Task 10), the playwright spec (Task 11), README and CHANGELOG
(Task 12).

**The plan was written against the wrong branch in one place.** It named `LightingSlot`, which exists
only on the unmerged `composable-lighting` work; `origin/main` has `LightingName`. Corrected in both
docs, but expect other drift if you copy code out of the plan without compiling it.

**Three element behaviors are deliberate and undocumented until Task 12.** Removing an attribute
actively *unsets* its setting: the element keeps a ledger of the keys it last sent and patches a
dropped one back to `undefined`, so `toggleAttribute('bloom')` really does turn bloom off rather than
leaving the old value lit. The `look` *property* beats the `look` attribute, so a page driving both
sees the attribute change re-fire with the property's value. And `bloom="false"` means off while any
other value means on — an invented convention, kept because `bloom="${on}"` stringifies to `"false"`
and nothing else could express off.

**`align` is validated in the element; `lighting` deliberately is not.** An unknown align is silently
*wrong* — `edgeFor` resolves it to the right edge in an ltr document rather than the `start` default.
An unknown lighting throws and surfaces as a `console.warn`. Validate where garbage is silently
wrong, pass through where it fails loudly.

**A vitest defect shapes the element tests.** The second of two *concurrent* `import()` calls of a
`vi.mock`'d module never settles, and worse, falls through the mock into the real module graph — which
produced an intermittent `EnvironmentTeardownError` blamed on `element.test.ts`. Mount elements
sequentially, or in the same task only when no dynamic import can start (the `readyState: 'loading'`
trick in the stylesheet test). Do not "simplify" those tests back into one `innerHTML`.

**`document.head` is not reset between tests.** `beforeEach` clears it explicitly; without that the
stylesheet idempotence guard short-circuits and both stylesheet tests silently assert nothing.


**`selectable-text`, complete and unmerged.** 14 commits off `main`, nothing uncommitted, not
pushed. `npm run check` is green at 977 unit tests and `npm run test:visual` at 33. It implements
[the design](specs/2026-08-25-selectable-text-design.md) in full — one `FireOptions.selectable` of
`'hidden' | 'layer' | 'none'`, defaulting to `'hidden'`. The next step is a PR; nothing is
half-done.

Three things the branch knows that the design doc does not:

**The Playwright suite is the only evidence any of this works.** The unit harness stubs
`Stage.mount`, so `stage.textLayer` is never set and no unit test has ever seen one of these DOM
nodes exist. Every defect below was found by `npm run test:visual` and none by the 977 unit tests.
Treat a green `npm run check` as meaning nothing here.

**Three of the browser tests were rewritten because they were vacuous.** `document.body.innerText`
contains the lab's own `#log`, which prints `fire "BIG"` — so the obvious `'hidden'` and `'none'`
assertions pass with the feature deleted. The alignment test now reads the drawing buffer's alpha
bounding box and compares span boxes to rendered pixels, because loose viewport fractions passed
with the layer 80px off its glyphs. Span centres agree with ink centres within ~3px.

**The visual suite is load-flaky, and this predates the branch.** `fireStill`'s 200ms sleep and
`fire`'s 4000ms hold lose to the first fire's shader compilation when the machine is busy — the
layer was measured appearing 1.7–5.9s after FIRE. Under load average 97 that failed 4–8 tests
including the click-through guarantee, with the canvas never attaching. The new tests poll instead
of sleeping. Converting the old ones is worth doing before CI trusts them.

## Two consumer defects, found from outside, both fixed

Reported by the portfolio session, which builds the michaelbaker.tech masthead against published
klieg. Both shipped in 0.6.0; both are fixed on `main` and independently re-verified by the reporter
against a build of `08316c7`. Kept here because each has a trap that outlives the fix.

**`tint` never reached `tubing`.** The tint went to the decoration material's colour channel, and
`tintByRunColor` sets that channel to white so a run's per-vertex colour multiplies out exactly —
so the tint was gone before the first frame. It now recolours the palette the runs are dealt from,
which is where a tube look's colour actually lives, so it survives by construction rather than by
call order and composes with the effects compositor instead of racing it.

*Not replace-versus-modulate,* which is how the question first arrived. No shipped look sets
`surfaceColors` and both tube looks carry a single-colour palette, so there was no per-surface
shading for `modulate` to protect — it would only have returned a dimmer tint than was asked for.
Checking that collapsed the decision.

**The tint's value does not survive to the screen, and its hue does.** The palette entry is exactly
the tint; the pixels are that through the look's emissive gain and then bloom — a bloomed tube
measures `#5BFDFD` at the blown core and `#227787` along the run for a `0x22d3ee` tint. Do not write
a test, or a doc line, asserting a literal pixel value.

**`LookParams` collapsed to `{}` for any TypeScript consumer.** `looks.d.ts` emitted `LookKey` as a
live `Extract<keyof THREE.MeshPhysicalMaterial, …>`, so the *consumer* re-evaluated it; three ships
no `types` condition in its exports map, so without `@types/three` it resolved to nothing, `keyof`
collapsed, and every material property vanished from `LookSpec`. It ships as a literal union now,
with the `Extract` kept as a repo-side assertion — that check only ever worked where `@types/three`
is installed, which is here and never in a consumer's build. `@types/three` is also an optional peer
dependency.

**A consumer repro that does not assign into a typed position proves nothing.** `const x = { ...look,
emissive: 1 }` typechecks against the *broken* package: excess-property checking only fires on
assignment to a typed target. The first repro written for this passed on 0.6.0 and would have
"verified" a non-fix.

**`spikes/tint-matrix.mjs` is the guard.** It renders every look with and without a tint and compares
md5s — a tint that never reaches the GPU leaves the image byte-identical — and exits non-zero when
any look ignores its tint. It holds the *untinted* renders fixed at the same time, which is what
catches a fix that recolours a look generally rather than only when tinted. `spikes/tint-matrix-0.6.0.md5`
carries the published-0.6.0 hashes as a fixed point; the PNGs are gitignored because the registry
artifact is immutable and the script regenerates them exactly.

## State

**0.6.0 is published and is `latest`**, carrying the wide-anchor lens fix and the `flip` opacity
fix. Releases are automatic: push a `v*` tag and `release.yml` publishes through npm trusted
publishing, checking first that the tag matches `packages/core/package.json` and skipping a version
already on the registry. `npm view` reports a stale version straight after a publish — read
`https://registry.npmjs.org/klieg` to see what actually landed.

**`main` is four changes ahead of 0.6.0 and untagged**, all under `## Unreleased` in the CHANGELOG:
`crawl` and the `chase` piece, the `LookKey` literal union, and the `tubing` tint fix. **That wants
a minor, not a patch** — `chase` adds a name to `EFFECT_NAMES` and `ChaseSpec` to the public surface,
and the tint fix changes what renders for anyone tinting `tubing`. Not tagged: the call had not been
made. The portfolio session asked to be told before a tag goes up, and since releases are
tag-triggered there is a window between telling them and pushing it.

**`main` carries the tube lab, the tube geometry rewrite, the colour gradients, the junction
reconciliation, direct paths by default, element-anchored placement and the effects pipeline, all
merged.** On `main`, `npm run check` is green at **938 tests across 50 files** and `npx playwright
test` at **26 across 2 files**, both measured at `967408e`. Every count in this doc is
measured, not carried over — it has twice claimed a playwright number one higher than `--list`
reports.

**A wide anchor takes a longer lens.** An element placement lifts `FIT_CAP` so the word fills its
anchor, and against a masthead strip that put the outer glyphs past 70 degrees off-axis — far enough
that an extruded letter's side wall projects across its neighbour and the word reads as one merged
mass. `lensFor` in `render/stage.ts` grows `z` until the frustum edge falls within
`MAX_HALF_ANGLE_DEG` (35) and narrows `fov` to hold the frustum height at the word's depth, so every
framing fraction keeps its meaning and the type keeps its on-screen size. A box already inside that
angle keeps the base lens exactly, so a fullscreen overlay is byte-identical and no baseline moved.
Unreleased — it is in the CHANGELOG under `## Unreleased`.

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

**The corner lab has an ink key now, and labkit is not getting one.** `FloatingPanel` and `Legend`
were **deferred upstream**, so [the legend plan](plans/2026-08-23-corner-lab-legend.md) cannot be run
as written: labkit 1.2.0 published without them, and windease's `floatingStrategy` is built in source
but never released — the registry is at 1.2.1. klieg grew its own `LegendPanel.tsx` instead, static
rather than draggable, with `LegendEntry` declared locally. The plan's header records which of its
tasks are void, so the upstream chain does not need walking again.

`legend.ts` holds the ink table and the key together, and a test asserts every drawn ink has an
entry. It earned itself on the first run: the lab had gained a ninth ink, `frame`, after the plan was
written, and the drift check caught the missing entry.

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

**`crawl` shipped, and the design was wrong twice.** A `chase` piece drives it and the offset reaches
the shader as a per-vertex float beside `gradientT`, not as the uniform the design specified — a
uniform is per-material and every lit run of a letter shares one, so a per-part crawl cannot be one.
And the ramp is `ClampToEdgeWrapping` with the shader clamping, so the design's crawl would have
pinned a run to the ramp's last colour within half a cycle and stayed there. It wraps with `fract`,
**conditional on a non-zero crawl**: a run's last vertex sits at `gradientT` 1.0 exactly and
`fract(1.0)` is 0.0, so wrapping unconditionally snaps every ramp's end to its start and moves every
baseline. Both faults came out of running it; neither was visible in the prose.

**Crawl is inert on both shipped looks**, which declare no `gradient`. No visual baseline can show it
working — it needs a caller-supplied `TubeSpec.gradient`.

## What is worth doing next

Roughly in order of value; the items are independent of each other.

- ~~**Selectable text**~~ — built. See the `## In flight` section; it wants a PR, not a plan.

- **Composable lighting, asked for directly and decided in conversation. Nothing is designed yet.**
  Today `lighting` takes one of three names and every number behind them is a module constant no
  caller can reach: `sweep`'s `periodMs: 3400`, and `pointer`'s `YAW_RANGE`, `PITCH_RANGE` and
  `FOLLOW_MS` (`render/lighting.ts`).

  Two decisions are made. **Lighting becomes composable pieces, the way motion already is** — a
  piece is a function of `(t, pointer)` returning an offset that accumulates, with the built-in
  names as presets, so `['sweep', lamp({ … })]` layers them the way an `active` slot layers motion.
  And **both pointer modes ship**: the existing one, and a genuinely positional light.

  The distinction that motivated the ask: `pointer` today is not a light anywhere. It maps the
  cursor to `scene.environmentRotation` — x to yaw over ±90°, y to pitch over ±20° — which is one
  scene-wide value, so hovering over the **K** does not light the K any differently. It turns the
  same knob `sweep` turns, from position instead of time. A cursor that actually lights the letter
  under it needs a real light with a position and falloff, which is the second mode, and which
  will need per-look tuning: `gem` reads through transmission and `tubing` is emissive, so a lamp
  tuned on `gold` may do nothing on either.

  Two things to fold in rather than leave beside it:

  **`PointerLight.aimAt` normalizes against `globalThis.innerWidth/innerHeight`** — the viewport,
  never the canvas box. Under `placement: element` an anchored sign in a 400px box on a 1600px page
  only ever sees a slice of the yaw range, and a cursor dead-centre on the type does not centre the
  highlight. A plain bug, fixable on its own if the redesign stalls.

  **`slotDrivesEnv` becomes redundant.** A motion piece can currently declare `envRotation: true`
  to hijack the environment (`index.ts`, the `envDriven` branch); composable lighting gives that
  intent a real home, and leaving both would be two ways to drive one thing.

- **A composition lab, so effect pieces get built by hand rather than through a plan.** Asked for
  directly. `roving` and `hue` were specified in prose, and the wrapper's epoch arithmetic came out
  wrong in a way that read as *more* correct than the fix — a prototype found it in one run and
  review had not. A piece is a pure function of `(t, part)` with no GL anywhere in it, so a lab can
  plot one against time, layer several, scrub a pinned clock, and show the merged offset per part.
  That is most of what a session currently burns tokens reconstructing, and it is also where the
  numbers the design deferred get picked: `roving`'s `dwell` ships at a stated-provisional 3200ms
  precisely because there was nothing to measure against. Nothing is designed yet.

  It is a **different lab** from **kliegsminister**, the stage-and-repair lab in
  [the pipeline lab design](specs/2026-08-23-pipeline-lab-design.md) — that one is about tube
  geometry, this one about time.

- ~~**An effects pipeline for the tube looks**~~ — shipped, along with `roving` and `hue` on top of
  it. See the `## In flight` section.

- ~~**Playwright reuses whatever owns port 5180**~~ — fixed in `484692b`: `playwright.config.ts`
  derives a port from the checkout's own path and starts vite `--strictPort`. Before that, a run in
  one worktree silently answered from another's dev server and returned confident wrong answers —
  four bogus failures, and two sessions judging appearance off contaminated runs. A checkout without
  that commit is still exposed.
- **`visual.spec.ts` is flaky under parallel load, and it is three tests now, not two.** `bloom path`,
  `two-line block` and `wrap breaks a long line into rows` have each failed intermittently in the full
  suite and passed on isolated re-run. It predates the particle work — `two-line block` was seen
  failing before the `index.ts` changes existed. All three read the whole drawing buffer inside rAF
  and assert on a single sampled frame, which is the likely cause; that the third is a pure layout
  test touching no material narrows it further, since it rules out anything look-specific. **A single
  failure in this file is not evidence of a regression — re-run before believing it**, and note that
  a passing re-run deletes the failure artifacts, so capture the diff before re-running if you want
  to diagnose it rather than dismiss it.

  **The one captured artifact says the sample, not the render, is what fails.** On a `wrap breaks a
  long line into rows` failure the error context showed `litBands` returning 0 while the page
  snapshot showed the scene drawn normally. So the frame the assertion read was empty even though a
  correct frame existed — the harness sampled before or between draws rather than the renderer
  producing nothing. That points the fix at how these tests choose their frame, not at the effect.
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
- **The back-cap chunk waste is not worth fixing — measured, and struck from this list.** About a
  quarter of `sequin`'s chunks land on the back cap (25.1%; the same measurement put the deleted
  `pyrite` at 27.9%), but it costs nothing: real-GPU median frame time was 2.2–2.3 ms whether a
  chunk look drew 55 chunks or 1. Rejecting back-facing samples would raise visible chunks per
  letter by 39% and leave only 8.8% of positions surviving the reseed — a look change dressed as an
  optimization. The back cap is also genuinely on screen during two shipped enters.
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

**Colour never reaches a `body` part.** `writePart` returns after the brightness write for a body, so
a `hue` effect on `{ kind: 'body' }` is silently inert — no error, no warning, no change on screen.

**`roving` wants `{ amount: 1 }`.** It picks its holder from the whole pool of its kind, because
`at(t, part)` sees pool-wide numbering and cannot know which subset an effect targets. Against a
subset the fault lands on a part the effect does not drive, and the sign shows nothing.

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

## `sequin` is sewn now, and what that cost

Shipped on `sequin-rework`. The chunk generator used to stick a tumbling square on each sampled
point and stand it a third of its own size off the surface; `sequin` is now 520 discs at 0.062 em
lying nearly flat at 0.08, on a lattice pitched at 0.055 so each row overlaps the next. Three
capabilities were added to the generator, each inert at its default, and the two shipped in the
rescued `pyrite` machinery (`faceBias`, `bedding`) carry the rest.

- **`ChunkSpec.lie`, 0..1** — how flat a chunk lies on the surface, applied after `align`. It turns
  the tumbled rotation onto the sample's normal by the shortest arc rather than building a frame
  from it, so the chunk keeps its own spin and the knob costs no random draw.
- **`shape: 'disc'`** — a `CircleGeometry` beside `flake` and `cube`.
- **`BeddingSpec.pitch` / `.jitter`** — sites at a spacing along each bed, alternate beds offset by
  half a pitch. Omit `pitch` and bedding behaves exactly as before.

**Thinness was never the problem.** A `flake` is a `PlaneGeometry(1, 1)` drawn `DoubleSide` — a
zero-thickness quad. The old note here claiming thinness was inexpressible was wrong; what was
missing was roundness and orientation.

**Two values cannot be the ideal, and both bite silently:**

**`lie` must not be 1.** Discs lying perfectly flat are parallel mirrors — every one returns the
same reflection and the field reads as a single dull sheet. It ships at 0.82. Perfecting the
orientation destroys the glitter that is the whole point of the look, which is the opposite of what
the capability appears to promise.

**`proud` must not be 0.** A disc lying exactly in the surface z-fights with it across its whole
face. It ships at 0.08 of an edge.

**`jitter` is a second dial on the cap/band split, against `faceBias`.** A stray too tight to hit
rejects cap draw after cap draw until the sampler happens to draw a band triangle, which it accepts
at once — so tightening it starves the caps rather than sharpening the lattice. Cap samples fall
from 1236 at 0.5 to 51 at 0.05 while the share of them sitting on a site stays at 100% throughout.
`spikes/bed-lattice.mjs` measures both, and `spikes/look-shot.mjs <look> <out.png>` renders one look
for eye-judging on a port derived from the worktree.

**Two traps for anything else that measures this field.** `glyphToShapes(font, char, size)` takes a
size, and omitting it silently builds the glyph in font units — about 53x too large, with every spec
number written at 1 em. Use `buildGlyphGeometry(font, char, 1, DEFAULT_GLYPH_OPTIONS)`, which is what
the renderer does. And classify a cap by its normal, not by z: the bevel stands proud of the cap
plane, so a z cutoff files bevel samples as band and reports a lattice far worse than it is. Both
produced a wrong number mid-session before they were caught.

**The lattice governs the caps only.** A bed is measured in word space, which the caps lie in and
the extrusion band stands perpendicular to, so a grid projected onto the band smears along the
extrusion. The band keeps free placement, told apart by the per-triangle facing `faceBias` already
computes.

**`lie` lays a chunk onto the outward normal, and the field is `FrontSide` from 0.8 up.** The earlier
note here — that a disc only faces outward at `lie: 1` — was wrong, and wrong in a way that hid the
fix: the side a face ends up on was decided by the tumble, not by `lie`, so *no* value of `lie` made
`FrontSide` safe. Only 47.8% of near-cap discs faced outward at any setting, 1 included. Laying
always onto the outward normal makes it 100% from 0.8 up, at the cost of half a turn for the chunks
that leaned the other way — which leaves them less flat, so `sequin` moved from `lie: 0.82` to 0.88
to hold its old tilt spread. Buys nothing measurable in frame time (see the back-cap bullet above);
it is here because a one-faced chunk that lies on a surface should face out of it.

**And it must reach that normal by the near side of the plane, not by aiming at it.** Handing
`Quaternion.setFromUnitVectors` two vectors near antiparallel keeps little of its precision — the
same source placed chunks differently on macOS and on Linux CI, three commits of main went red, and
the local suite passed throughout. Sequin's closest chunk is 3.2e-4 from antiparallel, well clear of
three's degenerate branch at 1e-8, so the guard that looks like it covers this does not. The
placement pin is the only test that catches it, and it only catches it on CI.

## A known limitation of the lab

A spec change rebuilds all sixteen cells, ~1.45s front-only and ~2.85s with `back`/`wall`/
`connectors`. Sliders commit on release, so a drag costs one rebuild rather than twenty — but a single
step still waits. The honest fix is not rebuilding a whole `Word` per cell for a spec change.
