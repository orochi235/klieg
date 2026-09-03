# The plate cutter — carving wells into a letter

**For:** whoever builds this slice. Assumes TypeScript and three.js, and that you have read
[wells and fills](2026-09-01-wells-and-fills-design.md) for why the pipeline is subtractive.
**Answers:** what a well is made of, what it costs, and which four seams the slice adds.

A **well** is a recess in a letter's front face. This slice cuts them and leaves them empty; the
`stone` fill that sits in one is the next slice. Empty wells already read as a setting, which is
why this is the first slice that shows anything.

## The construction

Two extrusions of the same glyph, stacked:

- the **slab**, the glyph extruded to `depth - plate`
- the **plate**, the glyph extruded to `plate` with the well outlines as `Shape.holes`, translated
  to sit on the slab's front face

A well's floor is the slab's front cap, its walls are the plate's inner faces, and the plate's
bevel runs around each well for free. No CSG, no new dependency.

**The two become one `BufferGeometry`, not two meshes.** `ExtrudeGeometry` is non-indexed with
`position`, `uv` and `normal`, so merging is attribute concatenation — about fifteen lines, and no
`BufferGeometryUtils` import. It matters because `Word` gives the body one mesh and one material:
merge, and hue, opacity, exit and flake seeding all keep working untouched. Add the plate as a
second mesh instead and every one of those needs new wiring to find it.

## The bezel sets the slab's bevel, and that is the whole reason it exists

A bevelled extrusion's front cap covers only the shape inset by `bevelSize`, ramping down by
`bevelThickness` across that width. So the slab's front face — every well's floor — is flat only
further in than `bevelSize`. A well cut closer to the outline than that has a sloped seat at an
unpredictable depth, which is not a thing a stone can sit in.

In a stack the plate carries the letter's front bevel, so the slab's bevel is buried. All it still
decides is the minimum bezel and the letter's back edge. **So the spec carries `bezel` alone and
the builder derives the slab's bevel as `min(glyphDefault, bezel)`.** A sloped seat is then
inexpressible rather than merely discouraged.

`node spikes/plate-stack.mjs --sweep` counts what the bezel costs, at a 0.068 em pitch and a
0.024 em half-diagonal:

| slab bevel | I | R | H | O | B | total |
|---|---|---|---|---|---|---|
| 0.038 (the glyph default) | 14 | 33 | 35 | 30 | 30 | 142 |
| 0.020 | 20 | 50 | 45 | 56 | 52 | 223 |
| 0.012 | 22 | 61 | 59 | 62 | 64 | 268 |
| 0 | 28 | 70 | 69 | 68 | 74 | 309 |

**`bezel` defaults to 0.012.** Zero buys 15% more seats and takes the letter's back edge with it —
a hard flat band down the stem, which the spike's fourth cell shows.

**The stone's size dominates the bezel.** An `R` seats 33 at the full default bevel with a 0.024 em
half-diagonal and only 5 with a 0.032 em one. Any claim that stems cannot hold stones is a claim
about the stone.

## Cost

`R` with 61 wells: **7,272 vertices to 32,844**, 4.5×. That is a fifth of what the parent design
feared for forty stones a letter, because a bezel-legal lattice never reaches forty on a stem.

## Four seams

**`DecorationBuilder.bodyGeometry?(char, depth)`**, optional, in `render/decorations/registry.ts`.
`Word` builds the body mesh from it when a builder supplies one. **The disposal contract is the
trap and is the reverse of the neighbouring call:** `ctx.glyph()` hands back cache-owned geometry a
builder must never dispose, and `bodyGeometry` hands back builder-owned geometry the builder must.
Keyed on `char`, not on the letter slot, because a letter's wells cannot depend on its neighbours —
so it caches per glyph and disposes once each.

**`WordBuildContext.shapes(char)`** — cached contours on `WordCaches`, beside `glyph()`. A cutter
wants contours and `buildGlyphGeometry` throws its own away. Pays three times over: `tube.ts`
recomputes `glyphToShapes` per missed letter and the debug path recomputes it again.

**A region is a predicate, not a polygon.** `Region.contains(x, y, clearance)` over the glyph's
signed distance field, which already ships as the tube pipeline's `signedDistanceField`. Inside is
negative, so the bezel test is one sample and counters come free — the field already counts them as
boundary. The parent design's "inset is new work — nothing in the tree offsets a contour today" is
wrong, and nothing here offsets a contour. `isoContours(field, -bezel)` gives the same region as
contours should a fill ever want them.

**A cutter is registered.** `Cutter = (shapes, region, spec) => { wells: THREE.Path[]; floor: number }`,
with `lattice` the one implementation: diamond outlines on a staggered pitch, alternate rows offset,
each kept only if all four of its corners clear the bezel. One floor per cut rather than one per
well, because a single plate has one floor; stepped floors come from stacking plates, which this
slice does not do.

Testing the corners rather than the centre is load-bearing. A centre that clears the bezel by less
than the half-diagonal still breaks the letter's edge, and the failure is a stone hanging off the
silhouette rather than anything the count would show.

## What this slice does not do

No fill: wells are empty. No `PartKind` change and no `{ fill: 'stones' }` targeting — `collectParts()`
answers `[]`, so no effect can target a well until the fill slice gives it parts. No shipped look
selects `'well'`, so **all 41 visual baselines stay byte-identical**; that is the acceptance. The
`'well'` kind joins the public `DecorationSpec` union, which is additive and breaks nothing.

## The invariant that has bitten every builder

`collectParts()` walks "highest index written + 1", equal to the letter count only because
`skipLetter` is called for every letter that drew no ink. `WellBuilder` is the third builder, and
the handoff names the third builder as the one that gets this wrong. Assign by index rather than
pushing, and assert slot alignment **once per array** — a single assertion on one array stays green
while a different array is the one that slipped, landing one letter's state on its neighbour.

Keep the ink test on the plain glyph: a letter that drew no ink has no wells either, so `Word`
tests `ctx.glyph()` for ink as it does today and only then asks the builder for a body.
