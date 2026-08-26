# Corner rejoin — design

**For:** whoever implements this in `packages/core/src/render/tube/`. Assumes you know the corner
stage fillets a corner it cannot bend around; assumes nothing else.
**Answers:** why letters come out with tube missing from them, and what the stage should do instead
of discarding a leg it cannot join cleanly.

## The problem

A fillet is a circular arc tangent to both legs of a corner. Splicing it in means finding, on each
leg, the vertex the arc can resume at — near enough not to leave a gap, far enough that the junction
between the two does not itself bend under the material's minimum radius `rhoMin`. `resumeAt`
(`runs.ts:436`) walks outward from the tangent point looking for that vertex.

When the leg is still curving where the arc meets it — a corner spread across several vertices, or
the distance field's own wobble — the junction test fails vertex after vertex and the walk runs off
the end. The caller then drops the whole leg.

Measured on `tubing` over A–Z, 90.04 em of contour, every corner forced to `connect` so a break is
the stage failing rather than choosing:

| discarded by | em |
|---|---|
| `resumeAt` walking off a leg | 15.80 |
| `dropHead` / `dropTail` at breaks | 0.85 |

Most of that is re-covered, because the arc plus the straight join still passes near the contour.
What survives as visible hole is **5.1% of the alphabet under the shipped `tubing`** and 3.2% under
`piping`. `W` is the worst letter at 17%, with all 13 of its corners connected and no break anywhere
in it.

`spikes/corner-coverage.mjs` is the measure. Path length minus run length is not it: a fillet is
shorter than the corner it replaced and still continuous, so that number counts working geometry as
loss. The spike walks the generated contour instead and asks, per vertex, whether any drawn point
lands within a tube radius of it.

## The fix

**`TubeSpec.rejoin`** names what the stage does when the arc cannot join its leg. Today the case is
unnamed and always answered one way.

| | |
|---|---|
| `bridge` | Two arcs meeting at a common tangent, from the fillet's tangent point out to the earliest leg vertex a blend reaches at `rhoMin` or wider. Default. |
| `widen` | Re-fit the fillet at a larger radius until its tangent point lands past the shoulder, on leg that is genuinely straight. |
| `relax` | Push the leg vertices that fail the junction test out from their own centre of curvature until they clear. |
| `drop` | Walk for a clearing vertex and give up the leg if there is none — what ships today. |

`bridge` is `biarcBlend` (`bend.ts:236`), which has been in the tree with no callers since the corner
lab. A blend between two directed points always exists, so the path meets it tangentially by
construction rather than by a fit that can be wrong; it returns null only when an arc would bend
tighter than `rhoMin`, and feasibility is not monotone in the room available, so a caller reaching
outward must test every candidate rather than stop at the first failure.

The corner lab prototypes `bridge` and `relax` against a single corner already — `blendAcross` and
`relaxAcross` in `dev/corner-lab/src/scene.ts`. This promotes them into `runs.ts` and runs them over
every corner of every path.

**Independently of `rejoin`, one bug goes.** The backward walk returns `-1` when it finds nothing,
and `mergeArc` does `target.length = 0` — discarding everything accumulated on that path, not just
the leg. It fires 3 times across A–Z. `drop` keeps the leg's far end instead; nothing wipes a path.

## What each option costs

`bridge` keeps the whole leg and adds built vertices. It is the only option that answers the failure
without changing either the letterform or the corner's sharpness, which is why it is the default.

`widen` blunts the corner, and does not always terminate usefully: a growing fillet eventually
collides with the next corner's fillet on the shared leg, and the existing fixed-point loop resolves
that by breaking one of them. It will still leave holes on tight corner sequences.

`relax` is the one option that moves the contour rather than the tube's route through it. Under the
`field` path source it competes with the wobble the field already introduces.

`drop` stays reachable because a look may want small detail falling out of a sign rather than being
drawn through, which is the same argument `TubeSpec.shortRun: 'drop'` won.

## Acceptance

`spikes/corner-coverage.mjs` over A–Z, both looks, both path sources, all four options. `bridge` at
or near 0% holes against today's 5.1% and 3.2%. The bend invariant is unchanged and
`spikes/bend-acceptance.mjs` still has to pass: no run may ship tighter than its look's minimum, and
a rejoin that buys coverage by violating it has not fixed anything.

The other three get measured on the same scale rather than argued about. The pipeline editor's knob
needs numbers behind it, and `widen` in particular is expected to underperform.

`bridge` replaces `drop` outright, so all 24 visual baselines move and get re-recorded.
