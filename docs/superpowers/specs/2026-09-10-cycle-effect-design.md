# `cycle`: one effect piece that hands over to the next

**For:** whoever works on `effects/` next. **Answers:** what `cycle` is, why the handover defers
rather than cuts, and what `deadline` actually trades away.

A look's `effects` list runs every piece at once, layered. `cycle` runs them one at a time instead:
a sign flickers for a few seconds, then chases, then shifts hue, forever. It is an ordinary
`EffectPiece`, so the compositor does not change and it composes with everything already written.

```ts
{ piece: cycle({ pieces: ['flicker', 'chase', 'hue'], every: 3000, deadline: 400 }),
  target: { kind: 'run' },
  stagger: 0.6 }
```

## The handover

`duration` is `pieces.length * every`, and `at()` delegates to whichever piece the part is
currently on.

Each part carries its own index. Its nominal boundary for step *k* is `k * every + phase`, where
`phase` comes from the `EffectSpec`'s existing `stagger` — so the handover sweeps across the word
instead of snapping the whole sign at once. `stagger: 0` degrades to the whole-word switch, which
is why that case needs no separate mode.

A due part swaps at the first frame the **outgoing** piece reports `isRest` on it, or is forced
once it has been overdue by `deadline`. Deferring to rest is what `roving` already does, and it is
what makes a clean handover need no crossfade: at rest there is nothing on screen to cut away from.
The deadline exists for pieces that never rest — `hue` is always mid-shift — which would otherwise
hold their part for good.

**`deadline` must stay below `every`.** Above it a part can fall more than one step behind, and the
piece it was overdue for is skipped outright: the chase never happens on that letter. Clamp it.

## What `deadline` trades

It reads like a tolerance and behaves like the opposite: a *short* deadline protects the sweep.

```
deadline   forced   in order
   50ms     70.4%     100.0%
  150ms     64.8%     100.0%
  250ms     59.3%      93.9%
  400ms     55.6%      90.9%
  600ms     38.0%      81.8%
  800ms     33.3%      81.8%
 2000ms     33.3%      81.8%
```

*Forced* is the share of handovers that pop rather than land at rest. *In order* is the share of
neighbouring parts that still hand over in index order — the sweep reading as a sweep. Give the
deferral room and the pops nearly vanish, but parts reach rest on their own schedules and the wipe
decays into noise. Both curves flatten by 800ms, past which legibility is being paid for nothing.
The floor near 33% is structural: one piece in three never rests, so every exit from it is forced.

Default `deadline: 400`, in the knee of both curves.

**These figures are the shape of the trade, not a calibration.** They come from stand-in rest
models in `spikes/cycle-handover.mjs`, not from the real `flicker`, `chase` and `hue`. The ordering
of the curve is what the spike establishes; the percentages will move against the real pieces, and
the default is not fixed until they have been re-measured there.

## Testing

The schedule is pure in `(now, phase, every, deadline, restFn)` and tests without a renderer:
every piece takes its turn, no step is skipped while `deadline < every`, a never-resting piece
still hands over, and `stagger: 0` collapses to the whole-word switch. `spikes/cycle-handover.mjs`
is the seed for those cases.

## Not in this spec

The lab reel — `/show/` rotating whole enter/active/exit and look combinations the way it already
rotates looks — is a separate piece of work, at a different level, and gets its own spec.
