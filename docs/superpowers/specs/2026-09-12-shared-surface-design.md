# The shared surface: klieg labs as tenants of one renderer

**For:** whoever builds it. **Answers:** what labkit already owns, what is left for klieg, what to
build first, and which traps are known before anyone starts.

**Status: unbuilt.** Nothing below is implemented. Written 2026-09-12, against labkit 1.4.4 and
`@weasel-js/labkit/surface`.

klieg has seventeen browser UIs and no two share a shell. Every new one begins by copying the
nearest: `font.ts` is byte-identical in three labs, `cell.ts` is a near-copy across two more, and
`ShowConfig` went a whole release mapping `exit` and `eyeX` to the same wire key because exactly one
surface exercises it. This is the fix for the cause, not for any one of the seventeen.

## The seam already exists, and klieg wrote its own copy of it

`@weasel-js/labkit/surface` — a declared subpath of the **1.4.4 already installed here** — publishes
rects, a dirty set, DPR and one rAF, and leaves the GL to the consumer. labkit contains no WebGL at
all; that is the design, not a gap.

`dev/shared/lab-renderer.ts` is a private reimplementation of the owner half, down to the reasoning
in its comments. klieg's `clear()`:

> The gutters lie outside every scissor, so a re-tile strands the old panels' pixels there.

labkit's `surface/AGENTS.md`, independently:

> Gutters lie outside every scissor, so a tile that moves leaves its old picture where nothing will
> paint over it.

The same is true of the rect arithmetic: `toDeviceRect(rect, surfaceHeight, dpr)` does the y-flip and
the device-grid snapping that `lab-renderer.ts:67-74` does by hand, and both carry the same note
about a panel and its neighbor rounding apart and stranding a column.

`<Lab>` calls `useSurfaceOptional()`, so a lab under a host that already owns a surface mounts no
buffer of its own. **A klieg-owned three.js renderer with labkit labs as tenants is the shape labkit
intends**, confirmed by its author.

## The division

**labkit owns the chrome and the geometry**: tiling, tile measurement, dirty tracking, DPR, the
frame clock, device rects, the shell, and navigation between sibling labs.

**klieg owns what a tile paints and what a surface is showing.** Neither is anything labkit could
know about, and both are where the duplication and the untested format actually live.

## What klieg builds

**A surface host.** Owns the `WebGLRenderer`, the environment map and the bloom path, and drives
`useTiledSurface({ onFrame })`. It keeps the draw half of `LabRenderer` and deletes the measurement
half — the `getBoundingClientRect` loop, the rect map, the `ResizeObserver`, the snapping.

**A cell.** Builds a `Word` in a look and font, advances it on a clock, and fits it to a rect. One
implementation replacing `lab-view.ts` plus the two near-copies of `cell.ts`. This is the piece a
new surface most wants and most often retypes.

**A surface state, last and not yet.** `ShowConfig`'s discipline — short keys, independent
validation, defaults on the way out — with the wire keys allocated from the declared fields rather
than kept by hand in a table. `ex` was a hand-maintained table; a surface should not be able to
spell two fields the same. It is named here because it is the third thing a surface needs, and
deferred because it has one caller: generalizing it now would repeat the mistake it exists to fix.
It earns the work when the front page becomes the second.

## The method: prove it by subtraction

**Two callers before anything is shared.** A shared thing with one caller is what `ShowConfig` was.

Migrate **tube-lab and tube-gallery** first. They already share `LabRenderer`, so they are two
callers on the first day, and the change deletes code rather than adding it — if the migration does
not come out shorter, the abstraction is wrong and the result says so before anything is built on
it. Whatever survives being used twice is the kit. The front page is its third caller, not its
first.

## Traps

**Keep clearing the whole buffer.** labkit 1.4.4 has no seam for a tenant to clear the gutters: a
tile that moves leaves its old picture where nothing paints over it. `SurfaceHandle.registerClear`
and `SurfaceFrame.retiled` fix it and are unreleased. klieg's existing full-buffer clear each frame
sidesteps the bug entirely, which is why the surface can be adopted on 1.4.4 today — but only while
that clear stays. Dropping it for per-tile painting before those land reintroduces the bug.

**A tile that moves without resizing is missed, and klieg has this latently today.**
`node.placementChanged` fires when a move is ordered, not when it lands, and a `ResizeObserver` has
nothing to report for a pure move — so a panel whose size settles while its position animates paints
for the rest of its life where it was caught mid-flight. labkit's unreleased fix keeps measuring
until two measurements agree. Until then, call `invalidateRects()` on anything moved that the grid
does not know about.

**A tile id is scoped to its trial.** `useSurfaceTile` registers under `useTileId(id)` —
`<trial>/<id>` inside a trial — and a frame's `rects` are keyed the same way. Unscoped, the second
trial of an instrument takes the first one's rect *and* its painter, and the first is never told it
moved again. klieg's present tile map is flat and would collide the moment a lab shows two of
anything.

**A clear must be registered, never run from a painter.** Tenants paint in sequence, so a tenant
clearing inside its own painter wipes whichever drew before it. Every registered clear runs before
any painter.

**`preserveDrawingBuffer` is the consumer's job and is effectively required.** klieg already passes
it, with the right reason written down.

**`toDeviceRect` returns CSS pixels**, because three.js applies its own pixel ratio. Raw WebGL would
multiply; klieg must not.

**labkit's theme restyles bare controls.** `:where(.lk-root)` sets height, border, backdrop-filter
and hover on every bare `<button>`, and replaces the track and thumb of every
`<input type="range">`. Every klieg rail is bare controls, which is why three labs take labkit's
tokens while withholding the class. Adopting the shell means restyling the rails on purpose.

## Ruled out — do not re-propose

**A klieg-local tiling kit.** It exists upstream, it is published, and klieg has already paid for
writing half of it twice.

**Adopting `<Lab>` wholesale for the three GL labs.** Its shared canvas sits *above* the trials at
`z-index: 1` with `pointer-events: none`; these labs need one *behind* the tiles, in the coordinate
space their rects are measured in. `<Lab>` also fixes `Workspace`'s gap, padding and viewport, and
offers no lab-level rail — and a rail is what all three are built around.

## What is not settled

**Whether `BloomPath` survives the painter model.** It already takes a rect, so it should, but it
renders through its own targets and nothing has driven it from a labkit frame.

**Whether klieg's labs become labkit trials or stay plain tiles.** Only trials get the per-trial
chrome, and only trials need the id scoping above. tube-gallery deliberately does not want drag or
resize.

**Release timing for the unreleased fixes** — `registerClear`, `SurfaceFrame.retiled`, and `<Lab>`
gaining `pages`/`path` (`f233e304`, which is what would end kliegsminister's dead end). All sit on
an unmerged branch. That is Mike's call, and the plan above is deliberately shaped to need none of
them.

**Whether the state format is worth generalizing before a second surface needs it.** By this
document's own rule, it is not — `ShowConfig` has one caller. It earns the work when the front page
becomes the second.

## Cleanups this work passes through

`tube-lab/src/styles.css` styles `.lk-trial-tile__grip` and `.lk-trial-tile__body`; neither class
exists in labkit 1.4.4, whose shipped CSS emits only `lk-trial-tile`. Both rules are dead.

`tube-lab/src/persist.ts:7` says labkit declares `TrialLayout` but does not export it. It does, and
the `ComponentProps` indirection can go.
