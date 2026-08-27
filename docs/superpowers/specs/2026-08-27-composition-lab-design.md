# Composition lab — design

**For:** whoever builds this lab. **Answers:** what it composes, what it shows, and which of its
claims were measured rather than argued.

A dev page for building a `fire()` by hand and watching it. klieg has three systems that layer
time-varying pieces, and the numbers that tune them have so far been chosen by argument: `roving`'s
`dwell` ships at a provisional 3200ms because nothing measured it. This is the instrument.

It is **not** kliegsminister, the stage-and-repair lab for tube geometry in
[the pipeline lab design](2026-08-23-pipeline-lab-design.md). That one is about shape; this one is
about time. Conflating them has already cost a session.

## What it composes

A whole `fire()` — you leave with the `FireOptions` you paste. All three piece systems share one
time axis, and they are the same shape: a piece is `(t, thing) → offset`, several layer, a
compositor merges.

| system | piece | offset | merged by | per |
|---|---|---|---|---|
| motion (`enter`/`active`/`exit`) | `MotionPiece` | `PoseOffset` | `motion/compositor.ts` | letter |
| `effects` | `EffectPiece` | `PartOffset` | `effects/compositor.ts` | part |
| `lighting` | `EnvPiece` | `EnvOffset` | `mergeEnv` | frame |

Scoping to `effects` alone is the obvious saving and it is the wrong one: the traps worth catching
are *between* systems. One is already recorded — `roving`'s epoch floor makes its pass outrun the
fire's `hold`, so a sign flickers for 4 seconds of every 19 — and an effects-only lab cannot see it.

## Layout

**The preview is the page.** A real `createKlieg({ target, fontUrl, clock })` and `.fire(text, opts)`,
driven by the lab's own `ManualClock`.

Beneath it, a **timeline**: one lane per live piece, with `hold` marked. A pass that outruns the
fire is a lane running past the edge.

Beneath that, instrumentation panels, all on the same clock:

- **Channel plot** — one focused item over one pass. Scalars as lines, `color`/`light` as strips,
  `position`/`rotation` as three lines.
- **item × time raster** — every letter or part down, one pass across. Carries a **coverage
  overlay** marking items the composition never touches (see `EPOCHS`, below).
- **Swatch grid** — one cell per part at its real `x`/`y` in em space, showing the merged offset.
  Doubles as the pointer surface `lamp` and `pointerInWord` need.
- **Tenure and jump** — measured ms between handovers, and jump distance in parts and in em.

The grid is the diagnostic — *which item, and when*. The render is the truth about how it reads.
Where the two disagree is the bloom threshold, and that gap is information, not a defect.

## Clock and scrubbing

Play advances the clock. Seeking forward advances. Seeking **backward rebuilds the fire and jumps
to `T` in a single `advance`**, which is byte-identical to playing there at 60fps (measured; see
below). That costs one rebuild, so a backward scrub debounces on drag-release rather than firing
per pointer-move.

`dt` is a control, including `Infinity` — the reduced-motion value `FrameCtx` warns about, which
nothing currently exercises.

## The one core change

Extract `word.ts`'s effect resolution into a pure function in `effects/frame.ts`:

```ts
resolveFrame(effects, parts, elapsed, ctx) → Map<partIndex, ResolvedOffset>
```

`Word` calls it and keeps only mesh writing. The lab calls the same function.

This is the point: targeting, `stagger` and merging all happen *around* a piece, not inside it. A
lab that reimplements them drifts and then lies — the failure the tube lab already documents as
"the instrument cannot know". Roughly 40 lines moving, no behavior change, baselines unmoved.

## Pool, and the empty-target warning

Two sources, switchable. Synthetic: N parts with deliberately **uneven** `at`/`span`, because real
run lengths are uneven and an even pool flatters every `spread`. Real: `partsOf(kind)` off a
`Word`, which needs no GL context.

The lab shows pool size per `kind` for the chosen look, and flags any layer whose target resolved
to nothing — because **only `tubing` and `piping` have `run` parts**. On the other ten looks,
`{ kind: 'run' }` resolves against an empty pool and does nothing, with no error. This generalizes
the known note that `sequin` is unreachable; it is not just `sequin`.

## Authoring

A code pane per draft layer: an `at(t, part, ctx)` body and a `duration`, compiled through a module
blob URL so it is real JS with real closures. Throws are caught per call and surfaced as a count
plus the first message, never killing the frame. Draft source persists with the rest of the state.

A copy button emits the `EffectSpec[]` for tuned shipped pieces; a draft emits as a factory stub
with its body inlined.

## Where it lives

`packages/core/dev/composition-lab/`, `npm run dev:composition-lab -w klieg`, vite on port 5183 —
5180, 5181 and 5182 are apps/lab, tube-lab and corner-lab, and the point of a fourth lab is
running it beside them. React plus labkit plus a `persist.ts`, the shape the other two use. It
resolves core through a `@core/*` alias rather than `../../../src/`; the older labs are not
retrofitted.

`resolveFrame` is core and gets vitest coverage proving the extraction moved nothing. The lab's
pure sampler is tested. The React shell is not.

## What was measured

Four numbers, none of them derivable from the code by reading it.

**`dwell` controls identity, not intensity.** Across a 4× change, the aggregate readouts are flat —
dark share 19.9% / 19.9% / 20.3% and longest lit stretch 1.34s / 1.11s / 1.34s at dwell
1600 / 3200 / 6400. `unrest` sets all of that. So no intensity readout can settle `dwell`; only
tenure and jump can.

**`dwell` is honest about tenure.** 3200ms asked delivers 3.15s measured, and every value from 800
to 9000 lands within 1.6% of what it asked for.

**`EPOCHS` was the number that decided how the effect reads, and it had no knob** — hardcoded 8, so
a pass visited 7 distinct parts of 24 and then looped, leaving 17 that never flickered. Fixed in
`bb2767f`: a permutation walk and a default of 96, measured. Kept here because it is the coverage
overlay's reason to exist — the lab has to be able to show this class of fault, and it is the
worked example of a number that lost to measurement. Mean jump was 8.3 parts of 24, a third of the
sign, so it does read as jumping rather than travelling, which the doc comment claimed and nothing
had measured.

**The cheap sampler agrees with the renderer.** A numeric 19.9% dark share against 3 of 14 real
sampled frames showing a drop (21%). That agreement is what licenses putting plots under a render
instead of trusting either alone.

## Evidence, and how to re-run it

Both need a server: `npx vite --port 5199` from the repo root.

- `spikes/seek-rebuild/` — `node spikes/seek-rebuild/run.mjs`. Proves seek-by-rebuild is exact.
  **It refuses to pass vacuously**, and needs to: a blank canvas and a still image both report
  perfect agreement. It fails if the canvas carries no ink, and prints the distinct-frame count so
  a static result cannot read as a match. three.js does not preserve the drawing buffer, so the
  read happens in the same synchronous turn as the `advance` that drew it — one task later is all
  zeros.
- `spikes/composition-readout.html` — the raster and grid prototype, and where the `EPOCHS` finding
  came from. Its ports of `flicker`/`roving` are copies, so it can drift from core; the lab imports
  core instead, which is the whole argument for `resolveFrame`.

## Open

Rebuilding on a backward scrub may feel bad on a heavy word. Unknown until built; the fallback is
caching resolved frames rather than the render.

`lighting` is per-frame with no item dimension, so it plots as a single lane and shares almost no
UI with the other two.
