# Text runs — design

**What:** letters that survive a partial exit, regroup into a new word, and carry their own colour.
**For:** whoever implements this in `@klieg/core`.
**Answers:** what a regroup is, how a caller drives one, and how a letter gets its colour.

**Status, 2026-10-07: built except run spans.** Regroup, stages and the tint cascade shipped, and `TextRun` arrived with the run model. `LetterInfo.span` was never added, so `keep` and `tint` cannot ask which run a letter came from.

## The target

An acrostic. Each line of a poem has its first letter in its own colour. The viewer clicks;
everything except those letters exits, and the first letters gather into a word.

## What already exists

Per-letter materials landed in 0.4.0, so nothing in the renderer prevents two letters differing.
`LetterInfo` — `index`, `count`, `line`, `column`, `lineCount`, `columnCount` — already reaches
every `MotionPiece.offset(t, letter)` call, so a piece can already behave differently per letter.
`hold: 'click'` already means "wait for the viewer."

What is missing is a letter's laid-out position, and any notion of the word changing what it says.

## Groups and regroup

A word is a group of letters with a layout. A **regroup** takes a predicate over the group, exits
the letters that fail it, and makes the survivors a new group whose layout is the existing layout
code re-run over their own glyphs.

Letters keep their identity across a regroup — same mesh, same material — so a letter's colour
travels with it. `LetterInfo` is re-derived from the new group: `index`, `count`, `line`, `column`
and `x`/`y` all describe the new word. `span` is the exception. It records where a letter came
from, not where it sits, so it survives every regroup. That asymmetry is the trap in this feature
and it wants its own test.

Because the new layout runs the same code over the survivors' glyphs, arranging them as a line
costs no more than arranging them as a column. There is no cheap version to ship first.

A regroup is not a `MotionPiece`. A piece returns an offset from a letter's laid-out position and
sees one letter at a time, so it can neither know where the other survivors are nor change what the
layout says. Reaching for a `gather` piece is the natural first move and it dead-ends.

## Stages

`FireOptions` gains `then`, a list of stages played in order after the enter:

```ts
interface Stage {
  /** Letters that continue. The rest exit. Omitted means all of them. */
  keep?: (letter: LetterInfo) => boolean;
  /** How the letters that do not continue leave. */
  exit?: ExitSlot;
  /** Arrangement for the survivors' new layout. Omitted leaves the layout alone. */
  as?: 'line' | 'stack';
  active?: ActiveSlot;
  hold?: number | 'click';
  tween?: TweenSpec;
}
```

```ts
fire(poem, {
  enter: 'rise', look: 'neon', hold: 'click',
  then: [
    { keep: l => l.column === 0, exit: 'fade', as: 'stack', hold: 'click' },
    { as: 'line', hold: 'click' },
  ],
  exit: 'shatter',
});
```

`as` names an arrangement, never a string. The survivors already are those glyphs; naming the text
a second time introduces a mismatch nothing can check.

The stage list is data, and the trigger is the viewer. A host page that needs to drive a regroup
from its own events needs a handle out of `fire()` before the effect ends — deferred, below.

## Tweens

Moving into a new layout is one tween per letter, from its current pose to its new laid-out pose.
A `TweenSpec` is a duration, an easing, and a per-channel delay. Channels are timed independently:
position leads, scale follows after a delay, so the word arrives before it resizes to fill the
viewport. `TransitionSpec` already carries `easeBy` for per-channel easing, and the delay is the
same idea one field further, so both live on `transition()`.

Timing belongs in the tween, not in the sequencer. A stage should be a target state plus timing,
so that nothing needs a rule about which properties may change in which phase. That is the shape
the eventual general property-tween model grows from.

## Colour

```ts
tint?: number | ((letter: LetterInfo) => number | undefined);
```

The function is consulted first and may return `undefined`, meaning "not mine." Colour then falls
through to the letter's span tint, then the call's `tint`, then the look's own colour. Every source
has a place in one cascade, so there is no precedence to argue later.

For an acrostic the rule is `l => (l.column === 0 ? 0xff2d6f : undefined)` — one field where spans
would take eight runs.

## Spans

Spans are the next piece of work, not this one, but the seam is cut for them now.

```ts
interface TextRun {
  text: string;
  tint?: number;
}

fire(text: string | TextRun[], options?: FireOptions): Promise<void>
```

Runs concatenate in order to form the string that gets laid out. Layout, wrapping and line breaking
stay span-unaware. Each letter records its run's index as `LetterInfo.span`, which is what survives
a regroup.

## What changes in core

- `LetterInfo` gains `x` and `y`: layout position in em, relative to the block centre. `Word`
  computes these as `baseX`/`baseY` after the per-line centring shift and never passes them on.
- Layout gains a re-run over a subset of an existing word's letters.
- `Timeline` gains the stage sequencer.
- `transition()` gains per-channel delay.

## Testing

Vitest has no GL context. The GL-free assertions:

- `x`/`y` match `Word`'s computed positions, including the per-line centring shift; a letter at the
  block centre gets `x === 0`.
- A regrouped layout equals laying out the survivors' string directly.
- `span` survives a regroup while `index`, `line` and `column` are re-derived.
- `keep` selects, and the letters it rejects are gone from the following stage.
- The tint cascade, including a function returning `undefined` falling through.
- A click advances one stage and no more.
- A per-channel delay holds its channel at rest for the delay, then moves it.

Visual verification is the acrostic in the lab.

## Deferred

**A host-driven handle.** `fire()` returning something that exposes the stage advance, for a page
that triggers a regroup from its own events rather than a click.

**Per-span `look`, and bloom per span.** A different `look` per span means different materials and
different decoration geometry per letter; `bloom` is a whole-frame pass and cannot be per-letter at
all, so a span asking for it would promote it for the whole effect.

**The general property-tween model.** Every event a stage can cause — layout change, fit change,
colour change — expressed as a target value plus timing, tweened uniformly.

**Rich text.** Inline sizing, baseline shifts, mixed fonts. A different project.

## Order of work

1. Regroup, stages and tween timing — everything above except spans.
2. Spans.

Both want a fresh branch off `main`, after `neon-tubing` merges.
