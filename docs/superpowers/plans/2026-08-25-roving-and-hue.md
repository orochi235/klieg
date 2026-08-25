# Roving faults and hue cycling — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two effect pieces to klieg's shipped effects pipeline — `hue`, a luminance-holding colour
sweep, and `roving`, a wrapper that moves any inner piece's affliction from one tube to another.

**Architecture:** `hue` is an ordinary leaf piece: it writes `PartOffset.color` and nothing else, and
the pipeline already carries that channel end to end. `roving` composes at the *piece* level rather
than the offset level — it takes another `EffectPiece`, returns rest for every part except the one
currently holding the fault, and delegates to the inner piece for that one. Its `duration` spans
several dwells so a wrapper can vary on a slower clock than the piece it wraps, which `at(t, part)`
alone cannot express.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), vitest for units, Playwright for
visual baselines, three.js for the render path. Biome for lint.

**Read first:** [the design](../specs/2026-08-25-roving-and-hue-design.md) and its parent,
[the effects pipeline design](../specs/2026-08-24-effects-pipeline-design.md) — specifically its
`## Two limits found by asking for a roving fault` section, which this plan is the answer to.

---

## Decisions settled since the design was written

The design's `## Not decided` section is now decided. Task 8 writes these back into the spec.

- **`roving` is factory-only; `hue` gets a name.** `EffectName` becomes `'flicker' | 'hue'` and
  `EFFECTS` gains `hue`. `EffectSpec` does **not** gain a per-piece parameter field — a wrapper takes
  another piece, which no name can express, so `roving` is reachable only as
  `piece: roving(flicker())`. The per-piece-parameter question stays open, deliberately.
- **`hue` sweeps the whole wheel by default, and an arc is expressible.** `HueSpec` carries `from` and
  `span` in turns, defaulting to `0` and `1`.
- **`dwell` ships a stated-provisional default of 3200ms.** The design asked for it to be measured in
  the lab; the lab work is not built and no shipped look declares `roving`, so nothing depends on the
  number. It is labelled provisional in the spec.

## What a prototype settled before this plan was written

The epoch arithmetic was prototyped and measured rather than reasoned about, and the first attempt at
it was wrong in a way that looked completely reasonable on the page. All three findings are load-
bearing; Task 8 writes them into the spec.

- **The dwell must NOT snap to a whole number of inner passes.** Making every epoch boundary land on
  an inner-pass boundary is tempting — it tiles both clocks — and it silently destroys the effect.
  Every handover then samples the inner piece at the same phase, and `flicker`'s rest at a fixed
  phase is a per-index constant: once the fault lands on an index that is mid-stutter at phase 0, the
  deferral blocks every future handover and the fault sticks **forever**. Measured: 1 distinct holder
  per pass, 0 handovers. The dwell stays raw and the boundary phase varies, which is what the design
  said.
- **The wrapper's duration is a multiple of `inner.duration`, and an effective dwell divides that
  duration evenly.** Rounding only the duration leaves a partial last epoch. Deriving `epoch =
  duration / epochs` after the fact gives whole epochs *and* varying boundary phases. At the defaults
  this is a 25200ms pass of 8 epochs at 3150ms, with 4 distinct boundary phases — measured at 4
  distinct holders and 6 handovers per pass.
- **A deferred handover waits a whole epoch, not part of one.** The design says the outgoing part
  keeps the fault "until it is at rest". Resolving that mid-epoch makes the holder a function of a
  search over continuous time. Retrying at the next boundary keeps the holder constant within an
  epoch, which is what makes "exactly one holder at every sample" testable at all.
- **The holder chain is walked twice over the pass, not once.** `t` is normalized within a pass, so
  the chain has to start somewhere; starting fresh each pass makes the loop seam the one undeferred
  handover. Walking the eight epochs twice and answering on the second lap starts the real walk from
  where the previous pass left the fault, so the seam is an ordinary deferred boundary. Sixteen
  iterations, bounded, no lookback constant needed.

## File structure

| file | responsibility |
|---|---|
| `packages/core/src/effects/compositor.ts` | **modify** — gains `isRest`, the predicate `roving` asks the inner piece about |
| `packages/core/src/effects/luminance.ts` | **create** — Rec.709 luma, and a hue packed to hold it. Separate from the piece so the colour maths is testable without a clock |
| `packages/core/src/effects/pieces.ts` | **modify** — gains `hue` and `HueSpec`; `EFFECTS` gains the name |
| `packages/core/src/effects/roving.ts` | **create** — the wrapper. Its own file: it is the only piece with epoch arithmetic, and it is not a member of the name registry |
| `packages/core/src/effects/types.ts` | **modify** — `EffectName` gains `'hue'` |
| `packages/core/src/index.ts` | **modify** — public exports |
| `packages/core/test/effects/compositor.test.ts` | **modify** — `isRest` cases |
| `packages/core/test/effects/luminance.test.ts` | **create** |
| `packages/core/test/effects/pieces.test.ts` | **modify** — a `hue` describe block |
| `packages/core/test/effects/roving.test.ts` | **create** |
| `apps/lab/index.html`, `apps/lab/src/main.ts` | **modify** — two checkboxes so the pieces can be seen |
| `apps/lab/test/looks.spec.ts` | **modify** — two pinned visual baselines |
| `README.md` | **modify** — the effects pipeline has no public documentation at all; this adds it |
| `docs/superpowers/specs/2026-08-25-roving-and-hue-design.md` | **modify** — resolve the open questions, record the refinements and the traps found |
| `docs/superpowers/HANDOFF.md` | **modify** |

---

### Task 1: `isRest`, the predicate a wrapper asks about an inner piece

`roving` has to ask "is this part currently contributing anything?" without knowing what piece it
wraps. `REST_OFFSET` already states what rest *is* for a resolved offset; this is the same statement
as a predicate over the unresolved `PartOffset` a piece returns.

**Files:**
- Modify: `packages/core/src/effects/compositor.ts`
- Test: `packages/core/test/effects/compositor.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/effects/compositor.test.ts`. Add `isRest` to the existing import from
`../../src/effects/compositor.js`, and `PartOffset` to the existing type import from
`../../src/effects/types.js` if it is not already there.

```ts
describe('isRest', () => {
  it('calls an empty offset rest, which is what a piece with nothing to say returns', () => {
    expect(isRest({})).toBe(true);
  });

  it('calls every channel at its identity rest', () => {
    expect(
      isRest({ gain: 1, scale: 1, dark: 0, crawl: 0, position: [0, 0, 0], rotation: [0, 0, 0] }),
    ).toBe(true);
  });

  it('calls any channel off its identity not rest', () => {
    expect(isRest({ gain: 0.5 })).toBe(false);
    expect(isRest({ scale: 1.2 })).toBe(false);
    expect(isRest({ dark: 0.1 })).toBe(false);
    expect(isRest({ crawl: 0.01 })).toBe(false);
    expect(isRest({ position: [0, 0.01, 0] })).toBe(false);
    expect(isRest({ rotation: [0, 0, 0.01] })).toBe(false);
  });

  // A colour is a replacement, not a contribution, so there is no value of it that is "no change" —
  // any colour at all is something a handover would snap away from.
  it('calls a written colour not rest, at any value', () => {
    expect(isRest({ color: 0x000000 })).toBe(false);
    expect(isRest({ color: 0xffffff })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/core/test/effects/compositor.test.ts`
Expected: FAIL — `isRest is not a function` / a TypeScript import error naming `isRest`.

- [ ] **Step 3: Write the implementation**

Append to `packages/core/src/effects/compositor.ts`:

```ts
/** Whether a piece is contributing nothing on this part — every channel it wrote at its identity. */
export function isRest(o: PartOffset): boolean {
  if (o.gain !== undefined && o.gain !== 1) return false;
  if (o.scale !== undefined && o.scale !== 1) return false;
  if (o.dark) return false;
  if (o.crawl) return false;
  if (o.color !== undefined) return false;
  if (o.position?.some((n) => n !== 0)) return false;
  if (o.rotation?.some((n) => n !== 0)) return false;
  return true;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/core/test/effects/compositor.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Verify by mutation**

Change `if (o.color !== undefined) return false;` to `if (false) return false;` and re-run. Expected:
the "calls a written colour not rest" case fails. Restore the line. A test that passes with the code
under it deleted is testing nothing — this branch is the one a reader is most likely to think is
redundant, so it is the one worth proving.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/effects/compositor.ts packages/core/test/effects/compositor.test.ts
git commit -m "ask an offset whether it is at rest"
```

---

### Task 2: hue at a held luminance

Hue at constant HSL lightness has wildly varying Rec.709 luminance — 0.93 at yellow against 0.07 at
blue — and the bloom pass thresholds on exactly that dot product (`packages/core/src/render/bloom.ts`,
the `threshold` shader: `dot(c.rgb, vec3(0.2126, 0.7152, 0.0722))`). A naive sweep therefore brightens
through yellow and drops out of bloom entirely through blue, which reads as a bug rather than as a
throb. This module holds the luma fixed and pays for it in saturation.

**Files:**
- Create: `packages/core/src/effects/luminance.ts`
- Test: `packages/core/test/effects/luminance.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/effects/luminance.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hueColor, luma } from '../../src/effects/luminance.js';

/** How far a packed colour's luma may sit from the target: 8-bit rounding, three channels. */
const TOLERANCE = 0.005;

const SAMPLES = 360;

function lumaOfHex(hex: number): number {
  return luma(((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255);
}

describe('luma', () => {
  it('is the Rec.709 dot product the bloom threshold reads', () => {
    expect(luma(1, 1, 1)).toBeCloseTo(1, 10);
    expect(luma(0, 0, 0)).toBeCloseTo(0, 10);
    expect(luma(0, 1, 0)).toBeCloseTo(0.7152, 10);
    expect(luma(0, 0, 1)).toBeCloseTo(0.0722, 10);
  });
});

describe('hueColor', () => {
  it('holds its target luma all the way round the wheel', () => {
    for (let n = 0; n < SAMPLES; n++) {
      expect(lumaOfHex(hueColor(n / SAMPLES, 0.5))).toBeCloseTo(0.5, 2);
    }
  });

  it('holds a bright target too, where every hue but yellow needs whitening', () => {
    for (let n = 0; n < SAMPLES; n++) {
      expect(Math.abs(lumaOfHex(hueColor(n / SAMPLES, 0.8)) - 0.8)).toBeLessThan(TOLERANCE);
    }
  });

  it('wraps, so a sweep past 1 turn is continuous', () => {
    expect(hueColor(1.25, 0.5)).toBe(hueColor(0.25, 0.5));
    expect(hueColor(-0.75, 0.5)).toBe(hueColor(0.25, 0.5));
  });

  it('actually travels: a wheel of samples is many distinct colours, not one', () => {
    const seen = new Set(Array.from({ length: SAMPLES }, (_, n) => hueColor(n / SAMPLES, 0.5)));
    expect(seen.size).toBeGreaterThan(SAMPLES * 0.8);
  });

  // The trade the module exists to make: a hue darker than the target gives up saturation, and
  // blue is the darkest hue there is. Asserted as a channel floor rather than by eye.
  it('pales a blue up to a bright target rather than leaving it dark', () => {
    const blue = hueColor(2 / 3, 0.8);
    expect(blue & 0xff).toBeGreaterThan(200);
    expect((blue >> 16) & 0xff).toBeGreaterThan(120);
  });

  it('keeps a red saturated at a target it already clears', () => {
    const red = hueColor(0, 0.2);
    expect((red >> 16) & 0xff).toBeGreaterThan(200);
    expect((red >> 8) & 0xff).toBeLessThan(20);
  });

  it('stays inside 24 bits at either extreme of the target', () => {
    for (const target of [0, 1]) {
      for (let n = 0; n < 24; n++) {
        const hex = hueColor(n / 24, target);
        expect(hex).toBeGreaterThanOrEqual(0);
        expect(hex).toBeLessThanOrEqual(0xffffff);
      }
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/core/test/effects/luminance.test.ts`
Expected: FAIL — cannot resolve `../../src/effects/luminance.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/effects/luminance.ts`:

```ts
/** Rec.709 luma, the same dot product `bloom.ts` thresholds on. */
export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Fully saturated RGB for a hue in turns. */
function wheel(turn: number): [number, number, number] {
  const h = (((turn % 1) + 1) % 1) * 6;
  const x = 1 - Math.abs((h % 2) - 1);
  if (h < 1) return [1, x, 0];
  if (h < 2) return [x, 1, 0];
  if (h < 3) return [0, 1, x];
  if (h < 4) return [0, x, 1];
  if (h < 5) return [x, 0, 1];
  return [1, 0, x];
}

function channel(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n * 255)));
}

/**
 * A hue in turns at a fixed Rec.709 luma, packed 0xRRGGBB. A hue brighter than the target scales
 * toward black and keeps its saturation; one darker mixes toward white, which is why blues and
 * violets come out pale. Holding luma is what keeps a sweep on one side of the bloom threshold
 * the whole way round instead of dropping out through the dark half of the wheel.
 */
export function hueColor(turn: number, target: number): number {
  const [r, g, b] = wheel(turn);
  const y = luma(r, g, b);
  const [nr, ng, nb] =
    y >= target
      ? ((k) => [r * k, g * k, b * k] as const)(y > 0 ? target / y : 0)
      : ((k) => [r + (1 - r) * k, g + (1 - g) * k, b + (1 - b) * k] as const)(
          (target - y) / (1 - y),
        );
  return (channel(nr) << 16) | (channel(ng) << 8) | channel(nb);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/core/test/effects/luminance.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Verify by mutation**

Replace the whole conditional in `hueColor` with the plain saturated wheel — `const [nr, ng, nb] = [r,
g, b];` — and re-run. Expected: both "holds its target luma" cases fail, and the pale-blue case fails.
If any of them still passes, the tolerance is doing the work rather than the code. Restore.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add packages/core/src/effects/luminance.ts packages/core/test/effects/luminance.test.ts
git commit -m "hold Rec.709 luma across a hue wheel"
```

---

### Task 3: the `hue` piece

A piece that ignores `part` is a synchronized sweep; one that offsets by `part.at` — the arc-length
share the pool already computed — is a gradient travelling along the word. Same function, one term.

**Files:**
- Modify: `packages/core/src/effects/types.ts` (the `EffectName` union)
- Modify: `packages/core/src/effects/pieces.ts`
- Test: `packages/core/test/effects/pieces.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/core/test/effects/pieces.test.ts`, change the import of the module under test to:

```ts
import { EFFECTS, flicker, hue } from '../../src/effects/pieces.js';
```

and append this describe block at the end of the file:

```ts
describe('hue', () => {
  it('writes only colour, leaving gain to another layer', () => {
    expect(Object.keys(hue().at(0.5, part))).toEqual(['color']);
  });

  it('travels the whole wheel by default, and is seamless across the loop', () => {
    const piece = hue();
    const seen = new Set(
      Array.from({ length: 120 }, (_, n) => piece.at(n / 120, part).color as number),
    );
    expect(seen.size).toBeGreaterThan(90);
    // span defaults to a whole turn, so the end of a pass is the start of the next one.
    expect(piece.at(1, part).color).toBe(piece.at(0, part).color);
  });

  it('takes an arc, so a look can throb rather than cycle', () => {
    const piece = hue({ from: 0.5, span: 0.1 });
    const wide = hue();
    const spread = (p: typeof piece) => {
      const hexes = Array.from({ length: 60 }, (_, n) => p.at(n / 60, part).color as number);
      return new Set(hexes.map((h) => (h >> 16) & 0xff)).size;
    };
    expect(spread(piece)).toBeLessThan(spread(wide));
    expect(piece.at(0, part).color).toBe(hue({ from: 0.5, span: 1 }).at(0, part).color);
  });

  it('gives every part the same colour when unspread, which is one sign changing together', () => {
    const piece = hue();
    expect(piece.at(0.3, { ...part, index: 0, at: 0 }).color).toBe(
      piece.at(0.3, { ...part, index: 3, at: 0.75 }).color,
    );
  });

  it('offsets by arc-length share when spread, which is a gradient down the word', () => {
    const piece = hue({ spread: 0.5 });
    expect(piece.at(0.3, { ...part, at: 0 }).color).not.toBe(
      piece.at(0.3, { ...part, at: 0.75 }).color,
    );
    // The offset is in turns, so a part three quarters along at spread 0.5 reads the same hue the
    // whole sign reads 0.375 turns later.
    expect(piece.at(0, { ...part, at: 0.75 }).color).toBe(piece.at(0.375, { ...part, at: 0 }).color);
  });

  it('is deterministic in t, across separately built pieces', () => {
    const of = (p: EffectPiece) =>
      Array.from({ length: 50 }, (_, n) => p.at(n / 50, part).color as number);
    expect(of(hue())).toEqual(of(hue()));
  });

  it('is reachable by name', () => {
    expect(typeof EFFECTS.hue).toBe('function');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/core/test/effects/pieces.test.ts`
Expected: FAIL — `hue` is not exported from `pieces.js`, and `EFFECTS.hue` is undefined.

- [ ] **Step 3: Widen `EffectName`**

In `packages/core/src/effects/types.ts`, change:

```ts
export type EffectName = 'flicker';
```

to:

```ts
export type EffectName = 'flicker' | 'hue';
```

- [ ] **Step 4: Write the piece**

In `packages/core/src/effects/pieces.ts`, add the import at the top:

```ts
import { hueColor } from './luminance.js';
```

and append, above the `EFFECTS` declaration:

```ts
export interface HueSpec {
  duration?: number;
  /** Where the sweep starts, in turns. */
  from?: number;
  /** How far it travels in one pass, in turns. 1 is the whole wheel, and the only value that
   * meets itself at the loop seam — any other snaps back there. */
  span?: number;
  /** Hue offset across the word, in turns per unit of `part.at`. 0 is one synchronized sign. */
  spread?: number;
  /** Rec.709 luma the sweep holds. 0.5 is where the wheel's darkest and brightest hues give up
   * the same amount — blue's saturation against yellow's brightness. */
  luminance?: number;
}

/** A sign that changes colour, at a luma the bloom threshold sees the same all the way round. */
export function hue(spec: HueSpec = {}): EffectPiece {
  const duration = spec.duration ?? 6000;
  const from = spec.from ?? 0;
  const span = spec.span ?? 1;
  const spread = spec.spread ?? 0;
  const luminance = clamp01(spec.luminance ?? 0.5);

  return {
    duration,
    at(t, part) {
      return { color: hueColor(from + t * span + part.at * spread, luminance) };
    },
  };
}
```

Then change the registry line to:

```ts
export const EFFECTS = { flicker, hue } satisfies Record<EffectName, () => EffectPiece>;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/core/test/effects/pieces.test.ts`
Expected: PASS — 9 existing `flicker` cases plus 7 new `hue` cases.

- [ ] **Step 6: Verify by mutation**

Change `part.at * spread` to `part.index * spread` and re-run. Expected: the arc-length case fails on
its second assertion. This is the mutation that matters — `index` and `at` correlate, so a test
comparing only "different parts differ" would pass with the wrong term in place.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add packages/core/src/effects/pieces.ts packages/core/src/effects/types.ts packages/core/test/effects/pieces.test.ts
git commit -m "add a hue piece that holds luminance across the wheel"
```

---

### Task 4: the `roving` wrapper

The mechanics, all three of them, in one place:

- **Epochs come from `t`.** A piece sees only `t` normalized within its own pass, so a wrapper varying
  on a slower clock has to span it. The wrapper's `duration` is a whole multiple of `inner.duration`
  covering roughly `EPOCHS` dwells, and the effective epoch is that duration divided evenly by the
  epoch count — whole epochs, and a boundary phase that moves through the inner's cycle. Read the
  first bullet of "What a prototype settled" before changing any of this arithmetic.
- **The holder** is `hash01` of the epoch against `part.count`, resolved inside `at()` because the
  pool count is not known when the wrapper is built.
- **The handover is deferred.** At a boundary the wrapper asks the inner piece what the *outgoing*
  part is doing at that boundary's phase; if that is not rest, the outgoing part keeps the fault for
  another epoch. Without this a jump can land mid-drop and snap a tube to full brightness in one
  frame.

**Files:**
- Create: `packages/core/src/effects/roving.ts`
- Test: `packages/core/test/effects/roving.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/effects/roving.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { flicker } from '../../src/effects/pieces.js';
import { roving } from '../../src/effects/roving.js';
import type { EffectPiece, PartInfo } from '../../src/effects/types.js';

const COUNT = 6;

function partAt(index: number): PartInfo {
  return {
    kind: 'run',
    index,
    count: COUNT,
    letter: { index: 0, count: 1 },
    x: 0,
    y: 0,
    at: index / COUNT,
    span: 1 / COUNT,
  };
}

const PARTS = Array.from({ length: COUNT }, (_, i) => partAt(i));

/** Which part indices are contributing anything at `t`. */
function afflicted(piece: EffectPiece, t: number): number[] {
  return PARTS.filter((p) => Object.keys(piece.at(t, p)).length > 0).map((p) => p.index);
}

/** A piece that is never at rest, so a deferred handover can never resolve. */
const STUCK: EffectPiece = { duration: 100, at: () => ({ gain: 0.1 }) };

const SAMPLES = 500;

describe('roving', () => {
  it('afflicts exactly one part at every sample of a whole pass', () => {
    const piece = roving(flicker());
    for (let n = 0; n < SAMPLES; n++) {
      expect(afflicted(piece, n / SAMPLES)).toHaveLength(1);
    }
  });

  it('returns a bare no-contribution offset for every part but the holder', () => {
    const piece = roving(flicker());
    const holder = afflicted(piece, 0.5)[0] as number;
    for (const p of PARTS) {
      if (p.index === holder) continue;
      expect(piece.at(0.5, p)).toEqual({});
    }
  });

  it('delegates the holder to the inner piece rather than inventing an offset', () => {
    const marker: EffectPiece = { duration: 100, at: () => ({ gain: 0.5, scale: 1.25 }) };
    const piece = roving(marker);
    const holder = afflicted(piece, 0.5)[0] as number;
    expect(piece.at(0.5, partAt(holder))).toEqual({ gain: 0.5, scale: 1.25 });
  });

  // Measured at 4 distinct holders over a default pass against a pool of 6. This is the assertion
  // that catches the arithmetic failure the prototype found: a dwell snapped to whole inner passes
  // samples the inner at one fixed phase, `flicker`'s rest there is a per-index constant, and the
  // fault sticks on the first index that blocks its own handover — one holder, forever.
  it('moves the fault: a whole pass visits more than one part', () => {
    const piece = roving(flicker());
    const holders = new Set(
      Array.from({ length: SAMPLES }, (_, n) => afflicted(piece, n / SAMPLES)[0] as number),
    );
    expect(holders.size).toBeGreaterThan(2);
  });

  it('holds a part for a stretch rather than jumping every frame', () => {
    const piece = roving(flicker());
    let changes = 0;
    let prev = afflicted(piece, 0)[0];
    for (let n = 1; n < SAMPLES; n++) {
      const now = afflicted(piece, n / SAMPLES)[0];
      if (now !== prev) changes++;
      prev = now;
    }
    // Eight epochs to a pass, so at most eight handovers, and deferral only ever removes some.
    expect(changes).toBeGreaterThan(0);
    expect(changes).toBeLessThanOrEqual(8);
  });

  it('is deterministic in t, across separately built wrappers', () => {
    const of = (p: EffectPiece) =>
      Array.from({ length: 200 }, (_, n) => afflicted(p, n / 200)[0] as number);
    expect(of(roving(flicker()))).toEqual(of(roving(flicker())));
  });

  it('takes a seed that changes which part is afflicted when', () => {
    const of = (seed: number) =>
      Array.from(
        { length: 200 },
        (_, n) => afflicted(roving(flicker(), { seed }), n / 200)[0] as number,
      );
    expect(of(1)).not.toEqual(of(2));
  });

  it('spans several inner passes, so the choice of tube changes far more slowly', () => {
    const inner = flicker();
    const piece = roving(inner);
    expect(piece.duration).toBeGreaterThan(inner.duration * 4);
  });

  it('makes its duration a whole multiple of the inner pass, so the loop seam is continuous', () => {
    expect(roving(flicker({ duration: 900 }), { dwell: 2500 }).duration % 900).toBe(0);
    expect(roving(flicker(), { dwell: 3200 }).duration % 1400).toBe(0);
  });

  // The deferral, stated as behaviour rather than as arithmetic: an inner piece that never rests
  // never lets the fault go, and one that always rests hands it over on schedule.
  it('defers the handover while the outgoing part is not at rest', () => {
    const piece = roving(STUCK);
    const holders = new Set(
      Array.from({ length: SAMPLES }, (_, n) => afflicted(piece, n / SAMPLES)[0] as number),
    );
    expect(holders.size).toBe(1);
  });

  it('still afflicts exactly one part when the inner piece never rests', () => {
    const piece = roving(STUCK);
    for (let n = 0; n < 100; n++) {
      expect(afflicted(piece, n / 100)).toHaveLength(1);
    }
  });

  // The pool count reaches the wrapper through `part`, not through its spec, so the per-frame memo
  // is keyed on it. Without that key a pool of one reads back a holder resolved against a pool of
  // six at the same `t` — the answer is silently wrong rather than an error, so the sequence here
  // is the test: ask with six parts first, then with one, at the same `t`.
  it('survives a single-part pool, even right after a larger one at the same t', () => {
    const piece = roving(flicker());
    afflicted(piece, 0.5);
    const one: PartInfo = { ...partAt(0), count: 1 };
    expect(piece.at(0.5, one).gain).toBeTypeOf('number');
  });

  it('survives an inner piece with no duration', () => {
    const instant: EffectPiece = { duration: 0, at: () => ({ gain: 0.2 }) };
    const piece = roving(instant);
    expect(piece.duration).toBeGreaterThan(0);
    expect(afflicted(piece, 0.5)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/core/test/effects/roving.test.ts`
Expected: FAIL — cannot resolve `../../src/effects/roving.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/effects/roving.ts`:

```ts
import { hash01 } from '../motion/types.js';
import { isRest } from './compositor.js';
import type { EffectPiece, PartInfo, PartOffset } from './types.js';

export interface RovingSpec {
  /** Roughly how long one part holds the fault, in milliseconds. Adjusted so a whole number of
   * epochs fills a pass. */
  dwell?: number;
  /** Fixes which part is afflicted in which epoch, so a pinned frame reproduces. */
  seed?: number;
}

/** Epochs to a wrapper pass. */
const EPOCHS = 8;

const NONE: PartOffset = {};

/**
 * Moves an inner piece's affliction from part to part. Exactly one part of the pool is afflicted at
 * a time and it jumps somewhere unpredictable every few seconds — a travelling fault reads as an
 * effect, a jumping one reads as a defect, which is the point.
 *
 * The holder is drawn from the whole pool of its kind, so this wants `{ amount: 1 }` as its target:
 * against a subset, the fault can land on a part the effect does not drive and nothing lights up.
 */
export function roving(inner: EffectPiece, spec: RovingSpec = {}): EffectPiece {
  const seed = spec.seed ?? 0;
  const innerDuration = inner.duration > 0 ? inner.duration : 1000;
  const wanted = spec.dwell ?? 3200;
  // A whole number of inner passes, so the inner's reconstructed phase is continuous across the
  // wrapper's loop seam — then a whole number of epochs inside that, so no epoch is cut short.
  // Do NOT make the epoch itself a multiple of the inner pass: every handover would then sample
  // the inner at one fixed phase, where its rest is a per-part constant, and the first part that
  // blocks its own handover keeps the fault forever.
  const duration = Math.max(1, Math.round((EPOCHS * wanted) / innerDuration)) * innerDuration;
  const epochs = Math.max(1, Math.round(duration / wanted));
  const epoch = duration / epochs;

  const nominal = (n: number, count: number) =>
    Math.min(count - 1, Math.floor(hash01(n * 1.7 + seed * 91.3) * count));

  /**
   * Who holds the fault in epoch `n`. Two laps over the pass: `t` is normalized within a pass, so
   * the walk has to start somewhere, and the first lap is what finds where the previous pass left
   * the fault. Answering on the second makes the loop seam an ordinary deferred boundary rather
   * than the one handover nothing defers.
   */
  const holderOf = (n: number, part: PartInfo) => {
    const count = Math.max(1, part.count);
    let held = nominal(0, count);
    for (let lap = 0; lap < 2; lap++) {
      for (let e = 0; e < epochs; e++) {
        const phase = ((e * epoch) % innerDuration) / innerDuration;
        if (isRest(inner.at(phase, { ...part, index: held }))) held = nominal(e, count);
        if (lap === 1 && e === n) return held;
      }
    }
    return held;
  };

  // One frame asks the same question once per targeted part, and roving targets every part of its
  // kind. Memoized on `t` so the chain is walked once a frame rather than once a part.
  let memoT = Number.NaN;
  let memoCount = -1;
  let memoHolder = 0;

  return {
    duration,
    at(t, part) {
      if (t !== memoT || part.count !== memoCount) {
        memoT = t;
        memoCount = part.count;
        memoHolder = holderOf(Math.min(epochs - 1, Math.floor((t * duration) / epoch)), part);
      }
      if (part.index !== memoHolder) return NONE;
      return inner.at(((t * duration) % innerDuration) / innerDuration, part);
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/core/test/effects/roving.test.ts`
Expected: PASS, all 12 cases.

- [ ] **Step 5: Verify by mutation, three ways**

Each of these should turn a specific test red. If one does not, the test is not testing what it says.
Restore after each.

1. **Delete the deferral** — replace the `holderOf` body with
   `return nominal(n, Math.max(1, part.count));`.
   Expected: "defers the handover while the outgoing part is not at rest" fails.
2. **Snap the epoch to the inner pass** — the failure the prototype found. Replace the three
   arithmetic lines with `const epoch = Math.max(1, Math.round(wanted / innerDuration)) *
   innerDuration; const epochs = EPOCHS; const duration = epochs * epoch;`.
   Expected: "moves the fault: a whole pass visits more than one part" fails, at exactly one holder.
   This mutation is the whole reason that test exists — it is the one shape of this code that reads
   as more correct than the real thing and produces a sign with a permanently stuck fault.
3. **Break the memo key** — drop `|| part.count !== memoCount` from the guard.
   Expected: "survives a single-part pool, even right after a larger one at the same t" fails, on a
   holder index of 4 against a pool of 1 returning no offset at all.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add packages/core/src/effects/roving.ts packages/core/test/effects/roving.test.ts
git commit -m "move an effect's fault from one tube to another"
```

---

### Task 5: public exports

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/effects/pieces.test.ts`:

```ts
describe('the public surface', () => {
  it('names every registry piece in EFFECT_NAMES', async () => {
    const { EFFECT_NAMES } = await import('../../src/index.js');
    expect([...EFFECT_NAMES].sort()).toEqual(['flicker', 'hue']);
  });

  it('exports roving as a factory, since no name can carry an inner piece', async () => {
    const api = await import('../../src/index.js');
    expect(typeof api.roving).toBe('function');
    expect(typeof api.roving(api.EFFECTS.flicker()).at).toBe('function');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/core/test/effects/pieces.test.ts`
Expected: FAIL — `api.roving is not a function`. (`EFFECT_NAMES` already derives from `EFFECTS`, so
that case passes on Task 3's work; it is here to pin the union against the registry.)

- [ ] **Step 3: Add the exports**

In `packages/core/src/index.ts`, change the pieces export line:

```ts
export { EFFECTS, type FlickerSpec } from './effects/pieces.js';
```

to:

```ts
export { EFFECTS, type FlickerSpec, type HueSpec } from './effects/pieces.js';
export { roving, type RovingSpec } from './effects/roving.js';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/core/test/effects/pieces.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole unit suite**

Run: `npm run check`
Expected: lint clean, typecheck clean, all tests pass. Record the file and test counts — the handoff
in Task 8 states them, and the doc has twice carried a stale number.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/index.ts packages/core/test/effects/pieces.test.ts
git commit -m "export the hue and roving specs"
```

---

### Task 6: lab controls

Nothing can be judged by eye until it can be switched on. The lab already has a `flicker` checkbox
built the same way; these follow it exactly.

**Files:**
- Modify: `apps/lab/index.html:125`
- Modify: `apps/lab/src/main.ts`

- [ ] **Step 1: Add the checkboxes**

In `apps/lab/index.html`, after the existing line:

```html
        <label>flicker <input id="flicker" type="checkbox" /></label>
```

add:

```html
        <label>hue <input id="hue" type="checkbox" /></label>
        <label>roving <input id="roving" type="checkbox" /></label>
```

- [ ] **Step 2: Wire them up**

In `apps/lab/src/main.ts`:

1. After `const flickerInput = el<HTMLInputElement>('flicker');` (near line 61), add:

```ts
const hueInput = el<HTMLInputElement>('hue');
const rovingInput = el<HTMLInputElement>('roving');
```

2. In the control-id list that begins with `'radius'` (near line 100), add `'hue'` and `'roving'`
   immediately after `'flicker'`.

3. Add `roving` and `EFFECTS` to the existing `klieg` import at the top of the file, alongside the
   `EffectSpec` type already imported.

4. Replace the `FLICKER` constant (near line 266) with:

```ts
/** One bad tube — the sign's first run, so a pinned shot always lands on the same glass. */
const FLICKER: EffectSpec[] = [
  { piece: 'flicker', target: { kind: 'run', by: 'index', count: 1 } },
];

/** Every run, since the whole sign changes colour together. */
const HUE: EffectSpec[] = [{ piece: 'hue', target: { kind: 'run', amount: 1 } }];

/** Every run, because the wrapper picks the holder out of the pool it was given. */
const ROVING: EffectSpec[] = [
  { piece: roving(EFFECTS.flicker()), target: { kind: 'run', amount: 1 } },
];

function chosenEffects(): EffectSpec[] | undefined {
  const specs = [
    ...(flickerInput.checked ? FLICKER : []),
    ...(hueInput.checked ? HUE : []),
    ...(rovingInput.checked ? ROVING : []),
  ];
  return specs.length > 0 ? specs : undefined;
}
```

5. In `fire()` (near line 320), replace:

```ts
    effects: flickerInput.checked ? FLICKER : undefined,
```

with:

```ts
    effects: chosenEffects(),
```

6. In the enable/disable pass (near line 486), replace:

```ts
  surfacesInput.disabled = flickerInput.disabled = !tube;
```

with:

```ts
  surfacesInput.disabled = flickerInput.disabled = !tube;
  hueInput.disabled = rovingInput.disabled = !tube;
```

- [ ] **Step 3: Run the lab and look at it**

Run: `npm run dev -w @klieg/lab`. Open it, pick `tubing`, tick each box in turn, and fire.

Expected, and each is worth checking rather than assuming:
- **hue** — the whole sign changes colour together and stays about as bright the whole way round. If
  it visibly brightens through yellow and dims through blue, the luma hold is not reaching the render
  path.
- **roving** — one tube stutters, and after a few seconds a *different* one does instead. Never two
  at once, never none.
- **hue + flicker together** — the sign cycles colour and one tube stutters, independently. This is
  the composition claim: gain and colour are separate channels of one merged offset.

- [ ] **Step 4: Commit**

```bash
git add apps/lab/index.html apps/lab/src/main.ts
git commit -m "switch hue and roving on from the lab"
```

---

### Task 7: visual baselines

A time-varying effect cannot be shot off a live clock. `?pin=<ms>` holds every frame at one elapsed
time and the selection is seeded, which is what makes the existing `effect-flicker` baseline stable —
these two follow it.

**Files:**
- Modify: `apps/lab/test/looks.spec.ts` (the `effects` describe block, near line 114)

- [ ] **Step 1: Add the tests**

Inside the existing `test.describe('effects', ...)` block, after the `flicker` test:

```ts
  test('hue recolours the whole sign at once', async ({ page }) => {
    await still(page, '?pin=1500');
    await page.selectOption('#look', 'tubing');
    await page.check('#hue');
    await shoot(page, 'effect-hue');
  });

  test('roving takes one run down, at a pin far past the first handover', async ({ page }) => {
    // Well beyond one epoch, so this shot proves the fault moved rather than that it started.
    await still(page, '?pin=11000');
    await page.selectOption('#look', 'tubing');
    await page.check('#roving');
    await shoot(page, 'effect-roving');
  });
```

- [ ] **Step 2: Generate the baselines**

Run: `npx playwright test looks.spec.ts -g "effects" -u`

`--update-snapshots` rewrites **every** baseline it touches, so confirm afterwards that only the two
new files appeared:

```bash
git status --short apps/lab/test
```

Expected: exactly two new `effect-hue-*.png` and `effect-roving-*.png` files, and **no modification**
to any pre-existing baseline. A modified one means a shipped look moved, which is the claim this whole
pipeline rests on — stop and find out why before going further.

- [ ] **Step 3: Look at the two new PNGs**

```bash
open apps/lab/test/looks.spec.ts-snapshots/effect-hue-*.png apps/lab/test/looks.spec.ts-snapshots/effect-roving-*.png
```

A baseline is only as good as the frame it froze. Confirm the hue shot is a plainly non-default colour
and the roving shot has exactly one dark run.

- [ ] **Step 4: Run the whole visual suite**

Run: `npx playwright test`
Expected: green, at 26 tests across 2 files. Note the traps that already apply here: `visual.spec.ts`
is flaky under parallel load and a single failure in it is not evidence of a regression — re-run
before believing it, and capture the diff first if you want to diagnose rather than dismiss it.

- [ ] **Step 5: Commit**

```bash
git add apps/lab/test
git commit -m "pin a hue sweep and a moved fault as baselines"
```

---

### Task 8: documentation

Three documents, each with a different reader. The README has **no** effects section at all — the
pipeline landed without one, so `LookSpec.effects` is undocumented public API and this is where that
gets fixed.

**Files:**
- Modify: `README.md` (new section after `### gradient`, which ends near line 190)
- Modify: `docs/superpowers/specs/2026-08-25-roving-and-hue-design.md`
- Modify: `docs/superpowers/HANDOFF.md`

- [ ] **Step 1: Document the public API in the README**

Add after the `### gradient` section, before `## Stages`:

````markdown
### effects

Effects drive a sign's appearance over time, below the letter: a `look` sets what every letter is made
of, and an effect changes some *part* of it — one tube of a neon sign, not the sign. Set them on a look
with `LookSpec.effects`, or per fire with `FireOptions.effects`, which replaces a look's own list
rather than adding to it.

```js
import { fire, EFFECTS, roving } from 'klieg';

fire('JACKPOT!', {
  look: 'tubing',
  effects: [
    // One run of the whole sign, picked by seed, stutters like failing glass.
    { piece: 'flicker', target: { kind: 'run', by: 'index', count: 1 } },
    // Every run cycles colour together.
    { piece: 'hue', target: { kind: 'run', amount: 1 } },
  ],
});
```

| field | meaning |
|---|---|
| `piece` | a name from `EFFECT_NAMES`, or a piece built by a factory so it can be tuned |
| `target` | `{ kind: 'run' \| 'body' }` plus a selection: `amount` is a fraction of the pool and `count` a literal number of members, and `count` wins when both are given |
| `stagger` | per-part phase spread, the same spec `enter` and `exit` take |
| `seed` | fixes the selection, so a pinned frame reproduces |

The pool is word-wide, so `{ count: 1 }` picks one bad tube in the sign rather than one in every
letter. A `body` part only reads `gain`; colour reaches `run` parts only.

**`flicker`** — a tube on its way out. `EFFECTS.flicker({ depth, unrest, duration })`: `depth` is the
floor of its gain, `unrest` the share of the pass spent stuttering.

**`hue`** — a colour sweep across the sign. `EFFECTS.hue({ from, span, spread, luminance, duration })`,
in turns: `span` of 1 is the whole wheel and the only value that meets itself at the loop seam, and
`spread` offsets the hue along the word to make a travelling gradient rather than one synchronized
sign. The sweep holds Rec.709 luminance rather than saturation, so blues and violets come out paler
and the sign glows evenly all the way round — at constant saturation it would brighten through yellow
and fall out of the bloom threshold through blue.

**`roving(inner, { dwell, seed })`** — takes another piece and moves its affliction from one part to
another, so `roving(EFFECTS.flicker())` is one bad tube that jumps every few seconds. It is a factory
and not a name, because a name cannot carry the piece it wraps. Give it `{ amount: 1 }`: it picks its
holder from the whole pool of that kind, so against a subset the fault can land on a part the effect
does not drive.

A hue piece writes colour every frame, which **overrides `tint`** on a tinted look. `tubing` sets
`tintTo: 'decoration'`, so a hue sweep and a tint on that look fight, and the hue wins.
````

- [ ] **Step 2: Resolve the design's open questions**

In `docs/superpowers/specs/2026-08-25-roving-and-hue-design.md`, replace the `## Not decided` section
with:

```markdown
## Decided, on implementation

- **`roving` is factory-only and `hue` is a name.** `EffectName` is `'flicker' | 'hue'`. `EffectSpec`
  did not gain a per-piece parameter field: a wrapper takes another piece, which no name can express,
  and tuning a leaf piece already works through `piece: EFFECTS.hue({ ... })`. Whether names should
  be tunable at all is still open, and still not blocking anything.
- **The sweep travels the whole wheel by default**, `from` 0 and `span` 1 turn. Any other `span`
  snaps back at the loop seam, which is stated on the field rather than designed around.
- **`dwell` defaults to 3200ms, provisionally.** It was not measured — the lab that would measure it
  is not built, and no shipped look declares `roving`, so nothing depends on the number. Pick it
  properly the way `flicker`'s `unrest` was picked when there is something to measure against.
- **`luminance` defaults to 0.5**, which is where the wheel's darkest and brightest hues give up the
  same amount: blue's saturation against yellow's brightness.
```

- [ ] **Step 3: Record the two refinements and the traps found**

In the same file, in the `## Traps` section, replace the wrapper-duration trap with:

```markdown
**Never make the epoch a multiple of the inner's duration.** It looks like the right thing — both
clocks tile, and the loop seam stops being a special case. It permanently breaks the effect. Every
handover then samples the inner piece at the same phase, and whether a piece is at rest at a fixed
phase is a per-part constant: `flicker` is mid-stutter at phase 0 for about 18% of part indices, and
the first such index to take the fault blocks its own handover forever. Measured on the prototype at
one holder per pass and zero handovers, against 4 holders and 6 handovers for the shipped
arithmetic. The wrapper's *duration* is a whole multiple of the inner's, so the inner's phase is
continuous at the loop seam; the epoch then divides that duration evenly, which leaves the boundary
phase free to move.

**A deferred handover waits a whole epoch.** Resolving "until the outgoing part is at rest" mid-epoch
makes the holder a function of a search over continuous time; retrying at the next boundary keeps it
constant within an epoch, which is what makes "exactly one holder at every sample" testable at all.

**The holder chain is walked twice per pass.** `t` is normalized within a pass, so the walk needs a
start, and starting fresh each pass leaves the loop seam as the one handover nothing defers. The
first lap finds where the previous pass left the fault and the second answers.
```

and add these two, which the implementation found:

```markdown
**`roving` draws its holder from the whole pool of its kind, not from the parts it was given.**
`at(t, part)` sees pool-wide numbering and cannot know which subset an effect targets, so a `roving`
against anything but `{ amount: 1 }` can put the fault on a part nothing drives — and the sign then
shows no fault at all, which reads as the piece being broken.

**Colour never reaches a `body` part.** `writePart` returns after the emissive write for a body, so
`hue` on `{ kind: 'body' }` is silently inert. A run only reads it either, unless the look applied its
own material — a debug material override clears `litReadsRunColor` and the buffer write is skipped.
```

- [ ] **Step 4: Update the handoff**

In `docs/superpowers/HANDOFF.md`:

1. Delete the whole `## In flight` claim that `effects-pipeline` is unlanded — it is on `main`.
2. Replace the "Next, designed and unplanned: two more effect pieces" paragraph with a statement that
   both shipped, naming `roving` as factory-only and `hue` as a registry name, and pointing at
   [the plan](../plans/2026-08-25-roving-and-hue.md) and the spec.
3. Update the test counts in `## State` to the numbers Task 5 and Task 7 actually measured. Measure
   them; do not carry them over. The doc has twice claimed a Playwright number one higher than
   `--list` reports.
4. Add to the trap list: colour never reaches a body part, and `roving` wants `{ amount: 1 }`.
5. Add to `## What is worth doing next`, at the top, the composition lab described below.

- [ ] **Step 4b: Record the composition lab as the next thing worth building**

Asked for while this plan was being written, and the reason is worth stating rather than assuming:
authoring effect pieces through a written plan is slow and blind — the roving arithmetic was wrong in
a way no amount of reading caught, and only a prototype that ran found it. Add to
`docs/superpowers/HANDOFF.md` under `## What is worth doing next`:

```markdown
- **A composition lab, so effect pieces get built by hand rather than through a plan.** The two
  pieces in [the roving and hue plan](plans/2026-08-25-roving-and-hue.md) were specified in prose,
  and the wrapper's epoch arithmetic was wrong in a way that read as more correct than the fix: a
  prototype found it in one run and no amount of review had. Pieces are pure functions of `(t, part)`
  with no GL involved, so a lab can plot one against time, layer several, scrub a pinned clock, and
  show the merged offset per part — which is most of what a session currently burns tokens
  reconstructing. Nothing is designed yet; it needs a design pass. It is a different lab from
  **kliegsminister** (the stage/repair lab in
  [the pipeline lab design](specs/2026-08-23-pipeline-lab-design.md)) — that one is about tube
  geometry, this one about time.
```

- [ ] **Step 5: Final verification**

```bash
npm run check
npx playwright test
```

Expected: both green. State the actual counts rather than the expected ones.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/superpowers
git commit -m "document the effects pipeline and its two new pieces"
```

---

## Acceptance, from the design

Check each against the work rather than assuming the tasks covered it.

- [ ] A whole wrapper pass, sampled densely, has **exactly one** holder at every sample — never zero,
      never two. *(Task 4, first case, 500 samples.)*
- [ ] Breaking the deferral makes a mid-drop handover observable in a test, not only on screen.
      *(Task 4, mutation 1.)*
- [ ] `roving(flicker())` at a pinned clock is reproducible across runs, so it holds a visual
      baseline. *(Task 4 determinism case; Task 7 baseline.)*
- [ ] A hue sweep's Rec.709 luminance stays within a stated tolerance across the whole wheel,
      asserted numerically rather than by eye. *(Task 2, tolerance 0.005 at 360 samples.)*
- [ ] Every shipped look renders byte-identical: no built-in look declares either piece. *(Task 7,
      step 2 — no pre-existing baseline modified.)*
- [ ] `npm run check` and `npx playwright test` stay green. *(Task 8, step 5.)*
