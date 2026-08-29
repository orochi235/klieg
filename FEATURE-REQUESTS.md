# Feature requests

Changes consumers have asked klieg for, and the use case behind each. These are requests, not
commitments — nothing here is scheduled.

## Phase callback on `fire()`

**Asked by:** sherpa, a presentation runtime that plays a flow of independent pages — mostly
separate documents in iframes — and orchestrates the transitions between them. klieg is its first
in-process adapter: the flourish that plays over a page swap.

**The need:** cut the swap at a chosen moment *inside* an effect, once the word has landed and is
at full presence, so the swap happens behind an established flourish rather than during its
arrival.

**Today:** `Klieg` is `supported` / `fire()` / `destroy()`, and `fire()` resolves only after the
effect has left. An interior instant can therefore only be timed by reimplementing klieg's phase
arithmetic outside klieg — and since enter and exit lengths are fixed per piece and not exported,
that arithmetic cannot be written correctly from out there.

**Shape:**

```ts
type PhaseEvent =
  | { phase: 'active' }                  // the enter has run its length
  | { phase: 'exit' }                    // the hold is over
  | { phase: 'stage'; index: number };   // a stage's new word has settled

await bk.fire('RESULTS', { onPhase: (e) => { /* … */ } });
```

`blendMs` straddles each boundary, so there is no hard instant. Firing at the end of the enter
piece's duration — the middle of the blend — is what a caller means by "the word is there now."

Under `prefers-reduced-motion: reduce` the phases still happen without travel, so the callback
should still fire. On an unsupported instance `fire()` resolves immediately having rendered
nothing, and the callback should not fire at all.

## Per-fire cancellation

**Asked by:** sherpa.

**The need:** abort one running effect when the presenter skips ahead or seeks backward, without
tearing down the instance.

**Today:** `destroy()` takes the whole instance and its GL context with it. `policy: 'replace'`
cancels only as a side effect of firing something else, so a consumer that wants to cancel and
show nothing has to fire a no-op effect to do it.

**Shape:** `signal?: AbortSignal` on `FireOptions`. An abort plays no exit — the effect stops and
`fire()` resolves, which is already what the promise promises: it resolves once the effect has
left the screen, whether it played out or was cancelled.

`run()` already takes a signal and already wires `abort` to `finish`; the queue supplies it. The
ask is to compose a caller's signal with that one, not to build the teardown path.

## Programmatic advance of a `'click'` hold

**Asked by:** sherpa.

**The need:** drive a staged effect from sherpa's own input dispatcher, so that the presenter's
keys and clicks reach klieg the same way they reach everything else in the flow.

**Today:** a `'click'` hold and a stage's `'click'` hold are dismissed by a `pointerdown` captured
on `globalThis`, or by `Escape`. There is no API for it, so a host that wants to advance a stage
can only synthesize the very events it is itself listening for.

That capture-phase window listener also means klieg already sees the host's own input. A host that
advances its own state on a pointer press and has a `'click'`-held effect on screen gets both
things from one press — klieg dismisses and the host advances — with no way to take only one.

**Shape:** something on the handle or the options that means "treat this as the dismissing press,"
plus a way to decline the global listeners when the host is supplying them:

```ts
const held = bk.fire('OPEN', { hold: 'click', dismiss: 'host' });
// …later, from the host's own key handler:
held.advance();
```

`dismiss: 'host'` is the part that matters most: with the window listeners off, one press does one
thing.
