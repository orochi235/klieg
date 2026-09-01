# Composition lab, round two — design

**For:** whoever builds this round. **Answers:** what the second pass over the lab adds, and which
of its decisions came out of reading the code rather than out of
[the first design](2026-08-27-composition-lab-design.md).

The first round built the spine: a composition you can build, watch, scrub, measure and paste. It
deferred five panels. This round wires the pool the first round left unwired, brings the piece
roster back in step with core, and builds three of the five.

## The instrument is describing a pool the render is not using

`realPool()` is exported from `pool.ts` and covered by `pool.test.ts`. Nothing calls it.
`App.tsx:29` builds `syntheticPool(24, 7)` unconditionally, so the preview renders whatever `text`
and `look` the rail says while every panel beneath it describes a fixed 24-run, 7-letter pool.
Change the text to three letters and the raster still plots seven.

That is the failure the tube lab documents as "the instrument cannot know", and it is the reason
this round leads with the pool rather than with a panel.

## The pool switch

A source control on the rail: **real** (the default) or **synthetic**.

Real calls `realPool(text, font, look)` and rebuilds on `text` or `look`. The font is `loadFont`
against the same `fontUrl` the preview uses, awaited once at mount. Synthetic keeps
`syntheticPool(24, 7)` as an explicit mode, for exercising a kind the current look does not build.

Two consequences are the point rather than fallout. Only `tubing` and `piping` build `run` parts, so
on the other ten looks a real pool makes the rail's empty-target warning fire against a real empty
pool. And the raster's row list can now be empty, which has to read as *no `run` parts on `gem`*
rather than as a blank canvas.

## The roster, back in step with core

`PieceKind` gains **`lamp`**. It is an ordinary `EffectPiece`, so it needs no new layer machinery —
but its `source` is a function rather than a number, so the rail carries a source picker beside the
params: `pointer`, `fixed(x, y)`, `orbit(radius, x, y)`.

**`intermittent(inner, { spell, calm, bouts })`** joins `roving` as a second wrapper. It shipped
after the first round and the rail has never offered it. The two nest, so a layer can carry both.

## `light` is a channel

`PassSamples` gains `light`, the length of `ResolvedOffset.light`; `CHANNELS` gains `light` and
`color`, which the sampler already records and the plot has never offered.

Without this a lamp layer renders in the preview and plots nothing: `touched` flips, every plotted
channel stays flat, and the panels read exactly as they would for a piece that does not work.

## The pointer surface is the preview

Core listens for `pointermove` on `globalThis` and maps client coordinates through the **canvas**
rect (`index.ts:450`, `pointerFrame` at `index.ts:722`). A separate pointer surface therefore cannot
exist: hovering one would drive the preview's lamp to a position mapped off the canvas while the
panels claimed something else. The first design's swatch grid doubling as that surface is void for
this reason.

So the preview is the surface. The lab replaces its fixed `CTX` (`App.tsx:17`) with one built by
calling core's own `pointerFrame` on the same canvas rect and client point. Panels and render agree
by construction — the same argument that put `planEffects` in core rather than in the lab.

A lamp being *swept* wants `fixed`, not a hovering hand: a sweep row has to be reproducible.

## Swatch grid

One cell per part at its `ink` centre in em space, tinted by the selected channel at the playhead.

It answers *where*, against the raster's *when*. A lamp's pool has no legible shape in either the
raster or the plot; this is the panel that shows it.

## Tenure and jump

`PassSamples` gains `moved: boolean[][]`, part by sample.

Tenure is each part's run-lengths of consecutive moved columns, in ms. Jump is the distance between
holder-set centroids across a handover, reported in parts and in em. Both derive from the sampled
frame, so nothing reads `roving`'s internals.

The first round measured that no intensity readout can settle `dwell` — across a 4× change the
aggregates are flat, because `unrest` sets all of that. Tenure and jump are what can.

**A layer that addresses everything continuously reports tenure as the whole pass and jump as 0.**
That is the honest reading and a test pins it, because it looks like a broken readout.

## Param sweep

Pick a layer, a param, a min, a max and a step count; run on demand. Each row rebuilds the
`EffectFrame` and re-runs `samplePass` at the same 600 samples the live panels use — 600 resolve
calls a row, so the cost is in the rebuild — then tabulates dark share, longest lit stretch,
coverage (the share of rows some layer ever moved), mean tenure, mean jump, and mean light across
every part and sample.

**A column that does not move is the result.** That is the finding the first round produced:
`dwell` across 1600 / 3200 / 6400 gave dark share 19.9% / 19.9% / 20.3%. The panel marks a column
flat when its spread across the sweep is under 1% of its own mean, rather than leaving a reader to
eyeball three near-identical numbers and guess whether they differ.

## Layout

A two-column deck under a shorter preview. The raster spans both columns; plot, swatch, tenure and
sweep fill the rest. Everything shares the playhead and is visible at once, which is what the lab is
for — the comparisons it exists to support are between panels.

Not labkit's `WorkspaceGrid`, which is how the tube lab and kliegsminister tile, and which would
otherwise be the obvious answer: `render/stage.ts:174` binds resize to `globalThis` and there is no
`ResizeObserver` on an element placement, so dragging a seam would resize the host and leave the
fire at its old size. Filed as its own piece of core work; this lab moves to tiles once a tile can
resize a fire.

## Testing

`sweep.ts`, `tenure.ts` and the extended `sample.ts` are pure and get vitest. The React shell does
not, matching the first round.

## Deferred again

Timeline lanes, and the draft editing pane — `draft.ts` still compiles a hand-authored piece through
a blob URL, and still has no editor.
