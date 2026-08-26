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

## If the apexes are worth covering

Nothing here covers a sharp apex, because a tube of radius `r` bending at `2r` cannot enter one. The
move that would is a **hairpin**: run the tube past the apex and back, the way a bender does, letting
it stand slightly outside the letter's outline. That is a new corner strategy beside `break`,
`connect` and `return` — not a `rejoin` — and it is the only thing measured here that would move `W`.
