# `tile`: a gem field clipped to the outline

**For:** whoever implements this next. **Answers:** what the third cutter does, why it is an order
of magnitude cheaper than `pave`, and what the spike did not settle.

**Status: unbuilt.** `spikes/gem-tiling.mjs` proves the method and the cost; no cutter is
registered and no look points at one.

A well-cut letter today costs seconds, and almost none of it is the stones. `tile` gets the same
picture — stones tessellated to a sliver, cut cleanly where the letter ends — by laying a regular
field over the letter and clipping it, instead of deriving a field from the letter's own geometry.

## What it costs now, and why

For "FUCK YOU TRAVIS", 13 letters, 12 distinct:

```
                       region      cut     fill     total
pave, proportional     1966.0   3697.6     27.4   5691.0ms
tile                        —    537.0     27.4    564.4ms
```

The stones are 27.4ms of either. What `pave` pays for is deciding where metal may be removed: it
rasterizes a signed distance field over the glyph, marches iso-contours at every inset level, and
derives a tessellation from them. Profiling puts 29% in `strokeWidths`, 12% in `rasterize` and
about 20% in the clipping library.

`tile` needs none of that, so it needs no `Region` at all — which is where the 1,966ms goes.

## The method

Tile the glyph's bounding box with flat-top hexagons at `pitch`, shrunk toward their own centers by
`wall / 2`. That shrink is the sliver of metal between two stones, and hexagons are chosen because
they tile with no gap for it to compete with.

Classify each cell by how many of its six corners lie inside the glyph:

- **Six** — keep it whole. It never reaches the clipper. Most cells land here.
- **None** — drop it on the point test alone.
- **Some** — clip the cell against the glyph outline and keep what is left, sharp edges and all.

A point is inside the glyph when it is inside an outer contour and outside every hole of that same
contour. Reject against each contour's bounding box first; most points a box tiling produces are
outside every contour, and the box test is what makes them cheap.

**The orientation of the hexagon has to match the lattice step.** Pointy-top cells on flat-top
spacing leave a triangle between every three cells — a hole, not a sliver, and it looks like a
different design rather than like a bug.

**Nudge a straddler toward its own center by a millionth before clipping it.** A tiling puts whole
rows of cells on one line, and polygon-clipping refuses to close a ring built from coincident
edges. `pave.ts` already does this for the same reason. The spike drops a cell the clipper cannot
close rather than guessing at it, and counts the drops; at the measured settings there were none
across 2,150 cells.

## Bucket the outline

Cost tracks outline complexity almost exactly, because every straddling cell is currently clipped
against the whole glyph:

```
char   outline pts     ms
 I               5    1.0
 T               9    2.3
 R             445   60.1
 S            1253  179.5
```

`S` is not harder than `I` in cells — 212 against 90. It is harder because each of its 98
straddlers is intersected against 1,253 points of outline.

So: bucket the outline segments into a uniform grid at `pitch`, and clip each straddler against
only the segments in its own bucket and the ring of buckets around it. This is the one optimization
the implementation should carry from the start rather than leave for later — it addresses the term
that dominates every measurement above. **It is an expectation, not a measurement:** the spike does
not implement it, and the claim that the word lands under 100ms is unproven until it does.

## How it fits

A third `Cutter`, registered beside `lattice` and `pave`, returning the same `Cut` — wells, seats,
floor. `WellSpec` gains nothing it does not already have: `pitch`, `wall` and `bezel` all mean here
what they mean for `pave`.

It is the one cutter that needs no `Region`, and `Cutter` takes one. Pass it and ignore it rather
than widening the signature for a single caller; the shipped shape of that argument is not worth
changing for this.

`ice` moves from `lattice` to `tile` once this lands. That is a look change with a visual baseline,
so it does not ride along silently.

## What the spike did not settle

**Footprints, not meshes.** The spike produces 2D rings. Seating a brilliant in each is what the
`stone` fill already does, and it costs 27ms a word — but nothing has yet run the two together, so
"the fill just works on these" is untested. A clipped cell is not convex and not a hexagon; the
fill has only ever been handed a `Seat`, which carries a center and a half-width. Either the seats
a clipped cell produces are honest about its real extent, or stones will overhang the metal at
every edge of every letter.

**Hexagons are not diamonds.** The footprint shape is a separate choice from the method, and the
method does not depend on it. Any shape that tiles will do.

## Testing

The classification is pure and tests without geometry: a cell wholly inside is kept and never
clipped, a cell wholly outside is dropped, a straddler is clipped to something smaller than itself.
Hexagon orientation matches the lattice step — assert that two neighbors' shrunk rings are `wall`
apart, which is the property the gap bug broke. A cell the clipper refuses is dropped and counted,
never emitted half-formed. And the bucketed outline returns what the whole outline returns, which
is what keeps the optimization honest.
