# Roving faults and hue cycling — design

**For:** whoever implements the next two effect pieces. **Answers:** how a fault moves from segment to
segment, how a sign cycles its colour, and which of the two needs anything the pipeline does not
already have.

Both build on the shipped [effects pipeline](2026-08-24-effects-pipeline-design.md). Read its
`## Two limits found by asking for a roving fault` section first — this design is the answer to it.

Decisions here were made in conversation and are settled; the open questions are named at the end.

## `hue` needs no new capability

A piece returning `color` for every part is a synchronized hue cycle, and that already works.
`PartOffset.color` exists, `writePart` already reads it (`out.color ?? partBaseColor[index]`), and
`at(t, part)` receives the same `t` for every part unless staggered — so "the whole sign shares one hue
that changes over time" falls out of a piece that ignores `part` entirely.

It composes with `flicker` for free: flicker writes `gain`, hue writes `color`, they merge into one
resolved offset, and gain multiplies the hue-driven colour. A hue-cycling sign with one bad tube needs
no code beyond the two pieces.

A hue *gradient* travelling along the word is the same function with one term added — `at(t, part)`
offsets the hue by `part.at`, the arc-length share already computed for each part.

**The sweep holds luminance, not saturation.** Hue at constant HSL lightness has wildly varying Rec.709
luminance, and the bloom pass thresholds at 0.72 (`bloom.ts:65-69`). A naive sweep therefore brightens
through yellow, dims through blue, and drops out of bloom entirely at the dark end — read as a bug, not
a throb. The piece trades saturation where it must to hold perceived brightness, so blues and violets
come out paler and the sign glows evenly all the way round the wheel. This is the same failure class as
the `emissiveIntensity` → bloom finding in Task 2 of the pipeline plan.

## `roving` wraps a piece

The shipped `flicker` afflicts a fixed set of runs. A fault that *moves* cannot be a second layered
effect, because layering composes channels on a part and cannot gate which part: the merge rule is
multiplicative for `gain`, and no value a second layer returns cancels a first layer's 0.08. So the
composition happens one level up.

```ts
export function roving(inner: EffectPiece, spec?: RovingSpec): EffectPiece;

export interface RovingSpec {
  /** Milliseconds one segment holds the fault before the wrapper looks for a way out. */
  dwell?: number;
  /** Fixes which segment is afflicted in which epoch, so a pinned frame reproduces. */
  seed?: number;
}
```

It targets every run. `at(t, part)` returns rest for all but the current holder and delegates to `inner`
for that one, so `roving(flicker())` is one bad tube that jumps and `roving(anything)` works without the
wrapper knowing what it wraps.

**Exactly one segment is afflicted at a time**, and the fault jumps somewhere unpredictable every few
seconds rather than travelling in order. A travelling fault reads as an effect; a jumping one reads as a
defect, which is the point.

Three mechanics carry it:

- **Epochs come from `t`.** A piece sees only `t` normalized within its own pass, so a wrapper running a
  slower clock has to span it: `duration` covers several dwells, rounded up to a whole multiple of
  `inner.duration` so the inner's phase stays continuous across the wrapper's loop boundary. The
  inner's phase is `((t * duration) % inner.duration) / inner.duration`.
- **The holder** is `hash(epoch + seed)` against `part.count`, resolved inside `at()` because the count
  is not known at construction.
- **The handover is deferred until the outgoing part is at rest.** At an epoch boundary the wrapper
  evaluates `inner.at(phase, outgoing)`; if that is not rest, the outgoing part keeps the fault until it
  is. Without this a jump can land mid-drop and snap a tube to full brightness in one frame.

The deferral is why the wrapper evaluates the inner piece rather than the alternatives. Requiring every
looping piece to rest at `t = 0` would make pass boundaries safe but constrains every future piece and
forbids `flicker`'s first step from stuttering. Handing `at` the raw elapsed solves the across-passes
limit generally but is a breaking change to a contract eight tasks were built against, and does not by
itself solve the mid-drop handover.

**No dwell jitter.** Irregular stutter is what reads as a fault; irregular dwell on top adds randomness
nobody can perceive separately and makes the epoch arithmetic much harder to pin. Fixed dwell, random
holder.

## Traps

**"Who holds the fault at time `t`" is a bounded search, not a lookup.** The deferral means the answer
depends on whether the previous holder was at rest, which depends on the inner piece. It stays pure — everything
derives from `t` — but boundary arithmetic that is off by one produces a fault that either sticks
forever or jumps twice, and both look plausible in a single frame. `flicker`'s longest dark run is about
15% of a pass, so a lookback of a few steps always resolves; pin the bound rather than scanning
unboundedly.

**A wrapper duration that is not a multiple of the inner's makes the stutter jump at the loop seam.**
The inner's reconstructed phase is discontinuous there, so a drop can truncate or repeat once per
wrapper pass — rare enough to look like a different bug.

**Never make the *epoch* a multiple of the inner's duration.** It looks like the tidier version of
the rule above — both clocks tile, and the loop seam stops being a special case — and it permanently
breaks the effect. Every handover then samples the inner piece at the same phase, and whether a piece
is at rest at a fixed phase is a per-part constant: `flicker` is mid-stutter at phase 0 for about 18%
of part indices, and the first such index to take the fault blocks its own handover forever. Measured
on a prototype at one holder per pass and zero handovers, against 4 holders and 6 handovers for the
arithmetic that shipped. The wrapper's *duration* is a whole multiple of the inner's, so the inner's
phase is continuous at the seam; the epoch then divides that duration evenly, which leaves the
boundary phase free to move through the inner's cycle.

**A deferred handover waits a whole epoch.** Resolving "until the outgoing part is at rest" mid-epoch
makes the holder a function of a search over continuous time. Retrying at the next boundary keeps the
holder constant within an epoch, which is what makes "exactly one holder at every sample" testable at
all.

**The holder chain is walked twice per pass.** `t` is normalized within a pass, so the walk needs a
start, and starting fresh each pass leaves the loop seam as the one handover nothing defers. The
first lap finds where the previous pass left the fault; the second answers.

**`roving` draws its holder from the whole pool of its kind, not from the parts it was given.**
`at(t, part)` sees pool-wide numbering and cannot know which subset an effect targets, so a `roving`
against anything but `{ amount: 1 }` can put the fault on a part nothing drives — and the sign then
shows no fault at all, which reads as the piece being broken.

**Colour never reaches a `body` part.** `writePart` returns after the brightness write for a body, so
`hue` on `{ kind: 'body' }` is silently inert. A run only reads it when the look applied its own
material: a debug material override clears `litReadsRunColor` and the buffer write is skipped.

**A roving visual baseline has to be pinned at a moment the holder is actually dark.** `flicker` rests
about 82% of the time, so most pins give a shot byte-identical to plain `tubing` — a baseline that
would pass with the whole effect deleted. Two of five epochs sampled at their midpoint showed nothing
at all. Pick the pin by measuring against the look's own baseline, not by picking a round number.

**`color` is last-writer-wins, so two hue pieces fight silently.** The merge keeps the last non-undefined
value; nothing warns.

**A hue piece overrides `tint`.** `tubing` sets `tintTo: 'decoration'` and `FireOptions.tint` recolours
the run palette, which a piece writing `color` every frame then overwrites. Decide per look whether tint
should modulate the swept hue or lose to it.

## Acceptance

- A whole wrapper pass, sampled densely, has **exactly one** holder at every sample — never zero, never
  two.
- Breaking the deferral makes a mid-drop handover observable in a test, not only on screen.
- `roving(flicker())` at a pinned clock is reproducible across runs, so it can hold a visual baseline.
- A hue sweep's Rec.709 luminance stays within a stated tolerance across the whole wheel, asserted
  numerically rather than by eye.
- Every shipped look renders byte-identical: no built-in look declares either piece.
- `npm run check` and `npx playwright test` stay green.

## Decided, on implementation

Both pieces ship. [The plan](../plans/2026-08-25-roving-and-hue.md) has the tasks.

- **`roving` is factory-only and `hue` is a name.** `EffectName` is `'flicker' | 'hue'`. `EffectSpec`
  did not gain a per-piece parameter field: a wrapper takes another piece, which no name can express,
  and tuning a leaf piece already works through `piece: EFFECTS.hue({ ... })`. Whether names should be
  tunable at all is still open, and still blocking nothing.
- **The sweep travels the whole wheel by default**, `from` 0 and `span` 1 turn. Any other `span` snaps
  back at the loop seam, which is stated on the field rather than designed around.
- **`dwell` defaults to 3200ms, provisionally.** It was not measured — the lab that would measure it
  is not built, and no shipped look declares `roving`, so nothing depends on the number. Pick it
  properly the way `flicker`'s `unrest` was picked once there is something to measure against.
- **`luminance` defaults to 0.5**, which is where the wheel's darkest and brightest hues give up the
  same amount: blue's saturation against yellow's brightness.
