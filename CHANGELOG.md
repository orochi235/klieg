# Changelog

## Unreleased

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
