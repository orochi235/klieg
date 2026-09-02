# Composition lab, round three — design

**For:** whoever builds or later reads the composition lab. **Answers:** what the timeline and the
draft pane are for, and what each of them is allowed to claim.

Both were specified in [round one](2026-08-27-composition-lab-design.md) and deferred twice. Round
two's panels all describe **one pass of a piece**. Neither of these does: the timeline is about the
fire the pass sits inside, and the draft pane is about a piece that does not exist yet.

## The timeline

One lane per enabled layer, drawn on the **fire's** clock — 0 to `hold` plus the tail the transport
already runs — rather than on any piece's pass. Each block in a lane is one pass of that layer's
piece. A dashed rule marks `hold`, the tail is shaded, and the playhead is the one the deck already
shares.

The reading it exists for is the lane that **runs past the edge**. `roving` at `epochs: 96` makes a
1400ms flicker a 306s pass, so against a 6s hold about 2% of one pass ever plays: the layer does
roughly one thing per fire and it is not the thing the panels below describe. The lane draws that
overrun in the warning ink and says what share plays. No panel shows it today, and it is the
question round one was built around.

Lanes scrub. Pointer x maps to elapsed and goes through the transport's existing `seek`, which
already rebuilds the fire on a backward jump.

**It says nothing about what moved.** A block means the piece ran, not that any part changed —
`roving` addresses the whole pool and afflicts one part of it. The raster is what answers coverage,
and the timeline must not look like a second opinion on it.

## The draft pane

A layer of kind `draft` gets an editor for the body of a factory returning `{ duration, at }`,
compiled through the blob URL `draft.ts` already uses. CodeMirror 6, with the JavaScript language
and a lint gutter, dev-only in `packages/core`.

**Compiling is a module.** Every compile creates and imports a blob URL, so it happens on ⌘↵ and on
blur, never per keystroke.

**A throw inside `at` is caught per call, counted, and reported** — the piece rests for that call
rather than killing the frame. This is the half of the round-one spec that was never built: today a
draft that throws on its second part takes the whole lab down.

Two numbers, and they are different failures. A **compile error** marks its line in the gutter; the
blob wraps the body in `export default () => {` so a reported line is one greater than the pane's,
and the marker is off by one for anyone who forgets. **Runtime throws** get a count and the first
message, with no line — a stack through a revoked blob URL does not point anywhere a reader can go.

## What this does not add

No lane for `enter`/`active`/`exit`: those are motion, not effects, and the lab drives a real fire
that already shows them. No draft for anything but a whole piece — no editing a shipped piece's
body, which would make the emit panel print a lie.

## Testing

The pure modules get vitest, matching both earlier rounds: a new `timeline.ts` (lane geometry and
the share-that-plays figure) and `draft.ts`'s guard. The React shell does not.
