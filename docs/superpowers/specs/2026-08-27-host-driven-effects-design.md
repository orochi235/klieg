# Host-driven effects

For whoever implements this in klieg. It answers: what does klieg expose so a host application can
cut a page swap partway through an effect, cancel one effect without destroying the instance, and
advance a `'click'` hold from its own input handler?

The asks are recorded in `FEATURE-REQUESTS.md`, all three from sherpa — a presentation runtime that
plays a flow of pages and uses klieg as the flourish over a page swap. They are designed together
because only one of them changes what `fire()` returns, and that decision is the awkward one to
revisit.

## Surface

```ts
interface FireHandle extends PromiseLike<void> {
  /** Treats this as the dismissing press. No-op unless a hold is waiting for one. */
  advance(): void;
}

interface FireOptions {
  onPhase?: (event: PhaseEvent) => void;
  /** Who dismisses a `'click'` hold. Defaults to `'window'`, which is the shipped behaviour. */
  dismiss?: 'window' | 'host';
  /** Aborts this one effect. Composed with the queue's signal, not a replacement for it. */
  signal?: AbortSignal;
}

type PhaseEvent =
  | { phase: 'active' }                 // the enter has run its length
  | { phase: 'exit' }                   // the hold is over
  | { phase: 'stage'; index: number };  // stages[index] has settled
```

`fire()` returns `FireHandle` rather than `Promise<void>`. Existing callers are unaffected: a
thenable is what `await` consumes, so this widens the return type without breaking it.

There is no `enter` event. Calling `fire()` is that instant, and an event for it carries nothing
the caller does not already hold.

`dismiss` belongs to one effect rather than to the instance, so a host can mix window-dismissed
flourishes with host-driven held slides on a single `Klieg`.

## When each event fires

`Timeline.build` lays three segments — `[0, enterEnd]`, `[enterEnd, activeEnd]`,
`[activeEnd, duration]` — with `blendMs` straddling each boundary.

| Event | Instant |
|---|---|
| `active` | `enterEnd`, the end of the enter piece's duration |
| `exit` | `activeEnd` |
| `stage` | `Sequence.settle()`, carrying the phase index |

`active` is the one sherpa cuts the swap on: mid-blend, where the word has landed and is at full
presence. `Sequence.phase` starts at `-1` for the opening word, so the first stage reports
`index: 0` and indexes the caller's own `stages` array.

**These times cannot be precomputed.** `release()` calls `build()` again with a new hold, moving
both `activeEnd` and `duration`; a click-held effect has no `activeEnd` until the press lands. So
detect boundaries against `elapsed` on each tick. A `setTimeout` scheduled at fire time works for
every numeric hold and silently never fires `exit` for a click hold.

**Emit per crossed boundary, not per frame.** `Sequence.tick`'s `while` loop deliberately catches
up when one frame spans several stages. Detection that reports at most one event per tick drops a
`stage` event whenever a frame runs long.

Under `prefers-reduced-motion: reduce` the phases still happen without travel, so events still
fire. On an unsupported instance `fire()` resolves having rendered nothing, and no event fires.

A throwing `onPhase` must not kill the render loop. Use the pattern `ShowClock` already uses for
its subscribers — catch, then `queueMicrotask(() => { throw err })` — so the error reaches the host
as an unhandled rejection and the next frame still draws.

## Across queue states

An effect is *pending* (queued, no `Timeline` yet), *running*, or *settled* (finished, aborted, or
dropped by a `replace`).

| | pending | running | settled |
|---|---|---|---|
| `advance()` | latch; release on arrival | release the hold | no-op |
| `signal` abort | drop from queue, never renders | abort, no exit plays | no-op |
| `onPhase` | fires once it runs, and never if it is dropped first | fires | never again |

Latching is what keeps a presenter's press from being lost to a race the host cannot observe. It
releases that effect's own hold when it reaches one; it does not skip the effect, which is what
`signal` is for.

An abort resolves the handle rather than rejecting it, matching the queue's existing stance that a
dropped effect is done rather than failed. `run()` already takes a signal and wires `abort` to
`finish`, so composing the caller's signal with the queue's is the whole of the work.

## `dismiss: 'host'` and `clickAnywhere`

`clickAnywhere` (0.9.0) gates an anchored placement's use of `hold: 'click'`, because the dismissal
is a listener on `window` and a strip sharing a page would be dismissed by presses that have
nothing to do with it.

`dismiss: 'host'` attaches no listeners at all, so that reasoning does not apply and the guard does
not either. An anchored placement may hold on a click under host dismissal without the opt-in.

`'host'` withholds the `Escape` listener as well as `pointerdown`: a host that has taken input has
taken all of it. A `modal: true` effect under host dismissal is escapable only if the host wires it,
which is the host's business.

This is what unblocks sherpa's documented v1 limit, where klieg entries are single-step and nothing
klieg shows is dismissible.

## Where this departs from the obvious models

The Web Animations API is the platform's shape for a thing that plays with phases and programmatic
control, and its timing model uses the same before/active/after vocabulary. Two deliberate
departures:

- WAAPI puts the promise on `animation.finished`. klieg puts it on the handle, because
  `await bk.fire(...)` already ships and a `.done` property would break every caller.
- WAAPI exposes events through `EventTarget`. klieg takes one callback at fire time, because a
  subscriber attaching after a phase has passed receives nothing, which reads as a bug.

## How sherpa consumes this

Checked against sherpa `main` / `923df22`, 2026-08-28.

sherpa already declares this event type verbatim — `PhaseEvent` in `packages/core/src/registry.ts`,
delivered to a page through `PageContext.phase(event)`. The shape above is not a proposal to
sherpa; it is what sherpa is already written against. Its klieg provider types the instance
structurally as `fire(text, options?): Promise<void>`, so `FireHandle` has to stay assignable to
that.

The v1 limit this lifts is enforced in code rather than merely documented:
`packages/core/src/providers/klieg.ts` throws on `hold: 'click'` or `stages`, and declares
`caps: { steppable: false, abortable: false }`. Its comment names the same one-press-two-actions
problem `dismiss: 'host'` removes.

sherpa's step verb is `PageHandle.seek(offset)`, documented as absolute, idempotent and
press-space — never a delta. klieg's `Sequence` only moves forward (`enterNextPhase` increments and
rebases `phaseStart` with no rewind), so klieg exposes `advance()`, which *is* a delta, and the
provider does the translation: `seek(n)` becomes `n - current` advances, and a backward seek
remounts. A provider implementing part of a verb is already normal there — the iframe provider is
`steppable: false` outright.

## Testing

Drive `ManualClock` and assert exact event sequences, as `index.test.ts` already does. Three cases
carry the design:

- A click-held effect emits `exit` after `release()`, which fails against any precomputed schedule.
- One frame spanning two stages emits two `stage` events.
- `dismiss: 'host'` attaches no window listeners, asserted against the suite's `stubListeners()` map.

Verify each by mutation before trusting it.

## Not in scope

Backward seeking through stages, a `playState` property, pausing, and any event for the enter.
