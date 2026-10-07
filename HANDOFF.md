# Handoff

**For:** the next session in this repo. **Answers:** what state `main` is in and what is still
open. Everything learned along the way is in [`docs/notes/`](docs/notes/README.md); designs are in
[`docs/superpowers/specs/`](docs/superpowers/specs/). Checked against the code on 2026-10-07.

## State

- **npm has 0.16.2**; `main` is at 0.16.5, untagged and unpushed. 0.16.3 and 0.16.4 move to
  `@weasel-js` 1.8.0 and 1.8.1; 0.16.5 stops the stage unmounting under a running effect. Releasing
  is a tag push — see [releasing](docs/notes/README.md#releasing).
- On 0.16.5, biome and `tsc -b` are clean and the full unit suite is green on the fleet (`onto test`).

## Open, and waiting on a decision

Each of these needs someone looking at renders or choosing; none is safe to settle unattended.

- **Two visual baselines moved with the counters change and await a look before re-blessing.**
  Off-axis `tubing` differs by 1899 pixels and `hue` on a `tubing` sign by 335, all of it on
  `JACKPOT!`'s `A`, where the tube now goes around the counter. Expected when counters merged
  (`caee62c`), which re-took no baselines. The run on 2026-10-07 was at a load average near 190:
  nine more tests failed without reaching a comparison, `look-tubing` among them, so re-run the
  suite on a quiet machine before re-blessing. Never re-bless unseen.

- **Re-express `tubing`, `piping` and `sequin` as fills.** The last slice of
  [wells and fills](docs/superpowers/specs/2026-09-01-wells-and-fills-design.md); it moves visual
  baselines and is judged on its renders.
- **Pavé's sheet has loose ends.** A dithered fade reads grainy from about 70% opacity down,
  while blending snaps every stone black on a fade's first frame — which is worse is a look call.
  Stones the seam cuts show dark specks where the cut face sees into the hollow letter; dropping
  those stones is the likely fix. Individual stones as effect parts are not designed. Every letter
  draws the whole sheet twice and the mask discards most of it, at an unmeasured cost.
- **`piping`'s `B` still bends tighter than its minimum.** The fixes tried each redraw the alphabet
  or move the fault to another corner; [tangential
  junctions](docs/superpowers/specs/2026-08-22-tangential-junctions-design.md) lays out the choice.
- **Archivo Black's `K` and `k` show a tapering bevel highlight**, from arm sides 1–2.5° off
  parallel in the font itself. Swap the face, regularize outlines at load, or leave it.
- **The lamp's defaults are unsampled.** Radius, strength and falloff were judged at one lamp
  position on one five-letter word, before the registration fix, so they were tuned partly around
  the defect.
- **`hue` cannot be reached from a `/show/` share link**: `apps/lab/src/show-config.ts` has no
  effects key, and no shipped look carries effects.
- **The tube gallery has unruled questions**: `spread-none` renders the same as the default
  cell, `luma 0.8` blows out to near-white, and the geometry-only cells read alike at 150px.
- **A sign's sparks are clipped to its canvas box.** Whether to raise `bleed` or give layers a way
  past the anchor was asked and not answered.
- **The portfolio masthead proof sheet** at `~/site/sheet/` (unversioned, the only copy) is blocked
  on these choices: card 31's tracking, card 28's material, the haze behind the type, whether the
  metals take `lt=sweep`, card 17's off-center swash, and card 18 as `oil` or teal enamel. Rebuild is
  `build.py <dir>` then `assemble.py <dir>`.

## Built without a review

- **`dwell`, `attach` and `pointOn` were built with no review gates**, on instruction. Every design
  call in [their](docs/superpowers/specs/2026-09-14-hinge-signal-design.md)
  [specs](docs/superpowers/specs/2026-09-15-attach-pointon-design.md) was the building session's.
- **`TubeSpec.contours` is keyed by role** (`counter`, `outline`) because the build went ahead
  while that question was open. A flat `counters` field was the alternative, and is a cheap rename
  before anyone depends on it.
- **The tube power states' overload trip, `level()`, `peak()` and `drop`** are the building
  session's shape for what was asked; the rest of
  [tube power](docs/superpowers/specs/2026-09-15-tube-power-design.md) was chosen in conversation.

## Designed, unbuilt

- **[The shared surface](docs/superpowers/specs/2026-09-12-shared-surface-design.md)**: the labs as
  tenants of labkit's one renderer. Its [plan](docs/superpowers/plans/2026-09-12-shared-surface.md)
  is the only plan left in the tree.
- **Run spans** — `LetterInfo.span`, from [text runs](docs/superpowers/specs/2026-08-19-text-runs-design.md).
- **A floating legend** for kliegsminister, from [legend palette](docs/superpowers/specs/2026-08-23-legend-palette-design.md).
- **Tube layout strategies** `concentric`, `spine` and `single-stroke`, from
  [tube layout strategies](docs/superpowers/specs/2026-08-26-tube-layout-strategies-design.md).

## Known defects, unscheduled

- **Long curves facet**: the rendered extrusion samples at a fixed `curveSegments` of 10 — a crease
  across great-vibes' capital `M` at masthead size. See [text](docs/notes/text.md#glyphs).
- **A regrouped sign's lamp lights where the letters used to be**; the part pool is frozen at
  construction.
- **Fixed sleeps remain in the Playwright specs** (`waitForTimeout` in `visual.spec.ts`,
  `looks.spec.ts` and `controls.spec.ts`), standing in for conditions; under load they are what
  flakes.
- **Unmeasured costs**: a lamp on `by: 'all'` may re-upload every run's vertex buffer each frame,
  and `tile`'s remaining cost is mostly the shell's own distance field of the letter's skin.
- **The dev labs carry a second `@msb235/blits`** (0.4.0, pinned by `@weasel-js/core`) beside klieg's
  0.6.0, until weasel moves.
- **No visual baseline covers** `power`, `kicks`, a lamp, or a multi-line block's horizontal
  placement.
