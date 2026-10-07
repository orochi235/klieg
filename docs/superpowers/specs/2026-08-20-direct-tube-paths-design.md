# Direct tube paths

**For:** whoever implements this next. Assumes the tube pipeline in
`packages/core/src/render/tube/` and the vocabulary of
[the tube geometry design](2026-08-19-tube-geometry-design.md).

**Status, 2026-10-07: shipped as the default, two goals unmet.** `refineExact` is still in `field.ts` for the `'exact'` source, and "0 runs under ρmin" is not met: `piping`'s `B` fails ([tangential junctions](2026-08-22-tangential-junctions-design.md)).

**Answers:** where a tube's path should come from, and what has to be fixed before it can change.

## The decision

A front or back path is traced from the glyph's own contour. `level` — the isocontour level a look
insets or stands off by — becomes a normal offset on that contour, and overlapping contours, which
the grid resolved for free, are resolved by a vendored polygon clipper.

**`pathSource` is public API**, not a migration flag. `direct` is the traced path and `field` is the
256² grid that rasterises the outline and re-extracts an isocontour from it. Both stay supported and
both are exported from the package root; `tubing` and `piping` move to `direct`.

That is a visible change to two published looks, and for a reason that is not the one it looks like
— see below.

## Why

The grid displaces the path a **mean of 4–7% of the tube radius, and up to 15%**, measured against a
densely sampled bezier. The error is pervasive rather than concentrated at corners: a nonzero mean
means straight stems are not straight. It is a quarter to a half of one grid cell, which is what
binary-mask quantisation produces.

Nothing upstream of the grid contributes. `getPoints(24)` followed by `resample` at 0.01 measures
**0.00000 em** against the same reference, so the flattening the field is built on is lossless and
the grid is the whole of the loss. `spikes/path-fidelity-budget.mjs` is that measurement.

The direct trace runs the alphabet in **14 ms against the grid's 1750 ms**. That is not incidental:
the lab's known 1.45 s rebuild is about 90 ms per cell, and the grid is essentially all of it.

Two alternatives were measured and rejected. Raising the resolution cuts the error linearly for
16× the cost. Correcting the grid's magnitude exactly within a band of `level` — `refineExact` in
`field.ts`, kept for now as the instrument below — reaches the same accuracy as the direct trace at
1.0× today's cost, but leaves the 90 ms per cell in place.

## What the grid was hiding

**Every run that bends tighter than ρmin, under every path source, fails at a fillet↔path junction**
— never inside the arc, and twice on plain path. The fillet stage samples its arc at half `spacing`
and the legs at `spacing`, and nothing reconciles the segment between them: the leftover junction
segment carries the whole residual turn at one vertex.

| | entry step (nominal 0.0200) | turn | ρ (ρmin = 2r) |
|---|---|---|---|
| tubing `J`, grid | 0.02311 | 22.3° | 1.91r |
| piping `S`, grid | 0.02449 | 23.1° | 1.39r |
| tubing `A`, exact | 0.01621 | **173.9°** | 1.51r |

Under the grid the residual stayed small. Under an accurate path the leg's last point can land
inside the setback, and the path runs forward to it and reverses — the 179° above, and a bend of
0.32r where the grid showed 1.91r. `spikes/join-geometry.mjs` prints this per vertex.

So the grid was a low-pass filter that nobody counted as one, and **the five runs the handoff
lists as an open defect are this same junction**. Fixing the junction is a prerequisite for
changing the path source, not a follow-up to it.

Separately, an arc built at exactly ρmin reads as *at* ρmin and still fails a strict "not below"
test, because `tightestBend` smooths before measuring. That is the handoff's "three fillet arcs
measuring 2% under", and it is a tolerance question, not geometry.

## Why a published look changes

Not because the path moves. The two sources agree to about 0.001 em.

**The grid's wobble manufactures corners, and every corner is a candidate break.** Strip it and the
corner count roughly halves — 12 to 6 on piping's `S`. The cut then lands somewhere else, and
`assign` paints a different lit/dark pattern from the identical seed:

```
tubing S, seed 0
  field    6 runs  lit OxO.xO   lengths 0.15 0.13 1.27 0.17 0.14 1.35
  direct   6 runs  lit OO.OOx   lengths 0.18 0.92 0.90 0.66 0.62 0.13
```

On `M` the grid yields 15 runs where the trace yields 12, splitting one 1.28-long run into four.
`spikes/run-decomposition.mjs` prints this.

So the compatibility statement is stronger than "baselines move": **a look reads differently under a
different source even though its path is the same shape.** Anyone tuning a look against one source
is tuning the decomposition too, and cannot carry those numbers to the other.

## The work

**1. Junction reconciliation** (`bend.ts`, `runs.ts`). After an arc is spliced between two trimmed
legs, re-establish sampling across both junctions. A leg point that falls inside the setback is
dropped rather than assumed away by the trim.

*Acceptance:* no junction segment longer than `spacing`; no vertex turn greater than the arc's own
per-step turn; 0 runs under ρmin on both looks, under both path sources, wander on and off.

**2. Contour union** (`union.ts`). Vendor `polygon-clipping` (MIT, 0.15.7, two transitive
dependencies) and union the glyph's contours before offsetting, resolving overlaps by non-zero
winding. This takes `klieg` from one runtime dependency to four.

This is a behaviour change and not a port. The grid rasterises **even-odd**, so where two contours
overlap it punches the overlap out as a hole; the union fills it, which is what a font means.
`spikes/contour-overlap.mjs` shows both. No letter of the test font overlaps, but the package takes
whatever font a caller supplies.

**3. Offset hardening** (`offset.ts`). `offsetRing` exists and is correct. It needs the tests that
would have caught how it first shipped: a counter, a thin feature the offset collapses, and a fold
where the offset exceeds local curvature.

The trap it hit is worth stating, because the shape of the code invites it again. The vertex normal
is the tangent turned a quarter, which already points into the solid for both an outer contour and
a counter. Deriving a direction from winding *on top of that* cancels the distinction and insets
every counter backwards by a full `level` — on 7 of 26 letters, with identical contour counts and
no error. It is only visible by measuring a counter's area against the grid's.

**4. Publish the flag and move the looks.** Export `PathSource` from the package root, document
`TubeSpec.pathSource`, set `tubing` and `piping` to `direct`, and re-record the visual baselines.

`field.ts` stays — `field` is a supported source, not a legacy path. `refineExact` does not: it is a
diagnostic, and it goes once step 1 lands and the ordering argument below is spent.

## Ordering

`pathSource` is already in `TubeSpec`, defaulting to `field`, so nothing published has moved.

The junction fix must land before the default flips, but it is only clearly visible under an
accurate path. So fix the junction while measuring under `direct`, with `field` as the regression
guard, and flip the default last. `refineExact` stays until step 1 lands: it isolates whether a failure comes from the path's accuracy
or from the trace, which the direct source alone cannot. That distinction is not academic — it is
what separated the junction defect from a fidelity problem, and what showed the halved corner count
to be a decomposition change rather than noise.

## Out of scope

**Retiring the sweep's three-tap smoother gets its own spec**, and should be written as soon as this
lands. The smoother exists only for the grid's staircase noise, and with no grid there is no
staircase — retiring it also retires `markAuthored`/`isAuthored` and the arc's half-spacing
sampling, which exist only to protect analytic geometry from it. It is deliberately not bundled
here: this spec's defects are diagnosed, and that one is open-ended by its own evidence. Holding a
fillet's points out of the smoothing previously made joins fail that had looked fine, so expect
removing it to expose further raw kinks rather than to close work.

## Acceptance

- 0 runs under ρmin on `tubing` and `piping`, all 26 letters, both path sources, wander on and off
  (`spikes/source-shootout.mjs`). Today: 2/237 and 3/47.
- Contour parity 26/26 against the grid at `level: 0` and `level: -0.015`
  (`spikes/contour-parity.mjs`). Already true.
- Path error against a densely sampled bezier at or below the direct trace's current worst mean of
  0.00005 em (`spikes/path-fidelity-budget.mjs`). Today's grid: 0.00087–0.00162.
- A lab spec change well under today's 1.45 s on `direct`.
- Both sources build every letter of both looks; `field` keeps its current output exactly, so the
  move is a look's choice of source and never a silent change under one.
- `npm run check` and `npx playwright test` green, baselines re-recorded.

## Traps

**A visual baseline's per-pixel `threshold` decides whether it can see this at all**, and a
pixel-count ratio cannot substitute. `--update-snapshots=all` rewrites every baseline, so grep to
the ones that should move.

**The visual suite cannot see `piping`'s cord** — it traces inset, so the cord sits inside the
letter body in both framings. Judge piping by `spikes/source-shootout.mjs` or a lab capture.

**Verify by mutation.** Both findings here were reached by a wrong turn first: the junction defect
read as a fidelity problem, and the offset's first fix broke the outer contour instead of the
counter. A number that agrees with the hypothesis is not evidence until the code under it has been
deleted and the number moved.
