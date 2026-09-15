# Tube power states and spark kicks — design

**For:** whoever maintains klieg's effect signals, or wires a sign that shorts out. **Answers:** how
your code switches a running sign dark and back on, and how a spark's landing reaches the
segments it hit.

**Status: built** on `tube-power`, 2026-09-15, for the portfolio masthead. What a caller sees is in
the README beside `hinge` and `dwell`; this holds the decisions.

## What was asked

- A **shorted-out** state that turns all of a tube sign's lighting off.
- A **powering-up** state that flickers every segment the same until it is warm — a starter's
  strike and catch, with a thinning stutter and a jittering glow built beside it.
- A **proximity flicker** that dims more often and for longer, especially while sparks land.
- An **overload**: hover intensity held at 100% for 3 seconds shorts the whole sign, which
  reignites a few seconds later.

## The shape: signals your code drives

Every ask needs a running sign to change on something outside klieg, and all of it is built as
signals and effect pieces rather than as methods on a fire:

- **`power({ warmup, start, trip })`** holds a sign-wide state, `on → shorted → warming → on`.
  `short()`, `short({ for })` and `up()` change it. `piece` darkens (`gain: 0`) or warms every
  part it targets and contributes nothing when on; `warm` is a signal, 1 when on, for `hinge` to
  hold a sign's own effects off until warm.
- **`strike`, `thinning`, `glow`** are `Warmup`s: a duration and a gain against milliseconds. They
  ignore the part, which is what moves every segment together.
- **`level()`** is one value every part reads, set by your code — the overload watches a hover
  intensity through it.
- **`kicks({ radius, recoverMs })`** takes `kick(at, energy)` and lifts nearby parts on `near`'s
  falloff, draining at `recoverMs` per unit; overlapping kicks keep the higher.
- **`peak(...signals)`** reads the highest, so a hover build and a spark's spike drive one flicker.
- **`flicker({ drop })`** groups steps into dims of `drop` milliseconds. The pass is untouched, so
  `hinge` stops varying `drop` still agree on duration.
- **`pointOn(...).inWord`** is the hit in layout space, where a kick has to land, found by undoing
  the word's fit and `transform` through its inner group.

## Decisions

- **Calls land on the next frame.** Your code runs on its own clock, so a state change is timed
  from the first `ctx.now` that sees it, and state advances once per `now` however many parts ask.
- **A timed short warms from when the dark ended**, not from the frame that noticed, so a late
  frame does not lengthen the dark.
- **Shorted is `gain: 0`, not the look's dark glass.** Gains multiply, so every other effect goes
  dark with it, and at zero glow the lit glass (`0x121a00`) already reads as the dark tube
  (`0x1c2410`). The lit-to-dark material swap stays unbuilt.
- **Under reduced motion a warm-up is skipped**: `strike` is a run of whole-sign flashes.
- **The trip watches through `piece`.** It records the signal's highest reading across the parts
  asked in a frame and judges the hold on the next, so it lags a frame and needs `piece` in the
  effects.
- **A part first asked about after a kick never sees it**, so a new fire does not flash with the
  last 64 kicks held for parts not yet seen.

## Decided against

- **Methods on the fire handle** (`handle.short()`): tube verbs in the core fire API, closed to
  `hinge` and out of reach of a backdrop.
- **Swapping a live fire's effect list**: the caller times the warm-up, and every swap restarts
  the running pieces' phase.
- **Tripping on klieg's own `dwell`**: it follows `near`, which reads 1 only at a letter's ink
  center, so "held at 100%" would almost never happen.
