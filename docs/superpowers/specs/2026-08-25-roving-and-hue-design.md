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

## Not decided

- Whether `EffectSpec` gains per-piece parameters so `piece: 'roving'` is expressible by name at all —
  a wrapper takes another piece, which the current name-or-piece union cannot express in a name.
- The default `dwell`. Pick it against the lab the way `flicker`'s `unrest` was picked: measure, do not
  guess.
- Whether the hue sweep travels the whole wheel or an arc a look names.
