# Pavé: the stitched shell, and the cutter that fills it

**For:** whoever works on `render/wells/` next. **Answers:** why the plate extruder is gone, what
replaced it, and what a cutter now has to hand over.

Pavé is a field of stones set so close that the metal is only what is left between them. The shipped
`lattice` cutter cannot make one: it places a diamond only where a whole one fits, which reads as
polka dots. This lands the field, and the body builder it needs.

## Why `ExtrudeGeometry` had to go

`buildPlate` extruded the plate with one `bevelSize` for the outer contour and every well hole at
once, hardcoded to the glyph's own 0.038 em. A pavé wall is 0.009 em and its bead is 0.003. Two
neighbouring cells would each ramp 0.038 em into a 0.009 em wall — the bevel is four times the whole
wall, so the wall does not survive being bevelled.

There is no setting that fixes this. `ExtrudeGeometry` bevels every contour it is handed at one
size, and a letter's chamfer and a pocket's bead are different sizes by an order of magnitude.
Stacking two separately-bevelled extrusions instead puts a doubled band down the letter's side.

So the body is stitched by hand.

## The shell

`shell.ts` replaces `buildPlate` behind the same signature, so `WellBuilder` and `GlyphCache` do not
move. `platePlanes` becomes `shellPlanes` and keeps the front face and the floor exactly where they
were, so a fill written against the old planes still lands.

A letter is a stack of levels. Every ring in it is an iso-contour of the letter's own signed
distance field at the level that ring sits at — `signedDistanceField` and `isoContours` from
`render/tube/field.ts`, which the tube pipeline already ships. Nothing is offset, so nothing can
fold: a miter off a marching-squares outline folds at almost every vertex, and a corner rounded to
radius `r` cannot then be inset by more than `r` at all.

Bands between rings are stitched by arc length, so two rings need not have the same point count.
`pair` decides which ring of one level answers which of the next, by centroid distance plus size
difference plus a large penalty for opposite winding, cheapest pair first.

Caps are `THREE.ShapeUtils.triangulateShape` with holes, and each triangle's facing is asserted
rather than inherited from ring order.

### What a cutter hands over

`Cut` grows one optional member:

```ts
export interface Cut {
  wells: THREE.Path[];
  /**
   * Every well re-derived at each of the growths its rim bead asks for — one entry per well, and
   * inside it one ring per growth. A cutter whose pockets are convex leaves this out and the shell
   * shrinks them instead.
   */
  bead?: (growths: readonly number[]) => THREE.Path[][];
  seats: Seat[];
  floor: number;
}
```

A function rather than fixed rings, because the shell owns the bead profile: how many steps and how
wide is `rimBevel` and `segments`, which the cutter has no business duplicating.

`lattice` omits `bead`: a diamond is convex, so pushing every edge in by the bead width is exact.
`pave` supplies it, because a clipped cell is not convex and there is nothing to walk a miter along.

### The check

A hand-built shell is closed or it is not, and no render distinguishes a missing cap from a dark
one. `openEdges` counts every directed edge and reports the ones walked only one way, and every
shell test asserts zero.

It quantises to a micro-em rather than printing coordinates. `1 - Math.cos(PI / 2)` is not 1, so the
plane where the back chamfer meets the wall arrives as -1e-18 from one side and 0 from the other —
and `toFixed` keeps that sign, so every edge across the plane hashes two ways and 144 of them read
as open on a letter that is closed.

Read a cap by the **area** it covers, never its triangle count: earcut bridges each hole with a pair
of duplicated vertices, so `n + 2h - 2` is not the count and reading it as one calls a correct cap
broken.

### New spec knobs

All default to what ships today, so no existing spec changes what it renders:

- `rimBevel` — the bead around a well's rim, separate from the letter's chamfer. The point of the
  whole exercise.
- `rimDrop` — how far that bead falls. Square by default, which is a 45 degree bead.
- `round` / `roundOuter` — a radius rolled along the outline. Growing the metal and shrinking it
  back fills every reflex corner to the radius; the other order rounds the convex ones. Each half
  rebuilds the field, which is what makes the radius real.

**`--insets proportional` is not here.** Scaling every inset by the local stroke width needs the
width field and the stroke-width snapping that `spikes/hollow.mjs` carries, and it is a separate
change on top of this one.

## The `pave` cutter

Voronoi seeds on a staggered lattice, jittered, relaxed by Lloyd passes, then clipped to the letter
inset by the bezel.

**Cull the seed, never the cell.** Every point belongs to its nearest seed, so there is no dead
space to fill — leftover only exists if a cell is deleted. Drop the seed and its neighbours grow
into exactly the space it held.

**Clip against the region as one multipolygon**, not one polygon at a time: asking for the part of a
cell inside each polygon separately gives nothing at all for any letter whose bezel leaves two
pieces, such as `i` or `j`.

**A cell is bisected against every seed whose own box could reach it.** The cell starts a
`2.2 * pitch` box across, so a cutoff shorter than twice its diagonal leaves two cells overlapping
wherever the lattice has a gap — and culling seeds is what makes the gaps.

**One ring per seed per bead step, and the seed is dropped outright if any step has nothing for it.**
A band is stitched between rings `pair` matched by count first, so a cell that arrives at one step
and not the next is a band that cannot be stitched at all.

**Nudge each cell in by its own millionth.** A lattice puts whole rows of cells on one line, and
three points from two rings on one line is a zero-area ear whose edge nothing walks back.

`edge: 'absorb' | 'grade'` — `absorb` lets the outline cut the interior cells; `grade` pins a row
along the region's boundary and relaxes the interior behind it, so the stones grade smaller toward
the edge. A region only a stroke wide has no room for the lattice behind that row, and the pinned
row is then the whole field.

## The stone fill

`Seat` grows an optional `outline`. When a seat carries one, the cell is the girdle: each stone is
its own geometry and they are merged into one buffer with `mergeNonIndexed`, so a letter still costs
one draw. `Filled.placed` says so, and `WellBuilder` then draws a plain `Mesh`. `lattice` leaves `outline` unset and keeps its
`InstancedMesh` path unchanged.

Three rules the stone geometry keeps, each a visible defect first:

- **Tables are coplanar.** Deriving crown height from a cell's own width while the girdle sits at a
  fixed depth sinks the narrow cells below the metal — worst at the edges, which is where the narrow
  cells are.
- **A pavilion with no room shallows rather than flattens.** A pavilion is about 0.38 of the girdle's
  width; too thin a plate and the culet bottoms out, which reads as a tile in a hole.
- **A clipped cell is not convex.** Fanning a cap from the centroid or coning a pavilion to one apex
  throws triangles outside the cell. Use a sampled interior point, triangulate both caps, and close
  the pavilion on a small ring.

## What the shipped wells looked like, which is worth not re-deriving

The lattice's bevel already folded through every pocket. Extruding a 0.048 em diamond hole with the
letter's 0.038 em chamfer, the hole runs 0.024 wide at the cap, inverts to 0.0074, and opens back to
0.0297 in the straight section — the offset overshoots and the miter turns inside out. That fold is
what the field read as a dimple, and it is why `stone.ts` needed `sink`: `girdleR = half +
bevel * (1 - sink)` models a taper the geometry never had.

So there was no correct well silhouette to preserve, and the shell changes every well render.

## One thing that will change

The outer silhouette shifts slightly: a field-derived contour rounds a sharp tip where three's
miter cuts it back. Nothing currently catches this — every one of the 22 snapshots in
`apps/lab/test/looks.spec.ts-snapshots` is an uncut letter.

`spikes/pave-render.test.ts` rasterises the shipped cutter and shell without a browser (`npx vitest
run --config spikes/vitest.render.config.ts`, `PAVE_CUTTER=lattice` and `PAVE_LETTER` to steer it).
On an R at pitch 0.055: pavé cuts 126 pockets against the lattice's 68, and both shells close.

`pair` refuses rather than guesses when two levels disagree on ring count — a stroke closing up or
splitting between them. It throws, naming the level and the two counts. A guessed pairing would be a
silent hole.
