# Changelog

## Unreleased

### A fire re-uses what the last one built, and the mount happens before you fire

Glyph geometry and tube blueprints now belong to the instance rather than to one `Word`, so a
repeated fire re-uses them instead of extruding and sweeping the same letters again. They survive
the idle unmount too: a `BufferGeometry` is CPU-side and re-uploads itself to the next context.

Most of the wait was never the geometry, though — it is the driver linking a look's shader programs,
which lands on the first draw and which `renderer.compile()` does not cover. That cannot be cached,
so it is paid earlier: on a `requestIdleCallback` after `createKlieg`, klieg mounts the stage,
builds the environment and draws one throwaway glyph to a one-pixel target. **`warmLook`** names the
look it links, defaulting to `'gold'` — the link is per look, so a page that only fires `neon`
should say so. The warm arms the same idle teardown a settled effect does, so an instance that warms
and never fires gives its context back.

### A host can watch, cancel and advance one effect

Three additions to `fire()`, for an application that plays klieg as a flourish over its own page
swap and needs to know where inside the effect it is.

**`onPhase`** reports each boundary as the effect crosses it: `{ phase: 'active' }` when the enter
has run its length, `{ phase: 'exit' }` when the hold is over, and `{ phase: 'stage', index }` as
each stage settles. `active` is the one a page swap wants — mid-blend, where the word has landed
and is at full presence. The instants are detected per frame rather than scheduled when you fire,
because releasing a `'click'` hold rebuilds the timeline and moves the exit; a schedule fixed at
fire time would be right for every numeric hold and silently never fire for a click hold. A frame
long enough to span several stages reports every one of them. A listener that throws reaches you as
an unhandled rejection instead of stopping the render loop.

**`signal`** aborts one effect without taking the instance and its GL context down with it. An
effect aborted while it is still queued never renders at all. An abort plays no exit and resolves
the promise rather than rejecting it, which is what the promise already meant for an effect the
queue dropped.

**`dismiss: 'host'`** withholds klieg's window listeners — `pointerdown` and Escape both — so a host
that routes its own input gets one action per press instead of two. `fire()` now returns a handle:
the same promise, plus `advance()`, which acts as the dismissing press. An `advance()` that arrives
before the effect starts releases the first hold it reaches rather than being lost to the race.

Because `clickAnywhere` exists to gate a window listener, and `dismiss: 'host'` attaches none, an
anchored placement may hold on a click under host dismissal without the opt-in.

`fire()`'s return type widens from `Promise<void>` to a `FireHandle` that extends it, so existing
callers — `await`, `.then`, `.catch` — are untouched.

## 0.9.2

### An acronym gathers as the lower case finishes leaving

The routine held two pauses between the block and the gather, and both defaulted long. `settle` was
600ms, and the drop stage inherited the 700ms default move even though `place` moves nothing — so
the stage ran 700ms against a 500ms fade and then held another 600. Against `Sequence`, with the
fade landing at 500ms, the gather started at 1300.

`settle` now defaults to 0, and the drop stage declares a zero-length move so its span is the exit's
own length. The gather starts at 560ms — the 60ms being the blend's half-window, not dead air — and
the beat tracks whatever exit it is given: 860ms under `shatter`. `settle` remains for anyone who
wants the pause back.

### A stage boundary no longer throws the word

`Sequence` swapped one `Timeline` for the next and dropped whatever the outgoing one was holding.
A looping `active` is mid-cycle when its phase runs out, so the word lost the loop's whole amplitude
between two frames: `float` alone fell 0.12em and un-yawed 0.1rad in one frame, which reads on
screen as the type jumping down and to the left just as it stops floating.

Each stage's enter slot now carries the pose the outgoing phase ended on, eased to nothing over the
stage. The curve is in-out rather than the usual out — a loop caught mid-swing is already moving,
and an out curve leaves at its own top speed, which is the same jolt in miniature. Sampled either
side of the switch at 60fps, y goes 0.1162 -> 0.1165 where it went 0.1162 -> 0. It costs nothing
when the outgoing `active` is `none`, and applies at every boundary rather than the acronym's alone.

### The tube's cut repairs are named, gated and reported

`buildTubeBlueprint` folds over a named stage registry, and the corner repairs that used to be
inline decisions are now separately named stages, each gated where its decision is made and each
reporting what it did. A blueprint forwards repair toggles into the cut and gets a repair report
back, a relaxed vertex inherits its leg's provenance, and every corner keys its draws on its own
index rather than a shared counter.

## 0.9.1

### The lighting slot turns the studio across the letters again

`sweep`, `track` and the `'sweep'` and `'pointer'` names all turn the environment to rake the
highlight over the type, and none of them has moved a pixel since 0.8.0. The turn was written to
`scene.environmentRotation`, which three applies only to a material falling back on
`scene.environment` — and 0.8.0 gave every klieg material the studio as its own `envMap`, turned by
`material.envMapRotation` instead. A `gold` fire under `'static'`, under the default `'sweep'`, and
under `sweep({ periodMs: 14000 })` layered with `track()` all rendered identical frames. A word now
holds the materials it built and turns each one per frame, alongside the scene write, which stays
for anything carrying no `envMap` of its own.

No baseline moves: every shot is taken under `lighting: 'static'`, where both angles rest at zero.
The visual suite gains the check that would have caught this — one word at two phases of a sweep,
whose frames must differ, with the same two pins under `'static'` as the control. Asserting the
angle reaches the scene, which the unit suite already did, is not the same as asserting it reaches
the pixels.

## 0.9.0

### `roving` visits the whole sign instead of the same seven parts forever

A pass held eight epochs, and each one drew its holder independently, so the fault landed on about
seven distinct parts of a pool of 24 and then looped — the same seven flickering forever, the other
seventeen never once. It got worse the longer the sign: 5 of 55 parts on a word the length of
`CONGRATULATIONS`, which is exactly where a travelling fault most needs to travel.

Two changes. The holder walk is a **seeded permutation** rather than an independent draw per epoch,
so a lap gives every part exactly one turn and each lap reshuffles. And the epoch count is a knob,
**`roving({ epochs })`**, defaulting to 96 rather than 8: a pass now visits every part of a pool up
to 29 and 51 of 55, with deferred handovers costing the rest. The pass lengthens to match — 204s at
the default `dwell`, against 25s.

`dwell` itself was already honest and is unchanged: 3200ms asked delivers 3.15s measured, and every
value from 800 to 9000 lands within 1.6% of what it asked for. What it never controlled is how much
the sign flickers — dark share holds at ~20% across a 4x change in `dwell`, because `unrest` sets
all of that. `dwell` picks who, `unrest` picks how much.

No shipped look uses `roving`, so no look baseline moves. The one visual baseline that does is
`effect-roving`, which pins a moment in the second epoch: a different run is afflicted now. Its
pin still lands on a moment the holder is dark — measured 658 pixels from plain `tubing` and 1558
from `effect-flicker`, which is what the test's two claims rest on.

### The selectable layer sits on the glyphs instead of behind them

`selectable: 'layer'` positions one transparent span per letter by projecting the word onto the
plane of its front cap. It measured that plane at `cameraZ - depth * scale`, but glyphs are built
with `bevelEnabled: true` and three lays the bevel *outside* the extrusion — the geometry spans
`-bevelThickness` to `depth + bevelThickness`, so the cap clears the nominal depth by 0.055 em.
That plane sets the frustum height, which sets both the span font size and the pixels-per-world
the letter positions scale by, so the error skewed the whole layer rather than shifting it.

Spans also take a `scaleX()` where the camera's aspect and the canvas box disagree. A font size
can carry only one axis, so letters otherwise land at the right x with the wrong width. It is 1
for every placement today; nothing enforces the agreement, since the renderer is sized with
`updateStyle: false` and the camera's aspect comes from the measured box.

### An anchored word can hold until a click

`hold: 'click'` threw for every element placement, which crashed the `/show/` route whenever a
share link carried one. The dismissal is a global pointerdown, which works the same anchored; what
the refusal protected against is a strip sharing a page, where a press anywhere ends an effect for
reasons unrelated to it. An anchor filling the viewport has no such press, so the element placement
now takes **`clickAnywhere`** and an anchor that sets it may hold on a click at the top level or in
any stage. One that has not still refuses, naming the flag. `/show/` sets it, which is what lets a
click-held link and an acrostic's click-to-read beat play there.

## 0.8.0

### Every look renders at the exposure it was authored at, and can set its own

`looks.ts` built every material with `envMapIntensity: 2.2` and no material ever rendered at it.
three overwrites that uniform with `scene.environmentIntensity` whenever a material has no `envMap`
of its own, and klieg lights through `scene.environment`, so the authored value was clobbered every
frame and every look has rendered at an effective 1 since the value was written. Materials now carry
the studio as their own `envMap`, which both makes the authored 2.2 live and turns
**`envMapIntensity` into a `LookKey`** — so a look, or an inline spec, sets its own exposure. Every
look is brighter: `gold` measures 0.203 to 0.291 mean luminance over its ink, `leather` 0.231 to
0.343.

### The extrusion walls are no longer gray

A letter is one extruded mesh with one material, so its walls differ from its faces only in what
they reflect — and the studio lit blue from the left against warm from the right. A metal reflects
`baseColor x envRadiance`, and warm times blue is gray, so `gold`'s left-facing walls read as
cement while its faces stayed golden. The fill bars and the shell are warm-balanced now and the two
key lights are left white; `gold`'s mean ink saturation goes 0.497 to 0.664. `chrome` was reflecting
a blue room and reads as neutral metal for the first time.

### `oil` gets its colour from its own film rather than from the room

`oil` is a near-black metal, so what you see is reflected light tinted by a thin film — which meant
its oil-slick colour was really the studio being two-toned, and warming the fill flattened it to
brown. Thickness sets how fast the film's hue cycles with view angle, so `iridescenceIOR` drops to
1.4 and `iridescenceThicknessRange` to `[100, 520]`: a thinner film at a lower index cycles through
more of the wheel across the angles an extruded letter presents. It now covers 10 of 12 hue buckets
against the shipped 7, at higher saturation and slightly brighter.

**Every visual baseline moves.** All 19 are regenerated.

### An anchored word now meets the page's text edge

`framing` said how much of the anchor the type could fill and not where in it the word sat, so an
anchored masthead floated off the page's text edge — a gap a consumer could only close by padding
the anchor asymmetrically, in a number measured to one name at one size. `framing.align` places it,
in reading order: `'start'` is the left edge of an `ltr` box and the right edge of an `rtl` one.

**An element placement now defaults to `'start'`**, because a page has a text edge and meeting it is
usually the point of anchoring; pass `align: 'center'` for the old behaviour. A fullscreen overlay
has no edge to meet, and is centred as before.

Three things worth knowing about what it measures. It aligns at the size `width` and `height`
already chose, against the whole box rather than the share those fractions cut out of it — so
reaching an edge does not mean widening the framing and resizing the sign to get there. It measures
the **painted** silhouette rather than the advance span the fit is scored on, bevel included and at
the depth of the nearest paint, so what meets the edge is the lit edge of the glyph and the
extrusion never lands outside the box for the canvas to clip. And it survives a regroup, tweening
with the fit rather than jumping when the letters re-lay.

### A flickering tube can now rest

`flicker` gained `spell` and `calm`: the milliseconds of one flickering bout, and the milliseconds it
holds steady between them. `EFFECTS.flicker({ duration: 60000, spell: 4000, calm: 15000 })` stutters
for four seconds, sits quiet for fifteen, and does that three times a minute. Both scales snap to a
whole number of the ~58ms steps the stutter already runs on, and the pass becomes the nearest whole
number of bouts-plus-calms — so the 60s asked for above comes back as 57.05s, and a pass shorter than
one cycle grows to fit it. Either scale on its own does nothing: a `calm` without a `spell` leaves the
tube flickering throughout, as before.

### Lighting composes, and light can land on one letter

`lighting` takes a piece, or an array of them, wherever it took a name — the shape `enter`,
`active` and `exit` already had. `sweep({ periodMs })`, `still()` and
`track({ yawRange, pitchRange, followMs })` build one, so the periods and swing ranges that were
module constants are arguments now. The layering is not the motion slots', though: each piece runs
on its own `duration` rather than sharing the slot's, with nothing holding a phase between them.
Pieces add per axis, so layer ones that write different axes — two sweeps give a single turn at the
summed rate, not two you can tell apart.

Every one of those turns the whole environment at once. `lamp()` is the other half — an effect
piece that puts light on the parts near a position and leaves the rest of the sign alone, so the
cursor can light the letters it passes. `fixed(x, y)`, `orbit({ radius })`, `along([...])` and
`fromPointer()` say where the light is; `fromPointer` is the default, and it contributes nothing
until the pointer has been inside the canvas rather than parking a lamp in the middle of an
untouched page.

Light lands on `PartOffset.light`, a new additive channel carrying a lamp's colour and amount. A
multiplier could not carry it: `emissive` defaults to black, so scaling it is a no-op on every look
but `neon`.

A lamp lights by position against a part pool fixed at construction, so it does not follow a
`stages` regroup: after the letters re-lay, the light stays where they were, and on a centred sign
that has dropped letters a cursor over the type can light nothing at all.

### `lighting: 'pointer'` now sees the canvas rather than the window

It normalized the cursor against the viewport instead of the canvas box, so an anchored sign in a
small element only ever saw the slice of the yaw range its own box covered — the highlight barely
moved while the cursor crossed the type. It reads the canvas box now, and the swing that was a
module constant is `track({ yawRange, pitchRange })`.

### A short contour now renders as fewer tubes rather than none

`runs` is a budget, and the cut used to spend all of it before dropping any piece under `minRun` —
so a contour too short to carry the requested count lost every piece and rendered nothing at all.
`TubeSpec.runs` already documented itself as bounded above by `minRun`; now it is. A contour is cut
into as many runs as clear the floor.

Text almost never reached this: a period is not a perfect circle, so it gains corners and survives
at 0.82 em of perimeter. A smooth closed contour did, and vanished below about 0.96 em — which
vector art hits immediately, since logo marks are full of true circles.

The old behaviour is `TubeSpec.shortRun: 'drop'`, because it has a use: small detail falls out of a
sign rather than being drawn coarsely. `'fit'` is the default.

### Changed

- A `flicker` step is now derived from the pass rather than fixed at 24 a pass, holding it near 58ms —
  about three frames, which is what keeps a drop reading as a failing tube rather than as noise.
  `flicker()` at the default 1400ms duration is unchanged. A custom `duration` renders differently,
  and a long one no longer strobes: 30s used to mean 24 steps of 1250ms each.

### Breaking

`EffectPiece.at` takes a third parameter: `at(t, part, ctx)`, where `ctx` carries the pointer and
the milliseconds since the last frame. Implementing the interface is unaffected, since a piece that
ignores the parameter is still assignable — but code that *calls* `.at(t, part)`, which is what
wrapping or unit-testing a piece of your own looks like, no longer typechecks. `FrameCtx` and
`LightOffset` are exported for it.

`MotionPiece.envRotation` and `CycleSpec.envRotation` are gone. Hijacking a motion piece was the
old way to rake the highlight, and the slot says it directly now. An `active` of
`cycle(3000, { envRotation: true })` becomes `lighting: sweep({ periodMs: 3000 })`.

## 0.7.0

### The rendered word now exists in the DOM

klieg's only DOM element was a `pointer-events:none` canvas, so the fired text was invisible to
copy-paste, Ctrl+F, screen readers and crawlers. A new `selectable` option puts it in the DOM as
well: `'hidden'` (the default) is a visually-hidden node, `'layer'` is a transparent per-letter
layer a drag can select, and `'none'` opts out for a page whose own markup already carries the
string. `'layer'` takes pointer events on the letters themselves, which is why it is opt-in rather
than the default — every other caller keeps klieg's click-through guarantee unchanged. It also
needs the word to hold still, and falls back to `'hidden'` with a console warning under a
`transform` or a motion piece that moves the letters.

### `tint` now reaches `tubing`

A tint on a look with `tintTo: 'decoration'` was written to the decoration material's colour
channel, which `tintByRunColor` then sets to white so a run's own colour drives it exactly. The tint
was gone before the first frame: `tubing` rendered its native magenta whether tinted or not. The
tint now recolours the palette the runs are dealt from, which is where a tube look's colour actually
lives — so it survives, and composes with the effects compositor rather than racing it. The tint
becomes the run's palette entry exactly; what reaches the screen is that colour through the look's
emissive gain and then bloom, so a bloomed tube reads as the tint's hue rather than its literal
value. `piping` and `sequin` were never affected and render byte-identically.

### Material properties no longer vanish from `LookSpec` for a TypeScript consumer

`look: { ...tube.look, emissive: 0x22d3ee }` failed with *"'emissive' does not exist in type
`MaterialSpec`"* after nothing but `npm i klieg three`. `LookKey` shipped as a live
`Extract<keyof THREE.MeshPhysicalMaterial, …>`, so a consumer re-evaluated it against their own
three — and three's exports map carries no `types` condition, so without `@types/three` it resolved
to nothing, `keyof` collapsed, and every property disappeared. It now ships as a literal union, so
the types are self-contained; a repo-side assertion still fails the build if a key stops naming a
real material property. `@types/three` is also declared as an optional peer dependency.

### `crawl` slides a colour ramp along a part

A new `chase` piece drives it, and `EffectSpec` accepts `chase` by name. The offset reaches the
shader as a per-vertex attribute beside `gradientT` and wraps with `fract`, so a chase cycles rather
than pinning at the ramp's end.

Both shipped looks are flat, so `crawl` does nothing on them: it shifts a ramp, and needs a caller
who sets `TubeSpec.gradient`.

## 0.6.0

### `flip` now appears face-on, not back-on

`flip` hides the letter while it is edge-on, because a half-turned extrusion reads as a stray edge
rather than a glyph. The step that did the hiding compared the *elapsed* ease against 0.05 where it
meant the *remaining* turn, and `easeOutCubic` clears 0.05 in the first 1.7% of the pass — so the
letter appeared 171 degrees from rest, nearly fully reversed, and turned the rest of the way in
full view. It now appears at 9 degrees, having stayed hidden for the first 63% of the pass.

### A wide anchor no longer merges the glyphs

An element placement lifts `FIT_CAP`, so the word scales up to fill its anchor. Against a masthead
strip the fit then put the outer glyphs past 70 degrees off-axis, where an extruded letter is seen
near enough to edge-on that its side wall projects across its neighbour: `Michael Baker` in a
1180x116 anchor rendered as one merged mass. The camera now takes a longer lens as the box widens —
`z` grows until the frustum edge falls within 35 degrees and `fov` narrows to hold the frustum
height at the word's depth, so every framing fraction keeps its meaning and the type keeps its size.

A box narrow enough to already be within that angle keeps the base lens exactly, so a fullscreen
overlay is unchanged; the 23 visual baselines pass untouched.

## 0.5.1

### The type can be anchored inside a page element

`createKlieg({ placement: { kind: 'element', el } })` puts the canvas inside one element of the
page instead of over the whole viewport, so a masthead can carry the type with the rest of the
page laid out around it rather than under it. The canvas is `position:absolute;inset:0` within the
anchor, which carries it on every move for free, and a `ResizeObserver` reports the box changes no
window resize event ever sees. `framing` needs no new units: it was always a share of what the
camera sees, and the camera now frames the anchor.

Placement is fixed for an instance's lifetime, so it moved to `createKlieg`; `FireOptions.placement`
is deprecated and was never read. An element placement is its own parent, so passing `target`
alongside it throws rather than silently picking one, and `hold: 'click'` is refused because every
meaning it could carry can hang — a window listener dismisses on clicks unrelated to the strip, and
one scoped to the anchor never fires once the anchor scrolls away.

Anchored, the fit is no longer held to the 2.2x ceiling on upscaling past natural glyph size. That
ceiling keeps one short word from swallowing a fullscreen overlay, but against a short wide strip it
binds long before the framing does and starves the fit; the anchor's box is the bound instead.

The `strip` route in the lab exercises it: an anchor deliberately left `position: static`, resizable
by hand, with page content above and below.

## 0.5.0

### The light can follow the pointer

`lighting: 'pointer'` aims the environment at the cursor instead of turning it on a clock, so the
highlight rakes across the type as the viewer moves. One `pointermove` listener serves mouse, pen
and touch alike, and it neither captures the pointer nor cancels the event, so a page already
dragging keeps its gesture — on the `show` route one finger turns the word and moves the light
together.

Until a pointer arrives it holds the same pose `static` does, pixel for pixel, which is what a
fresh load and an untouched iframe get. Reduced motion snaps to the pointer rather than easing.
Nothing defaults to it: `lighting` still defaults to `sweep`, and the `show` route still to
`static`, so no existing call or URL changes. Being a `LightingName`, it is shareable in a `show`
URL as `{"lighting":"pointer"}` and appears in `LIGHTING_NAMES` for any picker built from it.

### The type can be told to fill more of the frame

`createKlieg({ framing })` sets the share of the viewport a word is fitted into, per axis; the
library's own 0.62 wide by 0.3 tall was previously unreachable. An overlay over a live app wants
that room left, but a page that is nothing but the type does not. An omitted axis keeps its
default, so nothing already written changes size.

### A run vertex knows where it came from

Every point in a tube run now records the contour vertex it was extracted from, or null where the
corner stage built it analytically. `Run.from` is index-parallel to `Run.points`, and its entries
are `VertexSource` (`{ path, index }`) or null.

This replaces a `WeakSet` that tracked only the second of those. Keyed on object identity, it was
lost by anything that copied a point — and losing it is silent: the sweep smooths an arc built at
the minimum bend radius, and the run ships under minimum with nothing thrown.

Internal to the tube pipeline. `Run` and `VertexSource` are exported, but no existing published API
changed shape.

### Paths are traced, not rasterized

`TubeSpec.pathSource` now defaults to `direct`, which traces the glyph's own contour instead of
rasterizing it to a 256 grid and re-extracting the isocontour. The grid displaced the path 4–7% of
the tube radius and manufactured corners that were not in the glyph; the trace is accurate and
builds a letter in 19 ms against 1800 ms. `field` and `exact` remain selectable.

**This changes how the shipped tube looks read.** A path source decides where the cut falls, so
`assign` paints a different lit-run pattern from the same seed. The `tubing` baselines are
re-recorded; `piping`'s did not move, though they trace inset and cannot see its cord.

An inset under `direct` no longer depends on the caller's winding. Rings are rewound by role —
outer positive, hole negative — before the offset, and an inset deeper than a shape's own
half-width now empties the ring rather than folding it back inside out.

### Every fillet-to-path junction holds the bend minimum

A run could measure tighter than `bend` allows at the splice where a fillet meets its legs: a leg
point survived inside the setback, a closed contour closed onto a point its last arc had passed,
and a leg resumed a fixed step from the tangent point instead of where the junction itself cleared
the floor. Across both looks, 26 letters, three path sources and wander on and off, runs under the
minimum go 33 to 7, and the worst bend 0.11 to 1.70 times the tube radius.

### Tube geometry

The tube is one diameter. `sweepRun` used to shrink a whole run to 0.8 of its tightest curvature, so
one sharp corner set the thickness of everything it sat in — `piping`'s cord drew at 26–69% of the
0.03 it asked for, on every letter of the alphabet. Diameter is now held exactly and the *path* is
what bends: `bend`, a new per-look field, states the minimum bend radius as a multiple of `radius`,
corners are classified against it rather than by turn angle, and a corner the glass cannot take is
filleted with a tangent arc or cut. Across all 26 letters, 1 of 225 runs on `tubing` and 1 of 49 on
`piping` still bend tighter than that minimum, against 26 of 26 clamped before.

Run ends are sealed. The sweep emitted its wall and no cap, so every run terminated in an open hole.

**A corner can now carry the tube past the light instead of cutting it.** A working neon unit has no
free ends — every end is an electrode or a seal — and a bender who needs a stroke to stop bends the
tube out of the plane and paints the return with blockout. `blockout` weights that against a real
cut, which is still right at a letter's terminus. `tubing` asks for 0.7.

### Color gradients

`TubeSpec.gradient` sweeps a color ramp over a tube look instead of lighting every run flat.
`domain` chooses what the ramp is measured along: `run` and `letter` run 0 to 1 along one tube or
across one glyph, `runIndex` and `surface` give a single value per lit run or per layer, and `axis`
and `radial` place it across the whole word. `mode: 'replace'` paints the ramp; `modulate`
multiplies each run's own color by it, keeping the look's palette and shading it. `stops` are sRGB
hex and interpolate in linear space, so a pink-to-cyan fade does not pass through gray.

No built-in look sets it, and without it every run is flat as before.

### `sequin` is sewn on

`sequin` was a freely tumbling square standing a third of its own size off the letter. It is now 520
discs lying nearly flat on staggered rows — sewn on rather than landed there. Three fields on the
chunk generator do it, each inert at its default, so a `decoration` of `kind: 'chunks'` you wrote
yourself places exactly as before.

`ChunkSpec.lie`, 0..1, is how flat a chunk lies on the surface it sits on, applied after `align`. It
turns the chunk onto that surface's outward normal by the shortest arc, so the chunk keeps the spin
its tumble gave it. From 0.8 up no chunk can face into the letter, so the field renders `FrontSide`
and stops drawing the chunks on the far side of the glyph — turn the word and they come back.

`shape: 'disc'` is a twelve-segment circle beside `flake` and `cube`.

`BeddingSpec.pitch` puts sites at a fixed spacing along each bed with alternate beds offset by half a
pitch, and `.jitter` is how far off its site a chunk may stray, as a fraction of the pitch. A site is
a rejection rather than a snap, so no chunk is carried off the letter to reach one. Omit `pitch` and
bedding places chunks freely along a bed as it always has.

### Breaking

`loop` is gone from `CornerStrategy` and `CornerWeights`. Bridging a corner with a full turn of tube
cannot be built to hold the bend minimum inside the advance any run in a glyph has, and it is not a
move an outlined solid volume wants. A spec still setting `corners: { break, connect, loop }` will
fail to typecheck; drop the field and the weight redistributes over the other two.

`amplitude`'s depth wander now runs before the cut rather than after, so it wanders a contour as one
piece rather than each run separately. Its own curvature cap is gone — the corner stage sees the bend
and handles it — and a wandered word will not reproduce a previous seed's exact geometry.

**`pyrite` is gone**, and with it the name from `LookName`. It was built on the wrong model: the
chunk generator sticks a chunk on each sampled surface point, where pyrite needed crystals grown out
of the matrix — and measurement put 59.2% of them on the extrusion band against 12.9% on the front
cap, so it read as an outline effect. The respec that would have fixed it was not worth shipping. A
spec naming it fails to typecheck; a `show` URL naming it falls through to the default look cycle.

## 0.4.0

### Breaking

**The package is now `klieg`.** `blitsklieg` on npm is deprecated and points here; its published
versions stay resolvable, but nothing further ships under that name. The entry points rename with
it — `createBlitsklieg` is `createKlieg`, and the `Blitsklieg` and `BlitskliegOptions` types are
`Klieg` and `KliegOptions`. The lab workspace is `@klieg/lab`.

### Looks

Four looks that add a second geometry and material per letter, from two generators.

| look | reads as |
|---|---|
| `tubing` | glowing tube piped around a near-invisible volume; turns bloom on by itself |
| `piping` | corded seam running the edge of a hide |
| `sequin` | chunky glitter that breaks the silhouette |
| `pyrite` | intergrown cubic crystals on a dull matrix |

`neon`, `glitter` and `leather` are unchanged, and stay the cheap solid variants.

`LookSpec` gains three optional fields: `decoration` describes the second geometry and its own
material, `opacity` sets the body's base opacity, and `tintTo` chooses whether `tint` recolors the
body or the decoration. `DecorationSpec` and `MaterialSpec` are exported.

### Changed

Each letter now carries its own material rather than sharing one across the word. A staggered
enter therefore fades each letter on its own schedule; previously every letter wore the most
visible letter's opacity, because one material cannot hold thirteen values. Measured cost is
+0.066 ms/frame inside `render()` at 50 letters, against a 16.7 ms budget, with the compiled
program count unchanged.

Flake looks no longer clone a glyph geometry per letter. The per-letter seed rides a uniform now
that materials are per-letter, which is a straight memory saving for `flake`, `glitter` and
`leather`.

### Fixed

The lab passed `bloom` unconditionally, so an unchecked box sent `false` — which wins over a
look's own request. No look could bloom there, and `neon` has advertised that it blooms by itself
since 0.3.0 without ever doing so in the lab or in its baseline. Consumers passing no `bloom` were
never affected.

## 0.3.1

### Fixed

`flake` and `glitter` were tuned on a retina display at cell sizes that fall past the top of the
shader's aliasing fade on a 1x one, where both smoothed to a flat sheen and lost their sparkle
entirely. Their cells are now coarser — full strength at DPR 2, and still clearly present at
DPR 1. Density is unchanged; only cell size aliases.

## 0.3.0

### Breaking

`ruby` is now `gem`, with no alias. It also gained `dispersion`, which splits transmitted light
into rainbow fringes at the edges — the reason the name changed.

`sweep` has left `active`, and `active` now defaults to `'none'`. It never contributed a
transform; it existed only to tell the stage to rotate the environment. Living in a motion slot
also meant its period came from whatever the longest layered sibling happened to be, so
`active: ['float', 'sweep']` silently stretched its tuned 3400ms to 5200ms.

The minimum Node version is now 24.

### Lighting

`lighting` is its own option, orthogonal to all three motion slots and running across the whole
timeline rather than the active phase. `sweep` rakes the highlight on its own period, `static`
holds the environment still. It defaults to `sweep`, so the type stays lit whatever the motion
is doing.

A piece built with `cycle({ envRotation: true })` still drives the environment, and overrides
the option while it is active.

### Six looks

`velvet` is a matte nap that lights up at grazing angles. `neon` glows, and turns the bloom pass
on by itself unless you pass `bloom: false`. `flake`, `glitter` and `leather` share one
procedural shader that cuts object-space position into jittered voronoi cells — a plain lattice
sliced by a flat glyph face reads as a pixel mosaic at any scale.

`flake` and `glitter` sparkle by sharpening each cell into a tiny mirror, so only the few
aligned with the environment blaze while the rest stay dark. `leather` uses the same cells as
upholstery panels instead, each bulging slightly and creased where it meets its neighbours.

Each letter seeds its own flake field, so repeated letters do not sparkle in lockstep.

### Materials of your own

`look` now takes a plain object as well as a name — every field a number, no three types in your
signatures. Out-of-range values clamp rather than throw. `tintTarget` overrides which channel
`tint` writes to when the default routing guesses wrong.

## 0.2.1

### Fixed

Mixing names and pieces in one layered slot — `active: ['sweep', myShimmer]`, which the 0.2.0
README documented — was rejected by the types and broken at runtime: names inside an array were
passed through unresolved, leaving a bare string where a piece was expected and turning the
slot's duration into `NaN`. Arrays now accept either and resolve names in place.

The install notes now mention `@types/three`, which TypeScript consumers need because three
ships no declarations of its own.

## 0.2.0

### Multiple lines

`\n` in the text breaks a line, and each line centers on its own. `wrap: true` additionally
chooses breakpoints for you, picking whichever arrangement renders *largest* rather than fitting
to a column count — so it wraps only when wrapping makes the type bigger, and short text stays on
one line. Words are never split.

A newline is now consumed as a separator rather than laid out, so it no longer renders as a
`.notdef` box mid-word.

### Holding until dismissed

`hold: 'click'` keeps an effect on screen until the viewer presses a pointer or Escape, then
plays the exit normally. The dismissing click passes through to your page by default; `modal:
true` makes the overlay swallow it instead. Under the default `queue` policy a held effect blocks
later fires — use `replace` if a later effect should cancel it.

### Tint

`tint` recolors any look to your own color, keeping the rest of the material. It goes to
whichever property carries that look's hue — the base color for the metals, attenuation for
`ruby`, whose red comes from what light picks up passing through it rather than from its base
color.

### Writing your own motion

`enter`, `active` and `exit` now take a built-in name, a `MotionPiece` you built, or several
layered together (`active: ['float', 'shimmer']`).

- `transition(duration, spec)` builds an arrival or departure from `from`/`to`/`keyframes`, with
  `ease`, per-channel `easeBy`, and `stagger`.
- `cycle(duration, spec)` builds a looping idle from per-channel `amplitude`, `harmonic` and
  `phase`. `envRotation: true` rakes the environment highlight, which is what `sweep` does.
- `spring({ stiffness, damping, mass })` returns a closed-form easing curve, so it stays a pure
  `(t) => number` and goes anywhere an easing goes.
- Stagger takes `spread` or `each`, and `from: 'start' | 'end' | 'center' | 'edges' | 'random'`.
  `grid: true` measures the order radially over a multiline block.

`Easing` is exported and is `(t: number) => number`, which is also `d3-ease`'s signature — bring
any curve library you like. klieg still depends only on `three` and `opentype.js`.

All thirteen built-in pieces were rewritten on this vocabulary and are unchanged to within 1e-8,
pinned by a golden fixture.

### Internal

`poseAt` writes into a caller-owned pose instead of allocating roughly ten objects per letter per
frame. A timeline slot holds layers, which is what lets two active pieces run at once.

## 0.1.0

First release.
