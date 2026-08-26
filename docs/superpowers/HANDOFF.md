# Handoff — klieg, 2026-08-25

**For:** the next session picking this up. **Answers:** what is on `main`, what is in flight, and
what is worth doing next.

## In flight

**`composable-lighting`, all nine tasks done, not merged.** Branch cut from `fb058fe`, nothing pushed.
Every task passed both gates — spec compliance clean on the first pass, code quality after one fix
round each. Task 1 (`9425be1`, `e637b33`) added the additive `light` channel on `PartOffset` and
summed it in the effects compositor. Task 2 (`13d1c62`, `4a61f72`) added the four light sources —
`fixed`, `fromPointer`, `orbit`, `along` — in the new `effects/lamp.ts`, plus `FrameCtx`. Task 3
(`36511b9`, `7dadd2d`, `1a59f88`, `822afe4`) added the `lamp()` piece, gave `EffectPiece.at` a
required `ctx`, and moved `FrameCtx` into `effects/types.ts`. Task 4 (`61cbfb0`, `0e6f9a0`,
`ee63418`) exported `lightBase`, the emissive and hue a lamp resolves against. Task 5 (`a39aaed`,
`03f59d4`, `789d83b`) landed `litEmissive` and wrote the light onto both a body's emissive and a
run's colour buffer, threaded the `ctx`, and added `partExtent()`. Task 6 (`b883659`, `295bce7`,
`f3d4f5e`) added `EnvPiece`, `mergeEnv` and the `sweep`/`still`/`track` factories. Task 7
(`8a778f9`, `3b69ca8`, `6d3b3d3`, `ad60629`, `5589976`) made `lighting` a slot, built the per-frame
`FrameCtx`, and moved the pointer arithmetic into a new pure `src/pointer.ts`. Task 8 (`4a68519`,
`9bc93a1`, `c50c5b1`, `88aeb0c`) exported the surface, retired `envRotation` and `PointerLight`, and
wrote the CHANGELOG and README. Task 9 (`369b328`, `116fa4f`, `785a475`, `cfbf02b`, `0a4fbd8`) is
the render proof. `npm run check` is green at **1071 tests**, up from 977 at the branch point.

**Task 9 proved it reaches the screen.** `spikes/lamp-proof.mjs` drives a real page for 49 shots and
8 contact sheets: **the lamp reads on all six looks, including `tubing` on `{ kind: 'run' }`**, so the
vertex-buffer path is live and this is not another `gain`. The light channel sums in sRGB as Task 5
labelled it, verified byte-exactly by the one comparison that can tell — a mid-grey lamp at full
strength against a white one at `128/255`, which are the same float and must render identically.
Results and every open question it settled are in
[the findings note](specs/2026-08-25-material-lighting-findings.md), sections 9-13.

**Two things the render proof does not cover.** There is no per-frame cost anywhere in it —
SwiftShader flattens it, so the plan's worry that a lamp on `by: 'all'` re-uploads every run's
vertex buffer each frame is still unmeasured. And every shot is a single-line sign, so `part.y` is 0
on every part in all 49: the y-axis convention Task 7 fixed (`clientY` grows down, layout y grows
up — `effects/types.ts:72-75`) is exercised by no pixel on this branch. The script now asserts that
the light's x centroid rises with the cursor rather than merely differing; the vertical half of that
check wants a multi-line sign, which nothing renders yet.

**What is left is the decision to merge.** Nothing is pushed; `main` is 11 ahead of `origin/main`.
Every one of the nine tasks passed a spec-compliance review and a code-quality review, most with a
fix round between. **A whole-branch pre-merge review was attempted twice and both runs died to API
529s**, so the seams *between* tasks — one concept named two ways, an abstraction carrying weight it
should not, the coherence of a fairly large new public surface landing in one release — have had no
reviewer. That is the one gap in the branch's verification, and it is a gap in coverage rather than a
known problem.
Task 9's code-quality gate has since run, and its findings are folded in. Three findings below are
recorded and deliberately unfixed.

The execution method was subagent-driven — one implementer per task, then a spec-compliance review,
then a code-quality review. Read the plan rather than the design doc: review rounds amended Tasks 5,
7, 8 and 9, and the design predates all of it.

**The lesson of the whole branch: a proof script can reproduce the defect it was written to catch.**
Task 9's first version drew a cursor crosshair into the same clip it md5'd, so four pointer checks
compared frames differing only by where the crosshair sat. Two frames in which the lamp contributed
*nothing* — `lit=0` on both — hashed differently and were reported as `reads`, on `fromPointer`, the
headline source. With the crosshair moved out of the hashed clip those frames collapse to
byte-identical with the unlit frame. **Anything drawn for a human to look at must sit outside
anything a machine compares.**

**Three findings the renders settled, recorded and unfixed.** A cursor anywhere on a **regrouped**
sign lights nothing: the part pool is frozen at construction, so the light lives where the letters
used to be, and only a cursor past the right edge lights a centred `NOW`. A lamp on a
`mode: 'replace'` **gradient** is a total no-op — that shader branch never reads the attribute a lamp
writes — and `hue` rendered as a control is equally dead, so it is pre-existing and not lamp-specific.
And the pointer mapping compresses the cursor's whole travel onto the ink, so the light **leads the
cursor at one end of the sign and lags it at the other** — §9 measures both ends on two framings, and
the README now describes that shape instead of promising a match.

**`orbit`'s default moved 2 → 0.3, and the first justification for it was wrong.** Its table was
sampled at an uncontrolled phase. §12 of the findings note carries the eight-phase replacement, the
two claims of `369b328` it falsifies, and why 0.3 rather than 0.4; the move stands.

**What Task 8 learned: verify your own prose against the built package.** Two claims written in this
task were false and both were caught by a throwaway script that imported `dist` and asserted each
sentence. `duration` is read by `orbit` and `along` only — `fixed` ignores `t` exactly as
`fromPointer` does, and `LampSpec`'s own doc named just one of the two, which is how the wrong
sentence got written. And `lamp({ source: orbit() })` **on bare defaults lights nothing at all**:
`orbit` sits at 2 em, a lamp reaches 0.5 em, and a short sign's parts live inside 1.3 em. Not a
ratio problem — the same 4:1 works at a larger scale. Task 9 renders it and decides whether the
default moves; it has never shipped, so it is free to change now and a breaking change later.

**Two things Task 2 learned that the plan did not say.** The plan's supplied tests are vacuous on
the two things worth testing. `along` is only exercised on a 2-point path, where `last === 1` so the
segment index is always 0 — an `along` that ignored every interior point and lerped first-to-last
passes every assertion the plan gives. `orbit` is only called with its centre defaulted to the
origin, so a transposed `cx`/`cy` passes too. Both gaps were closed in the review round and both new
tests were confirmed red against the defect they target; the suite is 9, not the 7 the plan writes
out. **Assume the same of tasks 3-8** — the plan's test bodies are a floor, and the parameter a test
leaves at its default is the one the implementation gets wrong for free.

**`FrameCtx` moved to `effects/types.ts`, and the plan is amended to match.** The plan's file table
put it in `render/lighting.ts`. Task 3 is the step that would have made `effects/types.ts` — the
module every effects consumer imports — depend on `render/lighting.ts`, whose other export is
`PointerLight`, a class that attaches DOM `pointermove` listeners. `FrameCtx` is a pure data shape
with nothing rendering-specific in it, so it went to `effects/types.ts` alongside `PartInfo` and
`EffectPiece`, and `effects/` now imports nothing from `render/`. Task 6 imports it back when
`EnvPiece` needs it. The plan carries an amendment note under Task 2; read every
`from '../render/lighting.js'` in Task 2's step text as `from './types.js'`.

**The unit suite times out under load too, not just the visual one.** `vitest.config.ts` sets no
`testTimeout`, so the default 5s applies, and the three tests that do a dynamic
`import('../../src/index.js')` — `pieces.test.ts`'s registry check and `motion/enter`/`motion/exit`
— pull three.js through a cold Vite transform. At load average 134 those failed and then passed on
re-run with nothing changed. **A timeout in those three is not evidence of a regression; check
`uptime` before believing it.** The handoff already said this of `npm run test:visual`; it is true
of `npm run check` as well.

**Three things Task 3 learned, and the first two are about the plan itself.** The plan's `lamp` test
asserted `.light?.amount` where the plan's own literal code returns a shared `REST` — so the spec
could not pass itself. Both are corrected in the plan now; the test gained `?? 0`, matching the
idiom its own fourth case already used. And **"a third parameter is additive" is true of
implementations and false of callers**: `word.ts` and `roving.ts` both call `.at(t, part)` and both
broke the moment `ctx` was required. Do not resolve that by making `ctx` optional — a lamp reached
without a ctx would silently emit nothing, which is this design's own defect class one level up.
`word.ts` passes an explicit placeholder until Task 5 threads the real one, and biome's
`noUnusedVariables` makes forgetting it loud.

**`roving(lamp(...))` does not work, and it is structural.** `holderOf` substitutes `part.index` but
keeps the calling part's `x`/`y`, so `roving`'s holder walk assumes the inner keys off index. `lamp`
reads position. Measured: order-dependent between iteration directions, nothing lit across 16 frames
of a pointer sweep at a narrow radius, and the fault pinned to one part forever at a wide one — at a
wide radius the lamp never rests, so no handover ever defers. Documented on `roving` rather than
fixed, because the honest answer is that a position-dependent piece is not a valid inner. **Task 8
should not export both without that line.**

**A red-then-green claim can be red for the wrong reason.** `roving` forwards `ctx` at two call
sites; a test covered one, and the reported verification mutated only the covered one. Mutating the
other left the suite green. When a review fix claims mutation evidence, mutate the exact `file:line`
the finding names and check each site separately.

**Green units still mean nothing here.** Tasks 1-8 are all pure functions and all unit-testable, and
none of them can show that light reaches the screen. That is Task 9's whole job, and it is the
defect this design exists to fix — `gain` ran, merged, wrote to the material, and changed no pixels.


**`selectable-text` is merged into `main`.** It implements
[the design](specs/2026-08-25-selectable-text-design.md) in full — one `FireOptions.selectable` of
`'hidden' | 'layer' | 'none'`, defaulting to `'hidden'`. Nothing is outstanding on it.

Three things it knows that the design doc does not:

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

**0.7.0 is published and is `latest`**, carrying the `selectable` option, the `tubing` tint fix, the
`LookKey` literal union, and `crawl` with the `chase` piece. Releases are automatic: push a `v*` tag
and `release.yml` publishes through npm trusted publishing, checking first that the tag matches
`packages/core/package.json` and skipping a version already on the registry. `npm view` reports a
stale version straight after a publish — read `https://registry.npmjs.org/klieg` to see what
actually landed.

`origin/main` is the 0.7.0 commit with nothing unreleased on it. **The portfolio session asked to be
told before a tag goes up**, and since releases are tag-triggered there is a window between telling
them and pushing it.

**`main` carries the tube lab, the tube geometry rewrite, the colour gradients, the junction
reconciliation, direct paths by default, element-anchored placement and the effects pipeline, all
merged.** On `main`, `npm run check` is green at **977 tests across 52 files**, measured at
`d15979c`; `npx playwright test` was **26 across 2 files** at `967408e` and has not been re-run
since. Every count in this doc is measured, not carried over — it has twice claimed a playwright
number one higher than `--list` reports.

**`enter pieces > every piece is finite everywhere` flaked once** in a full `npm test` at `d15979c`
and passed alone and on the next full run. Order-dependent or seeded; not chased.

**A wide anchor takes a longer lens.** An element placement lifts `FIT_CAP` so the word fills its
anchor, and against a masthead strip that put the outer glyphs past 70 degrees off-axis — far enough
that an extruded letter's side wall projects across its neighbour and the word reads as one merged
mass. `lensFor` in `render/stage.ts` grows `z` until the frustum edge falls within
`MAX_HALF_ANGLE_DEG` (35) and narrows `fov` to hold the frustum height at the word's depth, so every
framing fraction keeps its meaning and the type keeps its on-screen size. A box already inside that
angle keeps the base lens exactly, so a fullscreen overlay is byte-identical and no baseline moved.
Shipped in 0.6.0.

**`framing` does nothing a fullscreen overlay has not already hit `FIT_CAP` on.** The fit takes the
smaller of the two budget axes and the cap, and `FIT_CAP` (2.2) is what binds for a short word — so
raising `framing` on a fullscreen placement changes nothing, silently. Only `placement: element`
lifts the cap (`viewportBudget` in `render/stage.ts`). The show page was fullscreen over a
`inset: 0` stage and rendered `klieg` at 46% of viewport width against a 0.84 budget; anchored to
that same stage it renders at 77%, bound by the framing at last.

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

- ~~**Selectable text**~~ — built and merged into `main`.

- **Composable lighting — all nine tasks built, on the branch, unmerged.** See the "In flight"
  section at the top. `PointerLight` and `slotDrivesEnv` are gone and the `aimAt` viewport bug with
  them. What is left is the decision to merge.

  **Two spikes are the evidence, and they re-run.** `spikes/lamp-falloff.mjs` proves
  `PartOffset.gain` is a byte-identical no-op on seven of eight looks; `spikes/lamp-blend.mjs`
  compares five ways to combine a lamp with the material under it. Both compare lamp-on and lamp-off
  renders by md5, which is the only thing that caught the no-op — the effect ran, the compositor
  merged, the material was written, and the image did not change.

- **The rendered word does not register against the text it stands in for. Asked for directly.**
  Two settings, one theme: klieg replaces real DOM text and does not currently agree with it.

  **Where the word sits in its box is settable now — `framing.align` on the `framing-align` branch,
  pushed and unmerged, seven commits off `d15979c`.** `Align` is `'start' | 'center' | 'end'`, it
  places the word at whatever size the framing fractions chose, it measures against the painted edge
  (bevel included), and an anchored word defaults to the page's text edge. That is the half of this
  ask that answers the original complaint. It aligns the **block**, computing one `offsetX` for the
  group off the painted extent.

  **Per-line alignment inside a block is still open, and centred is still the wrong default.** `text/placement.ts`
  centres every line on `x = 0` across the glyphs that draw ink, and nothing exposes a choice. It
  wants `'left' | 'center' | 'right'`, defaulting to **left**, with the `selectable` layer reading
  the same setting so its spans keep matching the ink. `apps/lab/test/visual.spec.ts` already
  compares span boxes to the drawing buffer's ink — centres within 10px, bounds within 8 — so that
  test is the guard, and it is the one that has to be re-pointed per alignment. Changing the default
  moves every multi-line baseline — a breaking visual change, and a minor.

  **The neon renders smaller than the fallback it replaces.** Observed under `placement: element`,
  not yet measured. Size comes from `framing` (0.62 wide, 0.3 tall) through `FIT_CAP` in
  `text/layout.ts`, which an anchored placement already lifts — so what to expose is a scale and
  offset trim on top of the fit, not another fit. Do not name it for fudging; name it for what it
  does. **Measure the gap before adding the knob:** a fallback is styled type with its own
  line-height and cap-height, and if the neon comes out smaller by a consistent ratio that is a fit
  bug to fix rather than a knob to hand the caller.

- **A macro spell for `flicker`, so a tube stops flickering for ~15s and starts again. Asked for
  directly, and prototyped.** `flicker` is already intermittent per part, but only on a micro scale:
  `unrest` is the share of a pass spent stuttering across 24 steps of a 1400ms pass, which is a tube
  buzzing. Two more params give it the long scale — `spell`, the milliseconds of one flickering
  bout, and `calm`, the quiet between. `calm: 0` is today's behaviour, so every current caller is
  unchanged.

  **Do this rather than an `intermittent(inner)` wrapper**, which was the first shape considered.
  A wrapper runs two independent clocks, and when the gate period lands on a whole multiple of the
  inner duration, the inner phase at the start of every burst is 0 — so every burst opens on the
  same phase and they all look identical, silently deleting the variation the wrapper exists for.
  `roving` documents the same resonance from the other side, above its `duration` arithmetic: do not
  make the epoch a multiple of the inner pass, or every handover samples one fixed phase. Folding
  the spell into `flicker` derives both scales from the one `t` and the trap cannot exist.

  **`STEPS` has to stop being a constant, and that is the whole risk.** It is hardcoded 24 against
  the 1400ms default — 58.3ms a step, which the file's own comment ties to ~3 frames at 60fps. A
  57s pass at 24 steps is a 2.4-second strobe, not a flicker. Derive it as `round(duration / 58.3)`:
  that returns exactly 24 at the default, so nothing shipped moves, and holds 58.4ms a step at any
  length. `node spikes/flicker-macro.mjs` prints the derivation and walks a fitted pass — measured
  57ms shortest drop and a ~16s lit stretch against a 15s calm.

  **The pass length adjusts to fit whole spells**, as `roving` already does for epochs: 60s asked
  with a 4s spell and 15s calm gives 57s and three spells. `roving` reads `inner.duration`, and
  `roving(flicker())` against a 57s inner degrades sanely — 18 epochs of ~3.2s.

  **Snap the spell to a whole number of steps, or it clips drops to single frames.** The spell gate
  runs on its own schedule, so a boundary lands wherever it lands inside a step — measured 5 of 5
  boundaries mid-step, producing drops as short as 29ms against a 58.3ms step. `flicker`'s own
  comment above `STEPS` says a one-frame drop "reads as noise rather than as a failing tube", so
  this quietly breaks the thing that comment exists to protect. Make the spell a whole number of
  steps and the boundaries fall on step edges.

  **If the wrapper is wanted anyway — for `roving` or `hue`, which this does not cover — derive its
  period from `inner.duration`.** The ask was for something that wraps "things like roving", and
  folding `spell`/`calm` into `flicker` only serves flicker. A general wrapper is fine as long as
  the caller cannot set a period independent of the inner's: the wrapper picks a period off integer
  ratios with `inner.duration`, the same accommodation `roving` already makes when it rounds its
  epoch. The semantics are the ones asked for — the gate swallows the inner's output for a stretch
  rather than resetting it — and the trap is not reset-versus-swallow but which phases the swallowing
  leaves visible: on an integer ratio the surviving windows land on the same phases every time, so
  every burst looks identical while the inner genuinely never resets.

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
- **Material and lighting findings, with a command per item — medium priority, and the pile to try
  next.** See [the findings note](specs/2026-08-25-material-lighting-findings.md). In short:
  `envMapIntensity` has never been applied on any look, so every look renders 2.2x dimmer than
  authored; the extrusion walls read as cement because the studio lights the scene blue on the left
  and warm on the right; `gem` is red-but-dark at low env and bright-but-gray at high env, and the
  knob that would fix it — `specularIntensity` — is one of three material properties `LookKey`
  cannot express; and `sequin` is unreachable by any effect at all.

  Each item names the spike that proves it and the flags to reproduce it. The env fix moves every
  visual baseline, so it is its own change rather than a footnote to lighting.

- **`envMapIntensity` has never been applied, on any look.** `looks.ts` constructs every material
  with `envMapIntensity: 2.2`, but klieg lights through `scene.environment` and the property only
  scales a material's *own* `envMap`, which none of them have.
  `node spikes/lamp-blend.mjs --blends envown --env 1` reproduces the shipped render byte for byte;
  `--env 2.2` is visibly richer. Assigning the scene's environment texture to each material makes
  the authored value live — and moves every visual baseline, which is why it is its own change and
  not a footnote to lighting.

- **The extrusion walls read as cement because the studio is two-toned.** Faces and walls share one
  material — `buildGlyphGeometry` makes a single `ExtrudeGeometry` and klieg passes one material, so
  nothing differs in shading. A metal reflects `baseColor x envRadiance`, and `render/environment.ts`
  puts blue bars on the left (`x: -14` at `[2.4, 4.0, 7]`, `x: -6` at `[2.4, 2.6, 3.4]`) against a
  warm one on the right (`x: 14` at `[6, 4.4, 2.2]`). Gold is `0xffc44d`, so its left-facing walls
  reflect warm-times-blue and go gray-lavender while the caps stay golden. Raising env intensity
  brightens the cement without warming it. The fix is in the environment, not the material or any
  lamp.

- **klieg cannot author specular at all.** `specularIntensity`, `specularColor` and `reflectivity`
  are absent from `LookKey`. `specularIntensity` tints specular reflection at normal incidence for
  non-metals, which is the knob that would let `gem` keep its red as it brightens — the wash is
  specular sitting on the attenuation. Untested; the next thing to try on the gem problem.

- **Another pass on light-up letters — medium priority.** The design picks a blend and a channel; it
  does not finish the look. **`gem` cannot be lit with one knob.** At `env=0` it reads red, its
  `attenuationColor` working as authored; raising env lays specular reflection over that and washes
  it to blue-gray. Red-but-dark or bright-but-gray, with nothing in between — a transmissive look
  needs a channel that raises *transmitted* light, not reflected. Metals have no such problem: gold
  holds its hue from `env=2.2` to `14`. **`sequin` is unreachable** — zero `run` parts and a
  near-black body under the disc field; it needs a `'chunk'` `PartKind`. **The defaults are
  unsampled** — radius, strength and falloff were judged at one lamp position on a five-letter word,
  enough to choose a blend and not enough to ship numbers.

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
