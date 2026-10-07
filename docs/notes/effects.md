# Effects and lighting

**For:** whoever writes an effect piece, changes the compositor (`effects/`), or tunes a look's
lighting. **Answers:** what a piece can and cannot see, where light silently fails to land, and what
was measured about it. The public surface is in the README's `effects` and `lighting` sections.

## What a piece sees

- **`EffectSpec.stagger` is spent before a piece is called.** `effects/frame.ts` applies it and
  hands `at()` the result, so a piece sees neither its own stagger nor absolute time. And
  `stagger()` ramps and clamps — `(t - start) / span` — rather than offsetting, so a late part
  sits pinned at 0 or 1 for part of the pass. A piece needing a per-part phase carries its own
  option, as `turns` does; setting both compounds them.
- **`EffectFrame` writes every targeted part whether or not a layer moved it.** Anything counting
  coverage has to count *moved*, as the composition lab's `samplePass` does — `roving` addresses
  the whole pool and afflicts one part.
- **A required third parameter is additive for implementations and breaking for callers.** When
  `at()` gained `ctx`, `word.ts` and `roving.ts` broke. Do not make `ctx` optional to dodge that: a
  lamp reached without one would silently emit nothing.

## `roving`

- **`roving` wants `{ amount: 1 }`.** It picks its holder from the whole pool of its kind, since
  `at(t, part)` cannot know which subset an effect targets; against a subset the fault lands on a
  part the effect does not drive.
- **A position-dependent inner is not valid.** `holderOf` substitutes `part.index` and keeps the
  calling part's `x`/`y`, so `roving(lamp(...))` lights the part it is standing on. The composition
  lab refuses it.
- **It hands over only where the inner reads as rest**, so `flicker` runs about 1.2x its epoch,
  `chase` holds three, and `hue`, which never rests, never lets go. `roving` publishes `epoch` and
  `epochs` for that comparison.

## `flicker` and `intermittent`

- **`STEP_MS` is derived (`1400 / 24`), not a fixed 24 steps**, or a long pass stretches each step
  into a multi-second strobe. The pass lengthens to whole cycles of `spell` + `calm` so a bout
  boundary lands on a step edge.
- **Every step count must be above zero, and a non-finite scale reads as absent** (`finiteMs`).
  A calm alone used to invent a one-step spell — `flicker({ calm: 15000 })` returned a 15050ms pass
  in which eleven of twelve tubes never dropped — and `calm: Infinity` or `spell: NaN` poisoned the
  piece for life.
- **`intermittent`'s pass is a whole number of inner passes; its bout deliberately is not.** Tie
  the bout to the inner too and every bout opens on phase 0, all identical. `node
  spikes/intermittent-phase.mjs` prints the built scheme (bouts at phases 0.000/0.333/0.667,
  continuous seam), the resonant one, and a free-running gate. The pinning test is `opens every bout
  on a different phase of the inner`.
- **A gate boundary must land on a step edge.** Unsnapped, 5 of 5 boundaries landed mid-step and
  cut drops to 29ms against a 58.3ms step, so round asks produce unround passes — do not round them
  back.
- **Nesting quiet effects multiplies the quiet.** `roving`'s epoch floor makes its duration equal
  the inner pass for any inner over ~17s, so `roving(flicker({ spell, calm }))` resting 95% of the
  time leaves the sign still for 15 of every 19 seconds.

## The fire handle

- **`FireHandle` extends `Promise`, not `PromiseLike`**, because callers already `.catch()` a fire.
- **Under reduced motion both mark boundaries are read off `since`.** That path pins `elapsed` to the
  settled pose, so `active` fired for free and `exit`, read off `activeEnd`, never fired at all.
- **An abort while queued is removed by the queue.** `EffectQueue.push` takes the caller's signal;
  composing signals alone only covers a running effect.

## Lamps

- **A lamp measures to a part's ink center, and the cursor maps through the fit and camera.**
  `PartInfo.ink` carries the drawn bounds; `pointerFrame` maps through `layoutFromNdc`, the inverse
  of `projectLetters`, sharing its `faceHeight` so the two cannot drift. `spikes/lamp-registration.mjs
  [word] [look]` prints the vertical registration.
- **The guard is `a cursor lands on the letter it is over`** in `test/render/word.test.ts`, which
  drives the whole chain: the unit tests either side of the mapping both pass while the pair
  disagrees. Dropping `aspect` from the inverse is caught only there.
- **A run part carries its own ink**, from its tube mesh rather than its glyph box, so `tubing` on
  `klieg` addresses 20 positions where it addressed 5.
- **The light leads the cursor at one end of the sign and lags at the other**, because the
  pointer's whole travel is compressed onto the ink. The README describes that shape rather than
  promising a match.
- **A regrouped sign's lamp lights where the letters used to be.** The part pool is frozen at
  construction.
- **Layered env pieces add per axis.** Two `sweep`s both write `yaw` and `mergeEnv` sums them into
  one uniform turn; two layers you can tell apart need different axes.
- **"The lamp landed" cannot tell one light base from another.** A chunk part reading the body's
  `lightBase` rather than its field's still brightens, so every brightness assertion passes —
  only color separates them. The per-frame emissive reset is reachable only when a regroup retires
  a lit letter, so deleting it leaves the suite green.
- **`orbit`'s default is 0.3**, from an eight-phase sample in §12 of
  [the findings note](../superpowers/specs/2026-08-25-material-lighting-findings.md).
- **A `chunk` part lights a letter's whole field at once** — one instanced draw, one material.
  `spikes/chunk-lamp.mjs`: `chunk` lights 6884 px at gain 40.7 against `body`'s 2003 at 3.6.

## Materials

- **three overwrites `envMapIntensity` every frame** with `scene.environmentIntensity` on every
  material that has no `envMap` of its own, so a test asserting the property on a fresh material is
  green for the whole life of the bug. `envMapIntensity` is a `LookKey` now and every look renders
  at it. Assert what reaches the screen.
- **Never add `opacity` to `LookKey`.** `Word` rewrites `material.opacity` every frame.
- **`gem`'s gray was the white specular lobe**, fixed by `tintSpecular`. Bringing `clearcoat` and
  `specularIntensity` down buys nothing: across the `--cc x --si x --ei` grid every cell lands on
  one saturation-against-brightness curve (`spikes/gem-lobes.mjs`).
- **Mean saturation over a dark look measures the dark.** `oil` is ~90% near-black, so judge its
  film by the colored region's area and its own saturation (`area` and `satc` in
  `spikes/oil-iridescence.mjs`); a hue-bucket count scores the muddiest candidate highest.
- **`PartOffset.gain` was a byte-identical no-op on seven of eight looks.** `spikes/lamp-falloff.mjs`
  and `spikes/lamp-blend.mjs` compare lamp-on and lamp-off renders by md5, which is the only thing
  that caught it.
- **A left-to-right falloff across a long word is the studio's deliberate asymmetry**, not a bug.
