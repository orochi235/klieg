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

## Inflating the solid

This model says what to carve out of a solid and never says what shape the solid is, and today the
answer is always the same one: a linear push along z with a bevel at each end. The other half is a
**profile over the distance field** — how deep inside the outline a point sits decides how far it
stands proud. Today's flat cap is the profile `z = 0`.

The field already ships. `signedDistanceField` is the tube pipeline's own, and an inflation is a
function of it, so this needs no new geometry machinery. `node spikes/inflate.mjs` builds four
profiles on a real glyph and renders them: `flat`, `pillow` (a circular arc), `dome` (a sine) and
`ridge` (linear, which creases each stroke down its spine and reads as folded channel rather than
as a cushion).

**It is affordable.** The prototype meshes the crown as a heightfield over the field's grid, and the
grid is the entire cost: 9,143 vertices a letter at 128 cells against 83,948 at 384, with nothing to
tell between 128 and 256 at sign size. Today's extruder spends about 6,700 a letter, so an inflated
letter is one extra letter's worth of geometry rather than an order of magnitude — unlike a well,
where the bevel costs six times the hole.

**The mesher is the open question, not the profile.** The heightfield drops any cell the outline
crosses, so the crown stops one cell short of the silhouette and the bevel underneath shows through
the rim; invisible at 128, and still the wrong construction to ship. The two candidates are
subdividing the extruder's own cap and displacing it, and stacking isocontours at successive insets
— the same profile read as rings, which also survives a stroke pinching into two.

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

**A region is a predicate, not a polygon, and it needs no new machinery.** `signedDistanceField` is
the tube pipeline's own and counts inside as negative, so "at least `bezel` in from every contour"
is one sample — counters included, because the field already treats them as boundary. Nothing
offsets a contour. See [the plate cutter](2026-09-03-plate-cutter-design.md).

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

## Measured: the seat costs six times the hole

`node spikes/well-cost.mjs` cuts wells into real glyphs and reads the cost off today's extruder,
which is all a hole in a plate needs. **A well costs 1,716 vertices bevelled and 276 unbevelled** —
so the bevel, which is the part that seats the stone, is 84% of the price.

Against a 46,968-vertex baseline for `JACKPOT`, forty stones a letter is 251,160 and eighty is
457,170: **five to ten times the whole word's geometry today**.

**Built, that turned out to be 4.5×, and the seat stays on the plate.** A bezel-legal lattice never
reaches forty wells on a stem, so the count the estimate above assumed is unreachable: an `R` at the
shipped bezel seats 61 and costs 7,272 vertices to 32,844. The plate's own bevel is also what makes
an *empty* well read as a setting, so the question this section used to leave open — whether the
seat is geometry the stone brings instead — is settled for the plate cutter. A stone carrying its
own collar remains the answer for a CSG cutter, which has no bevel to inherit.
[The plate cutter](2026-09-03-plate-cutter-design.md) has the measurements.

## Order

**The `word.ts` teardown is built.** A decoration kind registers a `DecorationBuilder` in
`render/decorations/registry.ts`, which owns its per-letter geometry and materials, the parts it
contributes to effect targeting, its per-frame and per-part writes, and its disposal. `tube.ts` and
`chunks.ts` are the two implementations, and `word.ts` has no `decoration.kind` branch left — bar
one tube-specific debug hook a new kind will want to widen. Next is the plate cutter and regions;
then `stone` and the lattice; then, separately and last, the migration of the three shipped looks.

**A builder adds geometry to a letter's group — it cannot replace the body.** `Word` builds the body
mesh itself and hands the builder a group to add to. The plate cutter replaces the slab rather than
adding to it, so it needs a member the interface does not have yet (an optional
`bodyGeometry(char, depth)`). Purely additive; the cost of not knowing is discovering it with a
plate half-built.

**`WordBuildContext.glyph()` answers extruded geometry, and a cutter wants contours.** A cached
`shapes(char)` beside it would pay three times: `tube.ts` computes `glyphToShapes` per missed
letter, the debug path recomputes it, and `buildGlyphGeometry` throws one away.

Both are designed in [the plate cutter](2026-09-03-plate-cutter-design.md), with the disposal
contract `bodyGeometry` needs — it is the reverse of `glyph()`'s, which is the trap.
