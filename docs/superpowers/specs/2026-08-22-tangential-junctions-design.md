# Tangential junctions

**For:** whoever changes the corner stage next. **Answers:** why the last bend-minimum failure is not
a tuning problem, and what replaces the fit that causes it.

**Status, 2026-10-12: unbuilt, and a decision rather than a task.** `junctionRadius` and `biarcBlend` exist in `bend.ts` (the latter used only by the hairpin); neither fix is wired. Easing shallow corners in place (`ease.ts`) fixed `piping`'s `B`; `G` still fails.

A *junction* is where a corner's built arc splices back into the extracted path. A *fillet* is the
fixed-radius arc the corner stage builds there today.

## The defect

`piping` traces `G` with one run bending at 1.536r against a 2.00r floor. It is the only failure in a
shipped configuration; the others the census reports are `piping`
under `exact` and `field`, which are lab-only path sources, and `tubing`'s `R` at 1.996r is wander,
not geometry.

`G` has failed since `52f3b9d` (2026-09-01), which breaks a corner whose fillet would cost a whole
leg. On `G` that breaks the 59° corner up front. Before, its fillet survived long enough for the
pass that settles leg room to break the 41° corner beside it, and then broke itself a pass later;
the settle pass never restores a corner it broke. Now the 41° corner keeps its fillet, with a
setback of 0.134 em against about 0.066 for its neighbors, and its junction is the 1.536r run. The
defect is the same one; that commit only stopped hiding it.

On `B`, before it was eased, the path arrived at the arc **49 degrees off tangent**. Nothing measures that. `resumeAt` accepts a
junction on the circumradius of the triple spanning it, and circumradius through a long chord is
`chord / (2 sin turn)` — so stepping the leg back lengthens the chord and raises the number while
leaving the mismatch exactly where it was. The function's own docstring states this as its strategy.

Two measurements pin it. Filling the junction chord with plain interpolation, which changes no
direction anywhere, drops the run from 2.00r to **0.93r**: the chord was carrying the deception.
And the swept path is `smoothedPoints`, not the raw one — a held arc endpoint at the far end of a
4.1x chord drags the last leg vertex **1.65 spacings** along it, which is what bends the built tube
to 1.70r, three vertices upstream of the junction where nothing looks wrong locally.

`spikes/junction-chord.mjs` is the first measurement, `spikes/junction-repair.mjs` the second.

## Why the fit cannot be patched

The arc is tangent to two straight lines fit to the legs outside the stretch detection collapsed the
corner to. Where the corner keeps turning past that stretch, the fit reads a turning shoulder as
straight. Both local repairs fail, and a reader who proposes either should see the numbers first:

- **Widening the group to the shoulder** takes `direct`/`B` to 0 degrees but runs away on `B`'s bowl,
  where every vertex turns about 9 degrees so the rule never terminates — 36 vertices swallowed. It
  fails to fit at all on `exact`/`B`.
- **Refitting the leg at the vertex the leg actually resumes at**, iterated to a fixed point, fixes
  `direct`/`B` (14 degrees, 2.75r) and makes `field`/`S` worse (45 degrees, 0.16r).

Each fixes one corner and breaks another, which is the signature of a wrong model rather than a bad
parameter.

## Two populations, two treatments

Detection has no notion of margin: a vertex is hard when its radius is below the floor, whether by
3% or by 74%. On `B` those are different worlds. Seven of its eight hard corners sit **53 to 74
percent under** — true spikes at 0.53r to 0.87r, with straight path either side, where the tube has
no choice but to leave the letterform. The eighth, on the right of the lower counter, is at
**1.94r, a 3.2% margin**, inside a stretch curving at 2.2r to 2.9r.

That last one has no straight legs to be tangent to, and fitting an arc to two straight leg lines
there is what produces the 53 degree kink. `easeShallowCorners` in `ease.ts` now smooths any hard
corner within 10% of the floor in place, moving no point more than half a tube radius, so it is no
longer a corner. That took `B` from 1.70r to clear and changed no shipped corner but that one.
Wider margins of 20% and 35% fix nothing more and start changing `tubing`'s strategy mix.

`G` is in the other population. Its failing junction belongs to its 41 degree corner, which sits
at **0.44 of the floor**, so easing cannot reach it; it needs the tangential fix below.

## The long chord is the design, not an accident

`resumeAt` does not produce a long chord only where the fillet is wrong. It produces one at nearly
every corner, because stepping back is how it clears its own test. Bounding the junction chord to
about one sample step therefore refuses **four fillets in five** — `piping` drops from 177 connects
to 40, `tubing` from 111 returns to 15. The three failures are not three broken corners; they are
where a pervasive design becomes visible enough to breach the floor.

That is the whole difficulty. Any fix that admits only tangential junctions redraws every letter,
and any fix narrow enough to leave the other corners alone is patching a symptom.

## What was tried, and what each cost

Measured against `spikes/junction-split.mjs`, which reported 7 genuine failures then (7 again now,
with `G` in and `B` eased out):

| change | failures | cost |
| --- | --- | --- |
| chord bound + junction radius at `rhoMin` | **1** | rejects 4 fillets in 5; every letter redrawn |
| junction radius alone at `0.5 rhoMin` | 5 | fixes `B`, opens a new 1.536r failure on `G` |
| biarc blend, unreconciled | 55 | two blends left overlapping collide inside held geometry |
| biarc blend, reconciled | 3 | `B` improves 1.70r to 1.885r, still under |
| biarc blend, holding the adjacent leg vertex | 15 | holding preserves the seam kink instead of smoothing it |

The one that works is the first, and its cost is the whole alphabet. The rest each fix one corner
and open another, which is the signature of a wrong model rather than a bad parameter.

## The biarc is built and proven, but not wired

`biarcBlend` in `bend.ts` joins two directed points with two arcs meeting at a common tangent, radii
at or above `rhoMin`, sampled at half `spacing` and marked authored. It is property-tested over
1728 configurations of arrival angle, position and reach, and no blend it returns bends tighter than
its own minimum. Tangency is a property of the construction, not something to test for.

Wiring it in still measures worse than letting the corner break. What remains is the seam: a blend
samples at half `spacing` against a leg stepping at `spacing`, and the sweep's smoother pulls the
unheld leg vertex toward the held blend across that discontinuity — the same drag that causes the
original defect, moved to the blend's own edge. Holding the leg vertex makes it worse, because the
raw kink then survives to be swept.

## What piping's blockout cannot do

Setting `blockout` on `piping` changes nothing: it resolves **zero** corners to a return. Blockout
only rescues a break the *strategy* drew, and `piping` is `ALL_CONNECT`, so it never draws one —
every break it takes is geometry-forced, and the blockout branch rescues it by recomputing the very
fillet that already failed. The two capped ends on `M`, 1.22r apart, need the corner to become
traversable, not a different weighting. A corner no fillet can take is one the glass cannot bend
around at all.

## Acceptance, when this is picked up

- `spikes/junction-split.mjs` reports no genuine junction failure in either look at `direct`.
  `tubing`'s `R` at 1.996r is wander, not geometry — it vanishes at `amplitude: 0`.
- `spikes/junction-chord.mjs` shows no run whose chord-filled radius falls below its built one by
  more than float noise, which is the metric and the geometry agreeing.
- The corner strategy mix stays within a few percent of what the cut stage records over A–Z at
  `direct`: 177 connect and 29 break on `piping`, 90 return, 47 connect and 68 break on `tubing`
  (2026-10-12). Otherwise the change is a redraw and every baseline is re-judged rather than
  updated.

## Traps

**A blend that clears the floor can still be wrong.** Radius is not the only invariant: measure what
it strays from the path it replaces and which corners it spans, or a passing number hides a tube
that has left the letterform. `spikes/junction-repair.mjs` draws both.

**A junction reads at roughly `rhoMin` even when it is exactly tangent**, because it is one chord of
a curve sampled at `spacing`. Testing against the floor itself rejects most of them. The junctions
worth catching are an order away, at 0.17 to 0.26 of it.

**The junction's raw radius is not the built one.** The sweep smooths three times, holding authored
points, so any acceptance measured on unsmoothed points is measured on geometry the merge does not
build.
