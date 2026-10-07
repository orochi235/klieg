# Text, glyphs and placement

**For:** whoever changes glyph building (`text/`), layout, or how a word is fitted and placed.
**Answers:** what the glyph pipeline does that a font does not, and why a fitted word is the size it
is.

## Glyphs

- **A glyph is commonly several overlapping strokes, and `glyphToShapes` unions them.** A
  rasterizer's non-zero fill unions for free; extruding each contour as its own solid put two
  coplanar caps wherever strokes crossed — 13.59% of Cinzel's `A` cap. The kernel is
  `polygon-clipping` (exact, Shewchuk predicates). Where the union provably changes nothing, the
  original curve-backed shapes are returned, so seven of eight faces never reach it.
- **Do not reach for `clipper2-js`**: it declares `@angular/core` as a peer every consumer would
  inherit.
- **`polygon-clipping`'s ESM build exports only a default**, while its `.d.ts` declares named
  exports. A named import type-checks and resolves to nothing under a bundler.
- **Sample a curve by how far it bends, never to a fixed count.** Subdividing to `FLATNESS` (1e-4
  em) gives 5,552 points across Cinzel's capitals against 16,311, and takes `HAMBURGEFONS` from 72.0ms
  to 24.7ms on a first fire. Two routes measured and not taken: unioning only overlapping contours
  (a serif face's strokes all touch, so 3 of 141 stay on their curves), and simplifying after the
  union (removes exactly the vertices the boolean adds, and can push a thin stroke through itself).
- **The rendered extrusion still samples at a fixed `curveSegments` (10)** in `text/glyphs.ts`, so a
  long stroke facets — a hard crease across great-vibes' capital `M` at masthead size. `flatten()`
  serves the analysis polygons only.
- **three caps a runaway bevel miter at √2 bevels**, so a corner under 90° lands that far along its
  bisector however sharp it is — a nub on Cinzel's `A` apex. Corners under 60° are cut back half a
  bevel first. `node spikes/bevel-spur.mjs AN --face cinzel --svg out.svg`.
- **A counter can enclose no area.** rye's `A` and `G` draw a line out and back 0.003 em long;
  moving it inward collapses the ring and earcut throws from inside `eliminateHoles`. Rings without
  three corners are left alone.
- **`nest()` reads winding, not containment depth**, or a serif face drawn as overlapping
  same-wound strokes fills its counters.
- **`K` and `k` in Archivo Black have non-parallel arm sides** — 1.31° and 2.56° apart — and a bevel
  turns that into a visibly tapering highlight. That is the typeface.
- **`glyphToShapes(font, char, size)` silently builds in font units without a size** — about 53x too
  large. Measure with `buildGlyphGeometry(font, char, 1, DEFAULT_GLYPH_OPTIONS)`, as the renderer
  does. Classify a cap by its normal, not by z: the bevel stands proud of the cap plane.
- **A `.ttc` unpacks for 40 of 49 system collections**; Helvetica, Times, Courier and Menlo hit an
  opentype.js `cmap` limit after unpacking.

## Layout

- **`@weasel-js/text` places; klieg draws.** Every fire lays out through `layoutRuns`, fed klieg's
  own advances and kerning through the `parser` hook, but klieg keeps its own glyph pipeline.
- **weasel's font registry is module-global**, so two physical copies of `@weasel-js/font` are two
  registries and every run is skipped with no warning. `npm ls @weasel-js/font` must show one entry.
- **`trimmedWidth` stays even though weasel fixed the bug it guards.** A wrapped line's trailing
  space once shrank every wrapped sign by up to 9%, found only by comparing 18 text/budget pairs
  across engines.
- **Bidi is a switch, not a rewrite**: `layoutRuns` takes a `BidiResolver`, and klieg honors the
  cell contract — a cell's right edge is `x + advance`, never the next cell's `x`.
- **`lineAlign` defaults to `'start'`** because centered lines scatter an acrostic's initials across
  as many x positions as there are lines.

## Fitting

- **`framing` does nothing on a fullscreen overlay for a short word.** The fit takes the smaller of
  the two budget axes and `FIT_CAP` (2.2), and the cap binds. Only `placement: element` lifts it
  (`viewportBudget` in `render/stage.ts`).
- **A wide anchor takes a longer lens.** `lensFor` grows `z` until the frustum edge falls within
  `MAX_HALF_ANGLE_DEG` (35°) and narrows `fov` to hold the frustum height, so an outer letter's side
  wall does not project across its neighbor.
- **Alignment measures the paint, at the depth of the nearest paint.** A glyph's geometry runs a
  bevel (0.038 em) past its outline and further at an acute miter, so tests measure the drawn
  meshes' bounding box. Aligning the world-space extent put the near cap 16px outside an anchored
  canvas; `alignOffset` measures against the box edge at the frustum depth of the nearest paint, so a
  word can only land a hair inside. `'start'`/`'end'` resolve against the box's `direction`
  (`edgeFor`); an element placement defaults to `'start'`, a fullscreen overlay to center.
- **A sign does not render smaller than the fallback heading it replaces — the string decides.**
  Short names are height-bound and clamp at the height budget; long ones go width-bound and lose
  height per letter. Any single scale trim is right at one name length only. `framing.width` is the
  size lever and `align` the position lever. `node spikes/fallback-gap.mjs` measures it; count ink
  at `alpha >= 128`, or a tube's glow measures the light and reports the word as tall as its box.
