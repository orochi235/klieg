# Tubes

**For:** whoever changes the tube pipeline (`render/tube/`) or tunes `tubing` and `piping`.
**Answers:** what the geometry model learned the hard way, and which measurements not to redo.
The model itself is in [the tube geometry design](../superpowers/specs/2026-08-19-tube-geometry-design.md),
whose `## Acceptance, as measured` section has the numbers.

## Corners and bends

- **`M` and `W` are the worst case, not `N`.** `M` bends at 0.32 of its own tube radius and `W`
  at 0.38, against `N`'s 0.44. Every acceptance check uses `MWNSRE`, and the tube lab defaults to
  `MWSB`. `piping` wants `QXY` instead — it traces inset at `level: -0.015` onto a different
  contour, so no one string serves both looks.
- **Detection runs at `max(ρmin, ρstyle)`.** At `bend = 2` the stylistic band is empty, and a
  corner between `ρstyle` and `ρmin` used to be hard yet above the detection threshold — never seen,
  never fixed. 13 such corners on `tubing` at `bend = 2`, 174 at `bend = 3`. A genuinely stylistic
  class needs `bend < 1.76`, not a change to `ρstyle`.
- **`bend` does not classify — it sets setback.** 2 and 3 give near-identical hard-corner counts.
  Tune against the rejected-fillet count, never the corner count.
- **Filleting is the ordinary path**: 228 hard corners on `tubing` and 244 on `piping` across
  A–Z. Robustness in the common case, not correctness in the rare one.
- **A corner is a stretch because of resampling, not because of the field.** Arc-length
  resampling splits a sharp corner across two vertices whenever a sample does not land on it
  (`spikes/corner-width.mjs`, on a square with no distance field near it). The direct contour has
  the same stretches and the same 20° shoulder outside them, which is why a leg direction is
  averaged over four segments.
- **The field manufactures corners, so a path source change is a look change.** Its wobble creates
  corners that are not in the glyph and roughly doubles the corner count, so the cut lands
  elsewhere and `assign` paints a different lit pattern from the same seed — `tubing`'s `S` goes
  `OxO.xO` to `OO.OOx`. Numbers tuned against one source do not carry to another.
  `spikes/run-decomposition.mjs`.
- **What a letter is missing is its sharp interior apexes**, where an arc at the minimum bend
  radius cannot reach the tip; it scales with tube radius. It is not `dropHead`/`dropTail` (break
  drops are 0.85 em across A–Z) and not `resumeAt` giving up a leg (make it never walk and `W`'s
  holes do not move). `TubeSpec.rejoin` offers `drop` (default), `bridge`, `widen` and `relax`;
  [the rejoin design](../superpowers/specs/2026-08-26-corner-rejoin-design.md) has each one's
  number. `spikes/corner-coverage.mjs` measures it; `OUT=page.html` draws the bare contour.
- **The hairpin ships in two constructions with opposite costs**, so both are knobs:
  `bisector` takes `W` from 17% bare to 0% but stands up to 0.29 em proud; `uturn` holds a flat
  0.13 em footprint but eats up to `6 ρmin` of each leg. `spikes/hairpin-view.mjs`.
- **The last bend-minimum failure is a junction defect**, open — see
  [tangential junctions](../superpowers/specs/2026-08-22-tangential-junctions-design.md).
  Only `piping`/`direct` `B` fails in a shipped configuration; `tubing`'s `R` at 1.996r is wander
  and vanishes at `amplitude: 0`. `junctionRadius` and `biarcBlend` are built and tested in
  `bend.ts` and deliberately not wired.

## Traps in building runs

- **`tightestBend` smooths three times before measuring**, calibrated for the field's staircase.
  On a coarsely sampled arc it shrinks the radius about a tenth — enough to fail the invariant it
  checks. Fillets are sampled at half `spacing`, and authored points are held out of smoothing
  (`markAuthored` / `isAuthored` in `bend.ts`). Anything else building exact geometry into a run
  needs the same care.
- **Smoothing masks raw kinks.** A green measurement through a smoother is not evidence the path
  is clean.
- **A room test measured on geometry the merge does not build passes on nothing.** The fillet was
  once computed twice from different inputs, so the check validated an arc never spliced.
- **Trim a leg by distance from the corner, not by accumulated step length.** The latter leaves a
  point inside the setback, the path runs forward to it and jumps back, and that reversal reads as
  a tighter bend than the corner it replaced.
- **A fixture's sampling spacing is load-bearing.** A 90° turn at 0.1 spacing is a 0.071 em bend
  — wider than a 0.03 tube needs — so no corner is found at all. Sample at the pipeline's 0.02.
  Two named fixtures: a square never hairpins (use `sharpV` in `repairs.test.ts`), and
  `openLPath`'s 0.1 sampling registers no corner (use `fineOpenL` in `runs.test.ts`).
- **`wanderPaths` seeds its rng from the path's array index**, so the order paths are concatenated
  in — contours, then connectors — keeps every wandered look byte-identical. Reordering re-renders
  them all and throws nothing.
- **Each corner's two random draws key on its own index.** `stitchPath` used to draw the second
  only when a corner broke, so switching the `fillet` repair off shifted the stream for every later
  corner.
- **Stages and repairs are separate typed sets.** One untyped set of strings across both would let
  a caller passing only repair ids switch off all five stages and get an empty blueprint.

- **Stages mutate `state`'s arrays and never reassign them.** `buildTubeBlueprint` returns
  `state.runs` and closes `dispose()` over the same arrays; the `TubeStageState` fields are
  `readonly` to make reassignment a compile error.
- **`onStage` hands out live state, and `wander` mutates points in place.** A consumer keeping a
  `generate` snapshot sees wandered points later; clone in the consumer.
- **`stages.ts` imports `TubeSpec` back from `index.ts` as `import type`.** A value import in that
  direction is a real cycle at module init.
- **Do not measure a pipeline through `JSON.stringify`.** `tightestBend` returns `Infinity` for a
  straight run, and `JSON.stringify(Infinity)` prints `null`.

## Repairs (`render/tube/repairs.ts`)

`CORNER_REPAIRS` run twice per corner inside `mergeArc`, `SPAN_REPAIRS` at the `stitchPath` level,
and `fillet` and `hairpin` are gated where the decision is made. Two things shape how a report
reads:

- **`resume`'s `ran: false` lies under `bridge`/`relax`.** The blend applies regardless; the toggle
  gates only the walk's trim (comment on `ranResume` in `runs.ts`), so the repair layer hides a
  site that partly ran.
- **Some toggles are geometry-invisible on typical paths.** `setback` and the corner-side `stretch`
  are subsumed by later walks under most rejoins — `relax` makes exit-setback bite, triple-off
  makes stretch bite. And `setback` off under `rejoin: 'bridge'` cascades: 2769 points against
  241, because the leg-room math assumes the trim happened. kliegsminister marks that ratio.

## Color

- **A run's color renders through a per-vertex `runColor` attribute** that `tint.ts` patches into
  the look's own channel: emissive for `tubing`, base color for `piping`, since three's
  `vertexColors` only reaches diffuse.
- **Two ways a tube silently stops showing its run color.** A `tubeMaterial` override clears
  `readsRunColor` and the color write in `decorations/tube.ts` returns early. A `mode: 'replace'`
  gradient makes the fragment shader write the ramp alone and drop `vRunColor` (`tube/tint.ts`,
  the `const tinted =` ternary) — so `hue`, a lamp and `tint` are all no-ops on it.
- **`tint` recolors the palette the runs are dealt from**, because `tintByRunColor` sets the
  material's color channel to white. Its hue survives to the screen, its value does not: a bloomed
  tube measures `#5BFDFD` at the core and `#227787` along the run for a `0x22d3ee` tint. Never assert
  a literal pixel value. `spikes/tint-matrix.mjs` renders every look with and without a tint,
  compares md5s, and exits non-zero when a look ignores its tint.
- **Color never reaches a `body` part.** `writePart` returns after the brightness write for a body,
  so `hue` on `{ kind: 'body' }` is silently inert.
- **A positional gradient's bounds must be mutated, not reassigned.** The compiled shader aliases
  the `Vector4` and `Vector2` in `material.userData`, so a `regroup()` handing over fresh vectors
  leaves compiled letters on the old mapping.
- **The per-vertex gradient parameter is arc length, not ring index.** `ringsOf` domes each end
  with 4 cap rings about one `radius` long, so ring index gave a 25-point run 25% of its range on
  caps that are 11% of it.
- **`crawl` reaches the shader as a per-vertex float, and wraps only when non-zero.** A uniform is
  per material and every lit run of a letter shares one. A run's last vertex sits at `gradientT`
  1.0 and `fract(1.0)` is 0.0, so wrapping unconditionally snaps every ramp's end to its start.
- **`rim` divides by its own mean**, `1 - rim * π/4`, so the tube still averages to the emissive
  asked for; without it the rim sinks all of `tubing` under the bloom threshold.

## Render state

- **Eliminate a cheap hypothesis about render state before an expensive one about geometry.** The
  tube vanishing when thinned was diagnosed twice as geometry and was one line: a `transparent`
  material still writes depth, so `tubing`'s 0.08 backing culled its own tube (`519ae45`).
- **That backing is drawn, not merely non-occluding.** It ghosts out wherever `amplitude` wander
  leaves the letterform uncovered — visible as stroke doubling on a script face.
- **The visual suite cannot see `piping`'s cord.** It sits inside the letter body in both framings.
  Judge piping by `spikes/bend-acceptance.mjs` or a lab capture. On a hairline script face the
  cord's 0.03 radius is more than a -0.015 inset can hide and surfaces as a detached speck
  (great-vibes, beside the `l`).
- **A swash holds layout space the tube barely lights.** Great-vibes' capital `M` under `tubing`
  sits 58px off center because framing centers a box including the faint swash; under `piping` the
  offset falls to 11px. No knob fixes it.

## Serif faces

Nothing to tune. Cinzel keeps 71.4% of its traced contour under `tubing`, inside a 69–90% band
across eight faces where `rye` is lowest. The best single knob is `spacing 0.01` at +4.9 points,
which is resampling density, not tuning. What separates faces is corner count — `monoton` cuts 18
runs a letter against Cinzel's 6.6. `node spikes/serif-tuning.mjs --face <face>`.
