# Corner rejoin — design

**For:** whoever works on `packages/core/src/render/tube/` next, and anyone who has read that the
corner stage loses a fifth of a letter.
**Answers:** where the tube actually goes missing from a letter, why it is mostly not a bug, and what
the four `rejoin` strategies buy.

## The tube missing from a letter is the tube's own bend radius

`spikes/corner-coverage.mjs` walks the generated contour and asks, per vertex, whether any drawn
point lands within a tube radius of it. Uncovered arc length is what a reader sees missing.

Run it and look at `OUT=page.html`: the bare contour is the **sharp interior apexes** — the notches
inside `W`, the tip of `A`'s counter, `K`'s junction. A fillet is an arc at the material's minimum
bend radius, and an arc that wide cannot reach into a sharp V, so it cuts across and the tip is left
bare. That is the material, not the stage. It scales with the tube:

| radius | 0.008 | 0.014 | 0.022 (shipped) | 0.030 | 0.040 |
|---|---|---|---|---|---|
| holes, `WAKNVtM` | 3.9% | 6.2% | 8.0% | 19.8% | 24.1% |

**Two earlier accounts of this were wrong, and both are worth not re-deriving.** The first named
`filletAt` returning null and `dropHead`/`dropTail` then cutting the corner stretch out; measured,
break drops account for 0.85 em across A–Z. The second named `resumeAt` (`runs.ts`), which walks a
leg for a vertex whose junction into the arc clears the floor and gives the leg up when it finds
none; it discards 15.80 em across A–Z, which looks damning until you make it never walk at all —
`W`'s holes are unchanged to three decimals. What it discards it replaces with a straight chord, so
it costs fidelity, not coverage.

## `TubeSpec.rejoin`

Four answers to what the stage does when the arc cannot join its leg without bending under `rhoMin`.
The case was previously unnamed and always answered one way.

| | | measured |
|---|---|---|
| `drop` | Walk for a clearing vertex; give the leg up if there is none. Today's behavior, and the default. | — |
| `bridge` | `biarcBlend` from the tangent point out to the earliest leg vertex a blend reaches at `rhoMin` or wider. | halves uncovered contour at `radius` 0.008 (3.0% → 1.6%); a wash at 0.022 |
| `widen` | Re-fit the fillet at a larger radius until its tangent points land on straight leg. | worse: 6.3% at `radius` 0.008 |
| `relax` | Push the failing leg vertices out from their centre of curvature until they clear. | matches `bridge` on coverage, but breaks the bend floor — `piping` 3/49 runs under, against 1/49 today |

**`drop` stays the default.** `bridge` is the only one that improves anything, and only at tube radii
finer than either shipped look uses; at the shipped radii apex rounding dominates and it is a wash.
It is a real option for a fine-tubed look, not a fix to impose. Baselines are unmoved.

`bridge` does clear `piping`'s long-standing under-bend run (1/49 → 0/49) while adding one to
`tubing` under wander (1/225 → 2/226) — worth knowing, not worth trading blind.

`biarcBlend` (`bend.ts`) had been in the tree with no callers since the corner lab; `bridge` and
`relax` promote that lab's `blendAcross` and `relaxAcross` from one corner to every corner.

## The trap in splicing an arc

`splitReturn` finds the fillet inside a span by **object identity**, so a rejoin that splices a
positional copy of the arc's first point instead of the point itself loses the lookup, and the dark
stretch silently grows from one corner to most of the run. It cost 109 of 111 returns and read as a
41% coverage win until the dark tube was counted. `runs.test.ts` pins it for every strategy.

## The hairpin

Nothing above covers a sharp apex, because a tube of radius `r` bending at `2r` cannot enter one.
A **hairpin** does: it runs the tube past the point and turns it around outside, so the apex is
covered twice. It is a corner strategy beside `break`, `connect` and `return` — a fourth weight on
`CornerWeights` — not a `rejoin`. `TubeSpec.hairpin` picks which of two constructions draws it.

`biarcBlend` cannot build either on its own. A blend takes the short way between two directed
points, which is the fillet's side of the apex, and at a sharp corner that is tighter than the
floor: it refuses precisely the corners a hairpin is for.

| | | |
|---|---|---|
| `bisector` | The **major** arc of the circle of radius `rhoMin` inscribed in the wedge *opposite* the corner. Tangent to both legs by construction, so it takes over no leg at all. | `W` to **0%** holes; bend floor clean |
| `uturn` | A U of diameter `2 rhoMin` laid on the corner's axis, tip a fixed `0.5 rhoMin` past the apex, each end blended back onto a leg. Default. | `W` to 4% holes; 2 of 233 runs marginally under the floor |

**Their costs are opposite, which is why both ship.** `bisector` stands
`rhoMin / cos(turn/2) + rhoMin` proud of the letter — 0.10 em at a 71° turn and 0.29 em at 135°, so
it runs away exactly as the corner sharpens. `uturn`'s footprint is the tip overshoot whatever the
corner does, a flat 0.13 em, but it takes over up to `6 rhoMin` of each leg: it abandons both
approaches to buy the apex back, and the leg it eats can force a neighbouring corner to break.

Against `W`'s 17% of contour bare today: `bisector` 0%, `uturn` 4%.

**A hairpin is offered only where a fillet would cut more than a bend radius off the apex**
(`apexLoss`). Without that gate both shapes fire on ordinary 102° corners, abandon their legs for
nothing, and make coverage worse than doing nothing — measured at 4.7% against 2.6%.

**No shipped look asks for one.** `CornerWeights.hairpin` absent or zero is today's behavior, and
all 24 visual baselines are unmoved.

## The trap in splicing an arc

Twice now, geometry spliced into a span has been **a positional copy of a point the span already
had**, and both times it read as a win until it was measured:

- `splitReturn` finds the fillet in a span by object identity. A copy loses the lookup and the dark
  stretch grows from one corner to most of the run — 109 of 111 returns, read as a 41% coverage win
  until the dark tube was counted.
- A `uturn` blended from a point on the leg *line* rather than from the leg's own vertex leaves a
  junction at 0.52 of the bend floor, where the swept mesh self-intersects.

Splice from the path's own vectors, and check the junction into the vertex a blend hands back to —
the blend holds `rhoMin` across its own arcs, but that vertex is not one of them. `runs.test.ts`
pins both.
