# Flicker Macro Spell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `flicker` a long time scale — a tube stutters for a few seconds, holds steady for ten or twenty, then starts again — without a second clock.

**Architecture:** Two new `FlickerSpec` fields, `spell` and `calm`, gate the existing per-step stutter. Both are snapped to a whole number of steps and the pass length is fitted to a whole number of spell-plus-calm cycles, so every gate boundary lands on a step edge. `STEPS` stops being the constant 24 and is derived from the pass length at a fixed ~58ms a step, which is what makes a minute-long pass flicker instead of strobe.

**Tech Stack:** TypeScript, vitest. No renderer involvement — an `EffectPiece` is a pure function of `(t, part)`.

**Read first:** `packages/core/src/effects/pieces.ts` (the piece), `packages/core/src/effects/roving.ts:31-37` (the precedent for fitting a pass to whole sub-passes, and the comment on the resonance trap), and `packages/core/test/effects/pieces.test.ts:15-40` (the `gainsAcrossOnePass` and `darkRuns` helpers every test below uses).

---

## Why this shape and not a wrapper

An `intermittent(inner)` wrapper was the first idea and it is the wrong one. A wrapper runs two
independent clocks, and when the gate period lands on a whole multiple of the inner duration the
inner phase at the start of every burst is 0 — so every burst opens on the same phase and they all
look identical, silently deleting the variation the wrapper exists for. `roving` documents the same
resonance from the other side, above its epoch arithmetic. Folding the spell into `flicker` derives
both scales from the one `t` and the trap cannot exist: the step index runs continuously across the
whole pass, so each spell samples a different stretch of the hash.

A general wrapper is still fine for `roving` or `hue` later, but only if it derives its period from
`inner.duration` rather than taking one from the caller.

## The prototype, and what it measured

`spikes/flicker-macro.mjs` exists on the `composable-lighting` branch, not on `main`. Its numbers are
reproduced where each task needs them, so this plan does not depend on it. What it established:

- Deriving steps as `round(duration / 58.3)` returns exactly **24** at the 1400ms default, so nothing
  shipped at the default moves, and holds 58.4ms a step at 3000, 8000, 15000 and 30000ms.
- A 60000ms pass asked with a 4000ms spell and 15000ms calm fits to three spells. The prototype read
  57000ms because it fitted the raw millisecond cycle; snapping both scales to whole steps first — the
  fix below — makes it **57050ms**, since a 4000ms spell is 69 steps (4025ms) and a 15000ms calm is 257
  (14991.67ms). Expect round asks to produce unround passes, and do not round the result back: that
  would put the boundaries back inside steps, which is the whole thing being fixed.
- Without snapping, **5 of 5** gate boundaries landed mid-step, cutting drops to as short as **29ms**
  against a 58.3ms step — which breaks the thing `STEPS`' own comment exists to protect.

## The behaviour change, which is the point

Deriving `STEPS` changes what `flicker({ duration })` renders for any duration other than 1400. Today
a 30000ms pass gets 24 steps of 1250ms each — a 2.4-second strobe, not a flicker. That is a visual
change for existing callers who set a custom duration, and it wants a CHANGELOG line under
`### Changed`, not a silent fix. Callers at the default are byte-identical.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/effects/pieces.ts` | `FlickerSpec.spell`/`.calm`, the derived step count, the gate. `hue` and `chase` are untouched. |
| `packages/core/test/effects/pieces.test.ts` | All new tests, using the file's existing `gainsAcrossOnePass` and `darkRuns` helpers. |
| `CHANGELOG.md` | One `### Added` entry for the spell, one `### Changed` for the derived steps. |
| `README.md:222` | The `flicker` entry gains `spell` and `calm`. |

Nothing else. `FlickerSpec` is already exported from the barrel (`index.ts:47`), so the new fields are
public the moment they exist.

---

### Task 1: Derive the step count from the pass length

`STEPS` is hardcoded 24 against the 1400ms default. Any other duration stretches or squashes the
step, which is why a long pass strobes.

**Files:**
- Modify: `packages/core/src/effects/pieces.ts`
- Test: `packages/core/test/effects/pieces.test.ts`

- [x] **Step 1: Write the failing test**

Append inside the existing `describe('flicker', …)` block:

```ts
  /** Shortest dark stretch in milliseconds, which is what a step length actually means on screen. */
  function shortestDropMs(piece: EffectPiece, samples = 4000): number {
    const runs = darkRuns(gainsAcrossOnePass(piece, part, samples));
    return Math.min(...runs) * (piece.duration / samples);
  }

  // A step is ~58ms so a drop covers about three frames. Holding 24 steps against a long pass turns
  // that into a multi-second strobe, which is a different effect wearing the same name.
  it('holds a step near 58ms however long the pass is', () => {
    // Pinned, not banded: a 40-80ms band admits 1400/25, which moves every frame of every shipped
    // flicker() and leaves this task's whole guarantee resting on a Task 2 constant.
    expect(shortestDropMs(flicker(), 40000)).toBeCloseTo(1400 / 24, 0);
    expect(shortestDropMs(flicker({ duration: 30000 }))).toBeLessThan(80);
  });
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/test/effects/pieces.test.ts -t "holds a step near 58ms"`
Expected: FAIL on the 30000ms case — 24 steps over 30000ms is 1250ms a step, so the received value
is around 1250, not under 80. The two default-duration assertions pass already; that is the point of
including them.

- [x] **Step 3: Derive the count**

In `packages/core/src/effects/pieces.ts`, replace the `STEPS` constant and its doc comment:

```ts
/** One step is ~58ms, so the shortest drop covers about three frames at 60fps; a one-frame drop
 * reads as noise rather than as a failing tube. Derived rather than fixed: 24 steps against a long
 * pass would stretch each one into a multi-second strobe. */
const STEP_MS = 1400 / 24;

function stepsFor(duration: number): number {
  return Math.max(1, Math.round(duration / STEP_MS));
}
```

In `flicker`, take the count once from the resolved duration and use it in `at`:

```ts
  const duration = spec.duration ?? 1400;
  const depth = clamp01(spec.depth ?? 0);
  const unrest = clamp01(spec.unrest ?? 0.18);
  const steps = stepsFor(duration);

  return {
    duration,
    at(t, part) {
      const step = Math.floor(t * steps) % steps;
```

`stepsFor(1400)` is exactly 24, so every caller at the default renders as it did.

- [x] **Step 4: Run the test**

Run: `npx vitest run packages/core/test/effects/pieces.test.ts`
Expected: PASS, including the file's existing `flicker` cases.

- [x] **Step 5: Confirm the default really did not move**

Run: `npx vitest run packages/core/test/effects/roving.test.ts`
Expected: PASS. `roving.test.ts:104` builds `flicker({ duration: 900 })` and asserts the wrapper's
duration is a whole multiple of 900 — `stepsFor` does not touch `duration`, so this holds. If it
fails, something changed the pass length, which this task must not do.

- [x] **Step 6: Commit**

```bash
git add packages/core/src/effects/pieces.ts packages/core/test/effects/pieces.test.ts
git commit -m "derive a flicker step from its pass rather than fixing it at 24"
```

---

### Task 2: The spell and the calm

**Files:**
- Modify: `packages/core/src/effects/pieces.ts`
- Test: `packages/core/test/effects/pieces.test.ts`

- [x] **Step 1: Write the failing test**

Append inside `describe('flicker', …)`:

```ts
  /** Longest continuously-lit stretch in milliseconds — the calm, when there is one. */
  function longestCalmMs(piece: EffectPiece, samples = 4000): number {
    const gains = gainsAcrossOnePass(piece, part, samples);
    let best = 0;
    let run = 0;
    for (const g of gains) {
      if (g >= 0.5) {
        run++;
        best = Math.max(best, run);
      } else run = 0;
    }
    return best * (piece.duration / samples);
  }

  it('leaves the pass alone when no calm is asked for', () => {
    expect(flicker({ spell: 4000 }).duration).toBe(1400);
    expect(gainsAcrossOnePass(flicker({ spell: 4000 }))).toEqual(gainsAcrossOnePass(flicker()));
  });

  // 4000ms is 69 steps and 15000ms is 257, so a cycle is 326 steps and three of them fit 60s.
  it('fits the pass to a whole number of spells', () => {
    expect(flicker({ duration: 60000, spell: 4000, calm: 15000 }).duration).toBe(57050);
  });

  // The tube goes quiet for the calm, which is the whole point of the macro scale.
  it('holds the tube lit for the calm between spells', () => {
    const piece = flicker({ duration: 60000, spell: 4000, calm: 15000 });
    expect(longestCalmMs(piece)).toBeGreaterThan(13000);
    expect(longestCalmMs(piece)).toBeLessThan(17000);
  });

  // A gate boundary landing mid-step clips a drop to a single frame, which reads as noise rather
  // than as a failing tube — the thing the step length exists to prevent.
  it('lands every gate boundary on a step edge', () => {
    const piece = flicker({ duration: 60000, spell: 4000, calm: 15000 });
    expect(shortestDropMs(piece, 20000)).toBeGreaterThan(40);
  });

  it('still stutters inside a spell', () => {
    const piece = flicker({ duration: 60000, spell: 4000, calm: 15000 });
    expect(darkRuns(gainsAcrossOnePass(piece, part, 4000)).length).toBeGreaterThan(15);
  });

  // The gate and the stutter share one clock, so each bout samples a different stretch of the hash.
  // A second clock — or a step index that restarts per bout — makes every bout identical instead.
  // The sample count must not be a multiple of the pass's step count: sampling on the step grid
  // lands every third sample on an edge, where float residue alone makes identical bouts compare
  // unequal and the test stops seeing the defect.
  it('gives each spell its own stutter rather than repeating one', () => {
    const piece = flicker({ duration: 60000, spell: 4000, calm: 15000 });
    const gains = gainsAcrossOnePass(piece, part, 2937);
    const third = gains.length / 3;
    const drops = (from: number) => gains.slice(from, from + third).filter((g) => g < 1);
    expect(drops(0).length).toBeGreaterThan(20);
    expect(drops(0)).not.toEqual(drops(third));
  });

  // cycles rounds rather than floors, so a pass that is nearer three bouts than two gets three.
  it('rounds the pass to the nearest whole number of spells rather than down', () => {
    expect(flicker({ duration: 50000, spell: 4000, calm: 15000 }).duration).toBe(57050);
  });
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/test/effects/pieces.test.ts -t "flicker"`
Expected: FAIL. `spell`/`calm` are not in `FlickerSpec`, so TypeScript rejects the literals; vitest
transpiles without typechecking, so at runtime the extra keys are ignored and the failures are value
mismatches — `duration` 60000 rather than 57000, and no calm stretch. Both are the right failure.

- [x] **Step 3: Add the fields**

In `FlickerSpec`, below `unrest`:

```ts
  /** Milliseconds of one flickering bout. Needs a `calm`, and both must exceed one step. */
  spell?: number;
  /** Milliseconds held steady between bouts. Needs a `spell`, and lengthens the pass to fit whole
   * cycles of the two. 0, the default, flickers throughout. */
  calm?: number;
```

- [x] **Step 4: Fit the pass and gate the stutter**

Replace `flicker`'s body:

```ts
export function flicker(spec: FlickerSpec = {}): EffectPiece {
  const depth = clamp01(spec.depth ?? 0);
  const unrest = clamp01(spec.unrest ?? 0.18);
  const wanted = spec.duration ?? 1400;
  const calm = Math.max(0, spec.calm ?? 0);
  const spell = Math.max(0, spec.spell ?? 0);

  // Both scales snap to whole steps, which is what puts every gate boundary on a step edge: a
  // boundary inside a step clips that drop to a frame or two and it reads as noise.
  const spellSteps = Math.round(spell / STEP_MS);
  const calmSteps = Math.round(calm / STEP_MS);
  const gated = spellSteps > 0 && calmSteps > 0;
  const cycleSteps = spellSteps + calmSteps;
  const cycles = gated ? Math.max(1, Math.round(wanted / (cycleSteps * STEP_MS))) : 1;
  const duration = gated ? cycles * cycleSteps * STEP_MS : wanted;
  const steps = stepsFor(duration);
  const spellShare = spellSteps / cycleSteps;

  return {
    duration,
    at(t, part) {
      if (gated && ((t * cycles) % 1) >= spellShare) return { gain: 1 };
      const step = Math.floor(t * steps) % steps;
      if (hash01(step + part.index * 977.3) > unrest) return { gain: 1 };
      const bite = hash01(step * 3.7 + part.index * 131.1);
      return { gain: depth + (1 - depth) * bite * BITE };
    },
  };
}
```

Biome rejects the redundant parens in `((t * cycles) % 1) >= spellShare` — write it as
`(t * cycles) % 1 >= spellShare`, which `%` binding tighter than `>=` makes identical.

**Both scales must be real for the gate to engage, and neither gets invented.** An earlier draft read
`Math.max(1, Math.round(spell / STEP_MS))`, which conjured a one-step spell for a caller who named
none: `flicker({ calm: 15000 })` then returned a 15050ms pass — ten times the default — in which 11 of
12 tubes never dropped once. It also made `spell: NaN` poison every gain for the life of the piece,
since `Math.max(1, NaN)` is `NaN`. Requiring both step counts above zero closes both: `NaN > 0` is
false, so a bad value leaves the piece ungated at its asked-for duration rather than silently
reshaping it.

`steps` needs no branch. On the gated path `duration` is `cycles * cycleSteps * STEP_MS`, so
`stepsFor(duration)` returns exactly `cycles * cycleSteps` — verified across ~730 spec combinations
with zero mismatches. One definition of "steps" is one thing a reader need not reconcile.

`spellShare` rather than `duty`: `unrest` is already documented as a share of the pass, and a second
unexplained share in PWM vocabulary reads as a different quantity than it is.

The step index runs across the whole pass rather than restarting per spell, so each spell samples a
different stretch of the hash and no two bouts are identical. That is the resonance `roving`'s comment
warns about, avoided by construction rather than by arithmetic.

- [x] **Step 5: Run the tests**

Run: `npx vitest run packages/core/test/effects/pieces.test.ts`
Expected: PASS, all five new cases and every existing one.

- [x] **Step 5b: Prove the resonance test is load-bearing**

This is the one that guards the plan's central argument, and a review found that without it the
defect passes the whole suite. Temporarily restart the step index per bout on the gated path:

```ts
      const step = gated
        ? Math.floor(((t * cycles) % 1) * cycleSteps) % cycleSteps
        : Math.floor(t * steps) % steps;
```

Run: `npx vitest run packages/core/test/effects/pieces.test.ts`
Expected: FAIL on `gives each spell its own stutter` **and on that alone** — the duration stays
57050, the calm stays ~15167ms and the shortest drop stays 57.05ms, which is exactly why the rest of
the suite cannot see it. Restore and confirm green. Quote both outputs.

The first version of this test sampled 2934 times — three per step across 978 steps — and **passed
against the mutation**. On the step grid, bout 2's `(t * cycles) % 1` computes `1 + k/978` and
subtracts back to a hair under it, so `floor` returns one step lower at 16 of 978 samples: enough for
`.not.toEqual` while the bouts were byte-identical. Verified at 2937 and 3000, both of which
discriminate; the filter to drops removes the ~771 gate-held `1`s per bout that carry no information,
and the `> 20` guard stops the comparison passing vacuously if both sides come back empty.

- [x] **Step 6: Prove the snapping is load-bearing**

Temporarily replace `const spellSteps = Math.max(1, Math.round(spell / STEP_MS));` with
`const spellSteps = spell / STEP_MS;` — the unsnapped version.

Run: `npx vitest run packages/core/test/effects/pieces.test.ts -t "step edge"`
Expected: FAIL, with a shortest drop well under 40ms. The prototype measured 29ms this way. Restore
the snapped line and confirm the test passes again. **Quote both outputs in your report** — a test
that has never been red against the defect it names is not evidence.

- [x] **Step 7: Run everything**

Run: `npm run check`
Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add packages/core/src/effects/pieces.ts packages/core/test/effects/pieces.test.ts
git commit -m "give flicker a spell and a calm on top of its stutter"
```

---

### Task 3: Document it

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [x] **Step 1: Write the CHANGELOG entry**

Look at the top of the file first — the last three releases use a narrative headline section with a
prose paragraph rather than bare bullets, and the file has **no code fences anywhere in its history**,
so an example goes in an inline span. Match that. Under `## Unreleased`, or a new one if it is absent:

```markdown
### A flickering tube can now rest

`flicker` gained `spell` and `calm`: the milliseconds of one flickering bout, and the milliseconds it
holds steady between them. `EFFECTS.flicker({ duration: 60000, spell: 4000, calm: 15000 })` stutters
for four seconds, sits quiet for fifteen, and does it three times a minute. The pass length adjusts to
fit whole bouts, the way `roving` already rounds its epochs, so the asked-for 60s becomes 57.05s.
`calm` defaults to 0, which flickers for the whole pass exactly as before.

### Changed

- A `flicker` step is now derived from the pass rather than fixed at 24 a pass, holding it near 58ms —
  about three frames, which is what keeps a drop reading as a failing tube. `flicker()` at the default
  1400ms duration is unchanged; a custom `duration` renders differently, and a long one no longer
  strobes.
```

- [x] **Step 1b: Document two surprises Task 2 measured**

Both are the arithmetic behaving as designed and neither is derivable from the field docs as written.
One line each, on the fields themselves:

- **Both scales must be real.** Either one under half a step rounds to zero and leaves the piece
  ungated, flickering for the whole pass at its asked-for duration. Symmetric, and the right
  behaviour — say that a spell or a calm shorter than one step is neither.
- **The pass becomes the nearest whole number of cycles, up or down.** `flicker({ spell: 4000, calm:
  15000 })` at the default 1400ms returns **19016.67ms** — one whole cycle, thirteen times what was
  asked, because `cycles` floors at 1. It shrinks too: 60000 asked returns 57050.
  **`FlickerSpec.duration` has no docstring at all** — this is the first one, not an amendment.

- [x] **Step 2: Update the README**

`README.md:222` documents `flicker`. Widen it to name `spell` and `calm` and say the pass fits whole
bouts. Keep it proportionate to the `hue` and `chase` entries beside it — they are one paragraph each,
and the section carries one shared example block at the top rather than an example per piece.

- [x] **Step 3: Check the README name list still holds**

Run: `npx vitest run packages/core/test/readme.test.ts`
Expected: PASS. That test asserts the names the README tells people to import; `flicker` is already in
it, and `spell`/`calm` are spec fields rather than exports, so nothing new is needed. It does **not**
extract or compile code from the README, so it does not check your prose — verify any example
yourself.

- [x] **Step 4: Run everything**

Run: `npm run check`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add CHANGELOG.md README.md
git commit -m "document the flicker spell and the derived step"
```

---

## Not in this plan

- **A general `intermittent(inner)` wrapper** for `roving` or `hue`. Wanted eventually, and it must
  derive its period from `inner.duration` rather than accept one — see the note at the top on why.
- **`STEP_MS` as a caller-facing knob.** It is a perceptual constant tied to frame rate, not a
  setting.
- **A composition lab** to plot pieces against time. Its own design, and the thing that would have
  caught this class of bug without a spike.
