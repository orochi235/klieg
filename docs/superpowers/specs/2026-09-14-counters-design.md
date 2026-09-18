# Counters in tubing — design

**For:** whoever reads or extends a tube spec's contour policies. **Answers:** why a tube's
counters — the holes in `o`, `B`, `e`, `8` — went missing, and how a spec keeps them.

**Status: built** on 2026-09-14, on branch `counters`, against `main` at `f0ffc9d`.

## What was lost, and why

At the shipped `tubing` settings, 26 of 349 counters across the shipped faces drew no tube at all,
and 15 letters lost every counter they have (`spikes/counter-loss.mjs`). A further 21 drew only
dark glass, and 4 drew runs that `select` left unlit (`spikes/counter-rescue.mjs`, seed 0).

It is not simplification. `radius: 0.022` at `bend: 2` gives a minimum bend radius of 0.044 em, and
a small counter's curve is tighter than that. Every corner the cut found on every lost counter was
hard, and the corner stage consumed a mean 74% of a lost counter's loop against 20% for survivors
(`spikes/counter-cut.mjs`). A counter reaches the screen exactly when at least one lightable span of
`minRun` or longer survives corner treatment. That rule predicts every one of the 349 rings.

The dark-glass counters fail the same test from the other side. Their lightable spans were real,
but each fell just under the 0.15 em floor, which a dark span is exempt from, so only the blockout
return survived. The lab's default face, Archivo Black, draws the `A` of `JACKPOT!` this way.

## The shape

A ring's role, `'outline'` or `'counter'`, is read off `shape.holes` in `surfacesOf` and copied onto
each path by the `direct` source. `field` and `exact` rebuild paths from a grid, so their paths have
no role and no policy reaches them.

```ts
interface TubeSpec { contours?: Partial<Record<ContourRole, ContourPolicy>>; /* … */ }

interface ContourPolicy {
  rescue?: readonly RescueRung[]; // tried in order on a contour that would not reach the screen
  floor?: number;                 // thinnest glass a rung may use, as a share of radius; 0.5
  lit?: 'select' | 'one';         // 'one' lights the longest lightable run select left dark
}

interface RescueRung {
  blockout?: number;              // this contour's blockout
  radius?: number | 'fit';        // share of radius, or thin enough to clear the tightest bend
}
```

The policy is keyed by role so an outline policy uses the same mechanism later. `tubing` opts its
counters in with `RESCUE_LADDER` and `lit: 'one'`.

**The cut** stitches each path at the spec's own settings, as before. A path whose role has a rescue,
and that leaves no lightable span of `minRun` or longer, is stitched again at each rung the floor
allows, and the first rung that leaves one is kept. A thinned radius rides on the runs, and the sweep
uses it. Repairs from a discarded attempt never reach `onRepair`.

**Assign** runs `select` over the same pool as before, so no other run's lighting moves. A contour
with `lit: 'one'` that came out with nothing lit then gets its longest lightable run lit.

## The ladder

`RESCUE_LADDER` turns blockout off at full thickness, then steps the glass to ×0.85, ×0.70, ×0.60
and ×0.50. Inside the real glyph build at seed 0, of the 52 counters that did not reach the screen
lit, the first rung brings back 22 and the thinner rungs 13 more. No rescued run bends tighter than
its own glass allows.

17 stay lost at half thickness: vegapunk's 0.27 em loops, lobster `Q`, satisfy `R`, and rye's
0.006 em sliver of an `A`. A `'fit'` rung brings the vegapunk loops back at about 0.47 of stock
glass, under the default floor. Whether glass that thin still reads as the same sign is a look call,
so the floor and the rungs are knobs in the tube lab, not constants.

## What it guarantees

- With `contours` absent, every blueprint is unchanged.
- With a policy set, a letter whose counters already draw and light keeps its geometry and lighting
  exactly. `contours.test.ts` checks this across every shipped face.
- In a letter that *was* rescued, outline runs can re-cut too, because the run budget and the corner
  seeds are shared across the glyph.

## Limits

- **Position in the word matters for a borderline counter.** A letter's seed is its slot, and 23 of
  the 52 rescue at some seeds and not others.
- **`shortRun: 'drop'` can still lose a rescued counter.** The lightable test assumes `fit`, which
  never slices a span below `minRun`.
- **A stages regroup is not re-cut.** Blueprints are built once per letter.

## Decided against

- **Exempting counters from `minRun`.** The centerline really is tighter than the glass bends, so
  the sweep would pass through its own wall.
- **Sizing glass to the tightest bend by default.** Outlines carry 0.008–0.021 em kinks, so this put
  49 of the 50 counters it touched under half thickness, round ones included. It survives as the
  `'fit'` rung.
- **Opening the counter geometrically.** It changes the letterform.
