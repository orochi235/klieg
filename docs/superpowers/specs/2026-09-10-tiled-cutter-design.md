# `tile`: a gem field clipped to the outline

**For:** whoever works on the well cutters next. **Answers:** what the third cutter does, what a
letter cut with it costs, and which of its rules exist because the obvious version broke.

**Status: built.** `tile` is registered beside `lattice` and `pave` in
`packages/core/src/render/wells/tile.ts`, and the `ice` look uses it. `spikes/gem-tiling.mjs` draws
its pockets top down; `spikes/well-cost.mjs` measures a whole letter.

`tile` gets pavé's picture — stones tessellated to a sliver of metal, cut cleanly where the letter
ends — by laying a regular hexagon field over the letter and cutting it back, instead of deriving a
field from the letter's own geometry.

## What a letter costs

For "FUCK YOU TRAVIS", 12 distinct letters, every stage a letter pays before its first frame
(`node spikes/well-cost.mjs`, measured at a load average of about 10):

```
            region      cut     shell     fill      total
tile           0.1    171.9    2094.6     35.9     2302.4ms
lattice     2186.7      2.2    1580.0      3.0     3771.9ms
pave        1982.9   4698.8    4801.0     36.2    11519.0ms
```

`lattice` and `pave` both read a proportional `Region`, a distance field over the glyph; `tile`
never builds one. The bead rings are cut inside the shell stage, which is why `pave`'s shell is
larger than the others'.

**Most of what `tile` costs now is the shell, and none of that is the wells.** Profiled, half the
pipeline is the shell rasterizing and marching its own 512² distance field of the letter's skin —
the same work for any carved letter. The next saving is there, not in the cutter.

## The method

A flat-top hexagon lattice, centered on the glyph's box. `pitch` is the distance between
neighboring centers, as it is for `pave`, so a whole cell is `pitch` across its flats. The cell's
pocket is the hexagon with `wall / 2` taken off every edge, intersected with the glyph taken in by
`bezel`.

The glyph's outline is sampled the way the shell's front face is — corners cut, curves at the
glyph's own segment count — and bucketed on a grid at `pitch`. Each cell asks its buckets for the
outline segments within its circumradius plus `bezel`:

- **None, center inside** — the pocket is the plain hexagon. Most cells land here.
- **None, center outside** — dropped.
- **Some** — the cell is worked on a small distance field of its own, about 30 × 30, built only from
  the segments its buckets returned. The value at a point is the larger of its distance outside the
  cell's hexagon less half the wall, and its distance outside the glyph less the bezel; the pocket
  is that field's zero level, marched.

The rim bead needs the pocket grown by `g` at each of its steps, and that is the same field read at
level `g` — so every bead ring nests inside the next by construction, with nothing offset.

## Rules that exist because the obvious version broke

**The bezel is not optional.** A pocket that reaches the outline pushes its rim bead across the
letter's face. Nothing in the tree offsets a contour, and a uniform `Region` costs 914ms for the
word above, which is why the cell builds a local field instead.

**Offset the edges, don't scale toward the center.** Scaling a hexagon's circumradius down by half
the wall leaves neighbors 0.87 of a wall apart. And the hexagon's orientation has to match the
lattice step: pointy-top cells on flat-top spacing leave a triangle between every three.

**A rim bead can take at most 0.8 of half the wall.** A wider one, which the shared default
`rimBevel` is, would meet the neighboring pocket's rim on the face; the growth is capped there.
`ice` sets `rimBevel` and `rimDrop` to 0.003.

**One pocket per rim.** A cell cut in two by a neck narrower than two bezels has two pieces that the
widest bead joins again, and two pockets sharing a rim is a band no stitch closes. The larger piece
is kept.

**A piece with a hole is dropped**, since a pocket is one ring. So is a piece with no point the
whole of it can be seen from: the stone fill shrinks the pocket's outline toward the seat's point
to make the table and culet, and shrunk toward any other point a bent pocket throws the table
outside it — measured at 0.0085em on an `R` before this rule. The seat sits at the center of that
region, and the `stone` fill now shrinks toward the seat's own point when it lies in the pocket.

**Every pocket is nudged toward its seat by a few billionths**, as `pave.ts` does: whole rows of
pockets share a line, and three points from two rings on one line is an ear the face's
triangulation cannot walk back.

## How it fits

`tile` is a `Cutter` like the others and ignores the `Region` it is handed. `WellBuilder` now hands
every cutter a region built on first read (`lazyRegion`), so the cutter that never reads it never
pays for it, and the `Cutter` signature is unchanged. `insets` has no effect on `tile`: a
proportional bezel is measured on the region's field.

`minArea` defaults to 0.1 for `tile`, chosen by eye; smaller pieces at the edge are dropped rather
than set with a speck of a stone.

## What is not settled

**Hexagons are not diamonds.** The footprint is a separate choice from the method, which only needs
a convex cell that tiles and a distance to its outline.
