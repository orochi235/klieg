# Wells and fills — the decoration pipeline for the next major

**For:** whoever builds klieg's next major version. **Answers:** what replaces the single
`decoration` slot, and why the replacement is subtractive.

A letter is a solid volume. This pipeline **carves wells into it and fills them**. A well is a
recess; a fill is what sits in the recess; the metal left standing between the wells is the frame.
Nothing here adds a decoration to a surface.

## Why subtraction

The obvious expansion is to let a look carry several decorations instead of one, so a gold tube
frame and a field of stones can sit on the same letter. That does not work, for the reason a
jeweller would give: a stone laid on metal reads as glued to it. What makes it read as set is the
**seat** — a recess whose walls come up around the girdle — and nothing additive produces one.

Subtraction gives two things at once that the additive model has to invent separately. The **seat**
is the well. The **frame** is whatever was not cut away, so it needs no spec of its own and cannot
drift out of register with the field it surrounds. The current `bedding` machinery has to *filter*
scattered samples down to something that looks regular, and `decoration.ts:38` records the failure
mode — small jitter rejects most of what sampling draws and degrades back to free placement. Cutting
generates sites instead, so regularity is the default rather than something sampling is nagged into.

## Cutting, without CSG

`ExtrudeGeometry` cannot make a blind recess. It can make a **hole**, which is how the counter in a
`B` already works — and **a hole in a plate stacked on a slab is a well**:

- extrude the glyph to the full depth: the **slab**
- extrude it again to a lesser depth, with the well outlines as `holes`: the **plate**

The well's floor is the slab's own front face, its walls are the plate's inner faces, and the plate's
bevel runs around each well for free. This is `THREE.Shape` and `ExtrudeGeometry`, both already in
use, and no new dependency.

What it cannot do, and neither can a real setting: **undercuts**, and **more than one floor depth per
plate** — stepped floors come from stacking plates. What it must refuse: wells closer to each other,
or to the glyph's contour, than the minimum wall. Two wells that touch leave a zero-width strip of
plate, which is not a thin frame but degenerate geometry.

**A cutter is registered, not hard-coded.** It takes the glyph's shapes and a region, and answers
with well outlines and a floor depth; the builder assembles slab and plates from that. `plate` is
the one implementation this version ships. The interface is what lets a CSG cutter — tapered seats,
stepped floors, wells that run over the bevel — register beside it later without any look, fill or
format changing.

Do not add the CSG dependency until a look needs one of those three things. It is the simpler idea
and the worse trade here: the robust library is WASM and the pure-JS one drags in a BVH, against a
package that ships three runtime dependencies; booleans fail *silently* on coincident faces and
near-degenerate triangles, which is what a bevel produces along every contour and what a bad font
outline hands us anyway; and the result needs its normals rebuilt, which is where the bevel
highlight every look depends on would quietly go.

## Regions

A cutter cuts inside a **region**: the glyph inset by a margin, and optionally one surface. The
margin is the bezel, and it is the only reason the outermost stones do not break the letter's edge.
Inset is new work — nothing in the tree offsets a contour today, and `surfacesOf` only separates
front, back and wall.

## Filling

A **fill** receives a well — its outline, floor and normal — and answers with geometry or instances
and a material. It is registered the way a cutter is, which is what finally removes the
`decoration.kind` switch: `word.ts` currently branches on `'tube'` and `'chunks'` in about a dozen
places and keeps a cache per kind, so every new decoration has cost the same surgery.

Four fills carry the looks worth building: `stone` (a cut gem seated at the girdle), `tube` (what
`tubing` draws), `scatter` (what `sequin` draws), and `flat` (a floor material — enamel, paint,
a dark void).

**A fill is named, and effects target the name.** Today an effect targets a `PartKind` — `body`,
`run`, `chunk` — which works only because a look has at most one decoration. With several fills on
one letter, `{ kind: 'run' }` stops identifying anything, so a target becomes `{ fill: 'stones' }`
and the part kind goes back to meaning what shape of thing it is.

## Diamond encrustation, worked

The feature this was drawn up around:

- **plate** in a gold `MaterialSpec`, over a slab of the same metal
- a **lattice cutter** placing diamond-shaped well outlines at a pitch, alternate rows staggered,
  clipped to a region inset far enough to leave a bezel, rejecting any well that would leave less
  than the minimum wall
- a **`stone` fill**: a brilliant cut — table, crown, pavilion — seated with its girdle above the
  floor, taking `gem`'s `tintSpecular` so the specular lobe carries the stone's own colour rather
  than laying white across it

The gold frame is not in that list because it is not a thing that gets built. It is the plate.

## What ships stays where it is

`tubing`, `piping` and `sequin` are all expressible as fills — a channel letter *is* a tube fill in
a channel well, which is what the tube decoration has been approximating from outside, and why a run
part had to have the tube radius added to its ink. **Re-expressing them is a separate change from
building the pipeline**, and it moves visual baselines. The pipeline lands with every shipped look
on its current path and every baseline unmoved; migrating them is its own slice, judged on its own
renders.

## What this is not

Not a modelling format: a fill answers with geometry it generates, never with an imported mesh. Not
per-word: wells are cut per glyph and cached beside glyph geometry, because a letter's wells cannot
depend on its neighbours. And not shader-faked — a parallax dent cannot seat a stone and comes apart
at the silhouette, which is exactly where a bevelled well reads.

## Measure before committing

Every well adds its outline to the plate's triangulation. A forty-stone letter across seven letters
is a different vertex count from anything the extruder builds today, and the default stone pitch
should be chosen against that measurement rather than against a still of one letter.

## Order

The `word.ts` teardown is the largest piece and buys nothing visible on its own, so it goes first
and alone, with every baseline unmoved as its acceptance. Then the plate cutter and regions; then
`stone` and the lattice; then, separately and last, the migration of the three shipped looks.
