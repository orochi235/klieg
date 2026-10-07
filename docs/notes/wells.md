# Wells, fills and pavé

**For:** whoever works on the carved-letter pipeline — `render/wells/`, `render/decorations/`, the
cutters, fills, shells and `inflate`. **Answers:** what was decided, what was ruled out, and the
traps that each cost a cycle. The design is
[wells and fills](../superpowers/specs/2026-09-01-wells-and-fills-design.md).

Shipped looks that use this line: `ice` (the `tile` cutter), `pave` (a `'sheet'`), and `tiara`,
`bezel` and `carved`, which carve wells. `render/looks.ts` is the live answer.

## Decided

- **Pavé is a sheet shown through the letter, not wells carved into it.** Both were watched
  spinning and the sheet chosen: the carved wells carry a lumpy rim around every counter and cells crowding
  where strokes meet. The sheet is the plain extruded glyph with its front cap opened on the GPU
  wherever one baked pavé sheet shows through, and a thin raised rim on the seam hides the stones the
  mask cuts. On "FUCK YOU / TRAVIS" carved wells build in 7.0s; the sheet 2.9s on a first fire and
  1.7ms after.
- **Ruled out — do not re-propose:**
  - *Painting pavé on in the fragment shader.* Competitive straight on; from 25° to 60° the face
    flattens into streaks, which is most of a spin.
  - *Contouring the distance field once and offsetting the other levels.* Fourteen contour passes
    at ~8ms is a 100ms ceiling, and polygon offsetting is the fragile thing the field's own contours
    exist to avoid.
  - *Shipping baked meshes of the carved wells.* Only the sheet needs baking.
  - *A miter offset of a glyph ring.* See "Rings", below.
- **The `pave` cutter on wells is on hold, not rejected.** It costs 3,725ms of cutting on top of
  1,966ms of region for a 13-letter word; `tile` is the attempt at cheap enough.
- **The stones must stay saturated.** A near-clear stone transmits the black behind it and reads
  as a hole, because klieg renders over an empty scene. `ice`'s blue cannot simply be lightened.
- **`sink` is what makes a `lattice` stone read as a stone.** At 0.25 the crown sits under the face
  and reads as dimples; 0.08 fixes it, and `pitch` must then clear the wider girdle. It does nothing
  for `tile` or `pave`, whose stones stand their tables proud regardless.
- **Targeting grew `{ fill: 'stones' }` rather than a `'stone'` `PartKind`.** A stone field reports
  `kind: 'chunk'`; a new kind would be a second way to say what `fill` says.
  [The stone fill design](../superpowers/specs/2026-09-04-stone-fill-design.md) has the reasoning.

## The sheet

One sheet per spec is cached on `WordCaches`, never smaller than ordinary text needs (`ORDINARY`),
so warm-up bakes the sheet nearly every word uses. Each glyph gets a half-float mask and a rim,
cached per (font, char), and slides to its own patch of the sheet. The back face is the same sheet
turned over, each copy clipped at the letter's middle. The sheet's metal and rim draw on the body's
material, which fades by dither (`alphaHash`) so the stones keep seeing gold behind them.

## Costs

- **Any figure for a well-cut letter must include `regionOf`**, which is the larger half. Two
  measurements here excluded it and were wrong. `spikes/well-cost.mjs` measures both.
- **`tile` costs about 5x less than `pave` per letter**, and most of what is left is the shell's own
  distance field of the letter's skin — that is the next saving, not the cutter.
- **Wall-clock timing moves more than the effects being measured** when other sessions run.
  `spikes/pave-word.mjs` reads CPU time; `prof-top.mjs` shares survive load.

## Rings

Every ring is an iso-contour of the letter's own field at the level it sits at; nothing is
extruded or offset. `spikes/hollow.mjs` is where levels live.

- **Do not reintroduce a miter offset.** A marching-squares outline carries the field's staircase,
  so its normals alternate and a miter folds at nearly every vertex; a vertex on a taper has no room
  (the R's leg is eaten whole by a 0.038 chamfer); and a corner rounded to radius r cannot be inset
  by more than r — the offset must invert, and three attempts at a clamp made it worse.
- **A pocket's rings are re-derived, never offset.** A bead step is the cell built with less wall,
  inside the region grown by the same amount. A clipped cell is not convex, but the convex thing it
  was clipped from is still there to rebuild from.
- **Every growth must answer with the same pockets in the same order.** `pair` matches by count
  first, so a cell arriving at one step and not the next cannot be stitched: one ring per seed per
  step, and a seed with nothing at any step is dropped.
- **Concentric rings defeat a centroid.** An O's outline and counter share a center, so the
  outline of one level was stitched to the counter of the next — a sheet of quads across every O, Q
  and 0 while the shell stayed closed. Size and winding are in the pairing cost now.
- **A band whose levels disagree on ring count is lidded, not refused** — a stroke closing up or
  splitting between levels, which seven of thirty-six lab glyphs did at the shipped chamfer.
  [The pavé design](../superpowers/specs/2026-09-05-pave-cutter-design.md) says which way a lid faces.
- **Rounding is morphology, not corner-finding.** `--round` fills reflex corners, `--roundOuter`
  rounds convex ones, and each rebuilds the field — which is what makes the radius real.
- **A uniform inset exaggerates a letter's contrast**: on this R the thick:thin ratio is 1.26 on the
  glyph and 1.47 on the top face. `--insets proportional` scales every inset by local stroke width,
  snapped to the two or three widths the letter really has (`spikes/stroke-widths.mjs`) — snapping
  first, or straight edges bow. It is not the default because it changes the letter's weight.
- **`--outer` is the letter's chamfer and `--bevel` the bead on every rim.** `ExtrudeGeometry`
  bevels every contour at one size, which put a ledge on every well's rim.

## Shells that will not close

**Check the shell is closed — every edge walked once each way.** Nothing in a render tells a
missing cap from a dark one.

- **`clipHalf` keeps what is behind the line**, so moving an edge along its outward normal grows
  the polygon. Every cell once overlapped its neighbors by the wall meant to separate them.
- **A collinear vertex belongs to the triangulator.** `triangulateShape` drops it before
  triangulating, so the cap skips it while the wall stitched off the same ring walks it. `dedupe`
  drops them at the source, which also takes the plain R from 15,858 triangles to 8,620.
- **A lattice puts whole rows of cells on one line**, making zero-area ears whose edges nothing
  walks back. Each cell is nudged in by its own millionth.
- **Read a cap by the area it covers, not the triangles it returns.** Earcut bridges each hole with
  duplicated vertices, so `n + 2h - 2` is not the count. `HOLLOW_EDGES=1` prints the uncovered
  fraction.
- **There is no density wall.** `spikes/hole-wall.mjs` cuts 320 holes into an R with the counter
  intact. Three earlier readings said otherwise: two from combined renders, one from a zero-area
  triangle that passes a point-in-triangle sign test for every point in the plane. Run the spike.
- **Render the body alone when checking whether a well was cut.** A stone stands proud whether or
  not anything was cut beneath it.
- **A matching vertex count is not identical geometry.** `spikes/pave-identity.mjs` hashes each
  pocket and rim ring.

## Cells and stones

- **Voronoi does the packing, not the edge.** Every point belongs to its nearest seed, so there is
  no dead space unless a cell is deleted: cull the seed, never the cell, and the neighbors grow into
  its space. With zero jitter the Voronoi of a staggered lattice is a honeycomb.
- **A cell is bisected against every seed whose box could reach it** — the cell starts `2.2 *
  PITCH` across, and culled seeds make the gaps a short cutoff would miss.
- **Clip a cell against the region as one multipolygon.** One polygon at a time asks for the part
  inside all of them, so an `i` or `j` produced no cells.
- **`--edge absorb` and `--edge grade` are both options.** Grade pins a row along the region's
  boundary; a region only a stroke wide has no room behind it, and then that row is the field.
- **Three stone rules, each a visible defect first:** tables are coplanar (deriving crown height
  from cell width sinks the narrow edge cells); the plate's depth is not free (a pavilion is ~0.38
  of the girdle, and a thin plate floors the culet flat); a clipped cell is not convex (use a
  sampled interior point, triangulate both caps, close the pavilion on a small ring).
- **A cut is a profile over the pocket** — rings scaled toward an interior point at fractions of
  crown height and pavilion depth — so it is stitched like every other ring pair.
- **One material per stone, not per pocket**, because transmission costs a render target each.
  Gems draw `DoubleSide`, or every dark gem renders as a hole.
- **Stones set in a `Word` body render dark.** `Word` makes every body material `transparent` so
  letters can fade, and three refracts opaque objects only. The carved-well looks have it; the
  sheet avoids it by dithering.
- **A look's `thickness` is in world units.** `gem` ships 1.4 em for a letter; a stone is a
  twentieth of that, so inheriting it renders pavé as black holes. `attenuationDistance` and
  `iridescenceThicknessRange` carry the same hazard.
- **Nothing models a socket.** The seat is emergent — a hole through the plate floored by the slab —
  so there is no contact test between a stone and its well.

## Cutters and builders

- **The bezel is the slab's bevel, derived rather than set.** The slab's front cap is every well's
  floor, and a sloped seat is inexpressible.
- **A cutter tests a well's four corners, not its center.** A stone hanging off the letter's edge is
  what a wrong test looks like.
- **`bodyGeometry` is builder-owned and `ctx.glyph()` is cache-owned.** Free the cache's and another
  word loses a geometry mid-draw.
- **A fill that registers itself vanishes from the standalone bundle.** The narrow `sideEffects`
  list tree-shakes a module imported only for registration, and every unit test still passes. Register
  from the module exporting the lookup, as `cutters.ts` does.
- **`collectParts()` walks "highest index written + 1", not the letter count**, which holds only
  because `skipLetter` runs for every inkless letter. A builder with several per-letter arrays must
  satisfy that in all of them; test slot alignment with one assertion per array.
- **`WordDebugHooks.tubeMaterial` reaches a builder as `ctx.debug`**; a new kind wanting to override
  its own material widens that interface.

## Inflation

**A profile needs a finite slope where it meets the cap.** `pillow`, standing straight up off the
seam, costs 117,895 vertices and still misses by 1.00% of its rise where `cushion` costs 7,130 for
0.79%. Judge profiles on the `chrome` shot; ring banding is invisible on anything rougher.
`node spikes/inflate.mjs --sweep` prices the candidates.
