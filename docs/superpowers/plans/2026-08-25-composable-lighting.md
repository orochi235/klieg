# Composable Lighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split lighting into a composable `lighting` slot that poses the environment and a `lamp` effect piece that puts light on individual parts.

**Architecture:** `lighting` becomes a slot with the same grammar as `active` — names, pieces, or an array — whose pieces return `{ yaw, pitch }` that sum. Light landing on a part travels through a new additive `light` channel on `PartOffset`, resolved in `word.ts` by multiplying the lamp's colour against the property that carries the look's hue and adding it onto the look's base emissive. Both read one `FrameCtx` carrying the pointer in canvas space and in the word's layout space.

**Tech Stack:** TypeScript, three.js (peer), vitest for units, Playwright for renders.

**Read first:** [the design](../specs/2026-08-25-composable-lighting-design.md) and
[the findings note](../specs/2026-08-25-material-lighting-findings.md). The findings note explains
why `gain` is not the channel, which is the single most important thing to not re-derive.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/render/lighting.ts` | **Rewrite.** `EnvPiece`, the `sweep`/`static`/`track` factories, and `mergeEnv`. `track` carries its own follow, so `PointerLight` is dead once Task 7 lands and Task 8 deletes it. Imports `FrameCtx` from `effects/types.ts`. |
| `packages/core/src/effects/lamp.ts` | **New.** `LightPose`, `LightSource`, the `fixed`/`orbit`/`along`/`fromPointer` sources, and `lamp()`. |
| `packages/core/src/effects/types.ts` | `FrameCtx`, `PartOffset.light`, `ResolvedOffset.light`, `EffectPiece.at` gains a `ctx`. |
| `packages/core/src/effects/compositor.ts` | Sums the light channel. Stays pure — no three import. |
| `packages/core/src/render/looks.ts` | Exports `lightBase(look)` — the emissive a lamp adds onto, and the hue it multiplies. |
| `packages/core/src/render/word.ts` | Resolves the light channel onto materials; `partExtent()`; threads `ctx`. |
| `packages/core/src/index.ts` | The render loop and the `lighting` option. `LightingSlot` and `resolveLighting` live in `render/lighting.ts` instead, so the resolver stays testable without going public. |
| `packages/core/src/pointer.ts` | **New in Task 7.** `pointerFrame(box, client, extent)` — the canvas rect and the word extent to a `FrameCtx` pointer pair, pure and unit-tested. Not in the barrel. |
| `packages/core/src/motion/types.ts`, `motion/compositor.ts` | `envRotation` and `slotDrivesEnv` are removed. |

---

### Task 1: The light channel on `PartOffset`

Authoring form is `{ color, amount }`; the resolved form is an accumulated linear RGB triple, so
two lamps of different colours sum correctly rather than one overwriting the other.

**Files:**
- Modify: `packages/core/src/effects/types.ts`
- Modify: `packages/core/src/effects/compositor.ts`
- Test: `packages/core/test/effects/compositor.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/effects/compositor.test.ts`:

```ts
describe('the light channel', () => {
  it('rests at no light', () => {
    expect(mergeOffsets([]).light).toEqual([0, 0, 0]);
  });

  it('scales a lamp colour by its amount', () => {
    const out = mergeOffsets([{ light: { color: 0xff0000, amount: 0.5 } }]);
    expect(out.light[0]).toBeCloseTo(0.5);
    expect(out.light[1]).toBeCloseTo(0);
    expect(out.light[2]).toBeCloseTo(0);
  });

  // Two lamps reaching one part must add. Overwriting would make the second lamp delete the first.
  it('sums lamps of different colours', () => {
    const out = mergeOffsets([
      { light: { color: 0xff0000, amount: 1 } },
      { light: { color: 0x0000ff, amount: 0.25 } },
    ]);
    expect(out.light[0]).toBeCloseTo(1);
    expect(out.light[2]).toBeCloseTo(0.25);
  });

  it('reads a lamp at zero amount as rest', () => {
    expect(isRest({ light: { color: 0xffffff, amount: 0 } })).toBe(true);
    expect(isRest({ light: { color: 0xffffff, amount: 0.1 } })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/test/effects/compositor.test.ts -t "light channel"`
Expected: FAIL — `light` is not a property of `ResolvedOffset`, and TypeScript rejects `{ light: … }`.

- [ ] **Step 3: Add the channel to the types**

In `packages/core/src/effects/types.ts`, add to `PartOffset`:

```ts
  /** Light landing on the part, added from zero. Lamps sum. A multiplier cannot express this:
   * `emissive` defaults to black, so scaling it is a no-op on every look but `neon`. */
  light?: { color: number; amount: number };
```

and to `ResolvedOffset`:

```ts
  /** Accumulated lamp colour, premultiplied by amount. Linear RGB, 0..n. */
  light: Vec3;
```

- [ ] **Step 4: Sum it in the compositor**

In `packages/core/src/effects/compositor.ts`, add above `mergeOffsets`:

```ts
function rgb(hex: number): Vec3 {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}
```

Add `light: [0, 0, 0]` to `REST_OFFSET`. Inside `mergeOffsets`, declare
`const light: Vec3 = [0, 0, 0];`, add to the loop:

```ts
    if (o.light && o.light.amount !== 0) {
      const c = rgb(o.light.color);
      for (let i = 0; i < 3; i++) {
        light[i] = (light[i] as number) + (c[i] as number) * o.light.amount;
      }
    }
```

and return `light` alongside the rest. In `isRest`, add `if (o.light?.amount) return false;`.

- [ ] **Step 5: Run the test**

Run: `npx vitest run packages/core/test/effects/compositor.test.ts`
Expected: PASS, including the file's existing cases.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/effects/types.ts packages/core/src/effects/compositor.ts packages/core/test/effects/compositor.test.ts
git commit -m "add an additive light channel to a part offset"
```

---

### Task 2: `FrameCtx` and light sources

> **Amended after Task 2 shipped.** `FrameCtx` now lives in `packages/core/src/effects/types.ts`,
> not `render/lighting.ts`. Task 3 is what would have made `effects/types.ts` — the module every
> effects consumer imports — depend on `render/lighting.ts`, whose other export is `PointerLight`,
> a class that attaches DOM listeners. The step text below is left as it was executed; the move is
> folded into Task 3. Read every `from '../render/lighting.js'` below as `from './types.js'`, and
> in the test as `from '../../src/effects/types.js'`.

**Files:**
- Modify: `packages/core/src/render/lighting.ts`
- Create: `packages/core/src/effects/lamp.ts`
- Test: `packages/core/test/effects/lamp.test.ts`

- [x] **Step 1: Write the failing test**

Create `packages/core/test/effects/lamp.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { along, fixed, fromPointer, orbit } from '../../src/effects/lamp.js';
import type { FrameCtx } from '../../src/render/lighting.js';

const NO_POINTER: FrameCtx = { pointer: null, pointerInWord: null, dt: 16 };
const AT: FrameCtx = { pointer: { x: 0.5, y: -0.5 }, pointerInWord: { x: 1.2, y: 0.3 }, dt: 16 };

describe('fixed', () => {
  it('ignores both time and pointer', () => {
    expect(fixed(0.8, 0.2)(0, NO_POINTER)).toEqual({ x: 0.8, y: 0.2 });
    expect(fixed(0.8, 0.2)(0.75, AT)).toEqual({ x: 0.8, y: 0.2 });
  });
});

describe('fromPointer', () => {
  // Rest, not the origin: the origin is the middle of the word, where a lamp would light the
  // centre letter on a page nobody has touched.
  it('yields null until the pointer has been inside', () => {
    expect(fromPointer()(0, NO_POINTER)).toBeNull();
  });

  it('reads the pointer already projected into the word', () => {
    expect(fromPointer()(0, AT)).toEqual({ x: 1.2, y: 0.3 });
  });

  it('passes the projected point through a supplied map', () => {
    const source = fromPointer((p) => ({ x: p.x * 2, y: 0 }));
    expect(source(0, AT)).toEqual({ x: 2.4, y: 0 });
  });
});

describe('orbit', () => {
  it('starts at the right of the circle and comes back after one turn', () => {
    const source = orbit({ radius: 2 });
    const start = source(0, NO_POINTER);
    expect(start).toEqual({ x: 2, y: 0 });
    expect(source(1, NO_POINTER)?.x).toBeCloseTo(2);
    expect(source(0.25, NO_POINTER)?.y).toBeCloseTo(2);
  });
});

describe('along', () => {
  it('walks the path end to end across the pass', () => {
    const source = along([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
    expect(source(0, NO_POINTER)).toEqual({ x: 0, y: 0 });
    expect(source(0.5, NO_POINTER)?.x).toBeCloseTo(2);
    expect(source(1, NO_POINTER)?.x).toBeCloseTo(4);
  });

  it('refuses a path with nothing to walk', () => {
    expect(() => along([])).toThrow(/at least two points/);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/test/effects/lamp.test.ts`
Expected: FAIL — `packages/core/src/effects/lamp.js` does not exist.

- [x] **Step 3: Add `FrameCtx` to lighting**

At the top of `packages/core/src/render/lighting.ts`:

```ts
/** What every lighting piece and light source reads for one frame. */
export interface FrameCtx {
  /** -1..1 over the canvas box, or null until the pointer has been inside it. */
  pointer: { x: number; y: number } | null;
  /** The same pointer in the word's layout space — the em, block-relative space `PartInfo.x/y`
   * uses. Null whenever `pointer` is. */
  pointerInWord: { x: number; y: number } | null;
  /** Milliseconds since the previous frame. */
  dt: number;
}
```

- [x] **Step 4: Write the sources**

Create `packages/core/src/effects/lamp.ts`:

```ts
import type { FrameCtx } from '../render/lighting.js';

/** Where a lamp is, in the word's own layout space. */
export interface LightPose {
  x: number;
  y: number;
  /** Radians. Reserved for a directional lamp; radial falloff ignores it. */
  direction?: number;
}

/** Null means the lamp has nowhere to be this frame and contributes nothing. */
export type LightSource = (t: number, ctx: FrameCtx) => LightPose | null;

const TAU = Math.PI * 2;

export function fixed(x: number, y: number): LightSource {
  return () => ({ x, y });
}

/**
 * The cursor, already projected into the word. The mapping is the interesting part — the cursor is
 * one source among several rather than the concept.
 */
export function fromPointer(map?: (p: { x: number; y: number }) => LightPose): LightSource {
  return (_t, ctx) => {
    const p = ctx.pointerInWord;
    if (!p) return null;
    return map ? map(p) : { x: p.x, y: p.y };
  };
}

export interface OrbitSpec {
  radius?: number;
  x?: number;
  y?: number;
}

export function orbit(spec: OrbitSpec = {}): LightSource {
  const radius = spec.radius ?? 2;
  const cx = spec.x ?? 0;
  const cy = spec.y ?? 0;
  return (t) => ({ x: cx + Math.cos(t * TAU) * radius, y: cy + Math.sin(t * TAU) * radius });
}

/** Walks a polyline once per pass, by segment count rather than by arc length. */
export function along(points: readonly { x: number; y: number }[]): LightSource {
  if (points.length < 2) throw new Error('klieg: along() needs at least two points');
  const last = points.length - 1;
  return (t) => {
    const u = Math.min(Math.max(t, 0), 1) * last;
    const i = Math.min(Math.floor(u), last - 1);
    const f = u - i;
    const a = points[i] as { x: number; y: number };
    const b = points[i + 1] as { x: number; y: number };
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  };
}
```

- [x] **Step 5: Run the test**

Run: `npx vitest run packages/core/test/effects/lamp.test.ts`
Expected: PASS, 7 tests. (The review round added two more, taking it to 9.)

- [x] **Step 6: Commit**

```bash
git add packages/core/src/effects/lamp.ts packages/core/src/render/lighting.ts packages/core/test/effects/lamp.test.ts
git commit -m "add light sources and the per-frame lighting context"
```

---

### Task 3: The `lamp` piece

**Files:**
- Modify: `packages/core/src/effects/types.ts`
- Modify: `packages/core/src/effects/lamp.ts`
- Test: `packages/core/test/effects/lamp.test.ts`

- [x] **Step 1: Write the failing test**

Append to `packages/core/test/effects/lamp.test.ts`:

```ts
import { lamp } from '../../src/effects/lamp.js';
import type { PartInfo } from '../../src/effects/types.js';

const partAt = (x: number, y = 0): PartInfo => ({
  kind: 'body',
  index: 0,
  count: 1,
  letter: { index: 0, count: 1 },
  x,
  y,
  at: 0,
  span: 1,
});

describe('lamp', () => {
  it('is brightest at its centre and dark past its radius', () => {
    const piece = lamp({ source: fixed(0, 0), radius: 1, strength: 2 });
    expect(piece.at(0, partAt(0), NO_POINTER).light?.amount).toBeCloseTo(2);
    expect(piece.at(0, partAt(1), NO_POINTER).light?.amount ?? 0).toBeCloseTo(0);
    expect(piece.at(0, partAt(5), NO_POINTER).light?.amount ?? 0).toBeCloseTo(0);
  });

  it('falls off between the two', () => {
    const piece = lamp({ source: fixed(0, 0), radius: 1, strength: 1 });
    const near = piece.at(0, partAt(0.25), NO_POINTER).light?.amount as number;
    const far = piece.at(0, partAt(0.75), NO_POINTER).light?.amount as number;
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
  });

  it('measures distance in both axes', () => {
    const piece = lamp({ source: fixed(0, 0), radius: 1, strength: 1 });
    expect(piece.at(0, partAt(0, 0.5), NO_POINTER).light?.amount).toBeCloseTo(
      piece.at(0, partAt(0.5, 0), NO_POINTER).light?.amount as number,
    );
  });

  // A page nobody has touched must not light a letter as though the cursor were parked on it.
  it('contributes nothing when its source has nowhere to be', () => {
    const piece = lamp({ source: fromPointer(), radius: 1, strength: 2 });
    expect(piece.at(0, partAt(0), NO_POINTER).light?.amount ?? 0).toBe(0);
  });

  it('carries its own colour', () => {
    const piece = lamp({ source: fixed(0, 0), color: 0xff8800 });
    expect(piece.at(0, partAt(0), NO_POINTER).light?.color).toBe(0xff8800);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/test/effects/lamp.test.ts -t "lamp"`
Expected: FAIL — `lamp` is not exported.

- [x] **Step 3: Give `EffectPiece.at` the context**

In `packages/core/src/effects/types.ts`, change the `at` signature. A piece that *implements*
`at(t, part)` keeps typechecking — TypeScript allows an implementation to declare fewer parameters.
**Callers are a different matter, and this plan originally got it wrong:** `render/word.ts` and
`effects/roving.ts` both call `.at(t, part)` with two arguments, and both fail to compile once `ctx`
is required. `roving` is a wrapper and forwards the `ctx` it receives; `word.ts` has no real `ctx`
until Task 7, so it passes an explicit rest constant. Do **not** make `ctx` optional to dodge this —
a lamp reached without a `ctx` would silently emit no light, which is the defect class this design
exists to fix.

```ts
export interface EffectPiece {
  /** Milliseconds for one pass. Loops. */
  duration: number;
  /** `t` is normalized 0..1 within this pass. */
  at(t: number, part: PartInfo, ctx: FrameCtx): PartOffset;
}
```

`FrameCtx` is declared in this file (see the amendment note under Task 2), so no import is needed.

- [x] **Step 4: Write `lamp`**

Append to `packages/core/src/effects/lamp.ts`:

```ts
import type { EffectPiece, PartOffset } from './types.js';

export interface LampSpec {
  /** Where the light is. Defaults to the cursor. */
  source?: LightSource;
  /** Milliseconds for one pass of a time-driven source. */
  duration?: number;
  /** How far the light reaches, in em of layout space. */
  radius?: number;
  /** Light at the centre. Falls to zero at `radius`. */
  strength?: number;
  /** The lamp's own colour, multiplied against the look's hue when it resolves. */
  color?: number;
}

const REST: PartOffset = {};

/** Flat at the centre and zero at the edge, so a lamp reads as a pool rather than a cone point. */
function falloff(d: number, radius: number): number {
  if (radius <= 0) return 0;
  const u = Math.min(Math.max(d / radius, 0), 1);
  return (1 - u) * (1 - u) * (1 + 2 * u);
}

export function lamp(spec: LampSpec = {}): EffectPiece {
  const source = spec.source ?? fromPointer();
  const duration = spec.duration ?? 4000;
  const radius = spec.radius ?? 0.5;
  const strength = spec.strength ?? 2;
  const color = spec.color ?? 0xffffff;

  return {
    duration,
    at(t, part, ctx) {
      const pose = source(t, ctx);
      if (!pose) return REST;
      const amount = strength * falloff(Math.hypot(part.x - pose.x, part.y - pose.y), radius);
      return amount === 0 ? REST : { light: { color, amount } };
    },
  };
}
```

- [x] **Step 5: Run the test**

Run: `npx vitest run packages/core/test/effects/lamp.test.ts`
Expected: PASS. The count is 16 — the plan supplies 5 and both review rounds added more.

- [x] **Step 6: Run the whole suite — the `at` signature touched every piece**

Run: `npm run typecheck && npx vitest run`
Expected: PASS — but only after the two call sites above are updated. `flicker`, `hue` and `chase`
implement `at(t, part)` and are genuinely unaffected; `roving` is not, because it calls `inner.at`.

- [x] **Step 7: Commit**

```bash
git add packages/core/src/effects/lamp.ts packages/core/src/effects/types.ts packages/core/test/effects/lamp.test.ts
git commit -m "add the lamp piece"
```

---

### Task 4: The base a lamp resolves against

`writePart` needs to know which property carries a look's colour. `tintTargetOf` already answers
that for `tint`; this exposes the resolved value.

**Files:**
- Modify: `packages/core/src/render/looks.ts`
- Test: `packages/core/test/render/looks.test.ts`

- [x] **Step 1: Write the failing test**

Append to `packages/core/test/render/looks.test.ts`:

```ts
describe('lightBase', () => {
  it('reads a plain look off its colour', () => {
    expect(lightBase('gold').hue).toBe(0xffc44d);
  });

  // gem is clear stone at color 0xffffff; its red is what light picks up passing through it.
  it('reads a transmissive look off its attenuation', () => {
    expect(lightBase('gem').hue).toBe(LOOKS.gem.attenuationColor);
  });

  it('reads an emissive look off its emissive', () => {
    expect(lightBase('neon').hue).toBe(LOOKS.neon.emissive);
  });

  it('carries the base emissive a lamp adds onto', () => {
    expect(lightBase('gold').emissive).toBe(0x000000);
    expect(lightBase('neon').emissive).toBe(LOOKS.neon.emissive);
  });

  it('honours a declared tintTarget over the inferred one', () => {
    expect(lightBase({ color: 0x112233, sheenColor: 0x445566, tintTarget: 'sheenColor' }).hue).toBe(
      0x445566,
    );
  });

  it('reads the tint the material was actually built with', () => {
    expect(lightBase('gold', 0xff2d6f)).toEqual({ emissive: 0x000000, hue: 0xff2d6f });
  });

  // A tinted neon's emissive IS the tint; reading the look's own would reset it every frame.
  it('moves the base emissive too when the tint landed on it', () => {
    expect(lightBase('neon', 0xff2d6f)).toEqual({ emissive: 0xff2d6f, hue: 0xff2d6f });
  });

  it('falls back to the defaults for a look that declares no colour', () => {
    expect(lightBase({ metalness: 1 })).toEqual({ emissive: 0x000000, hue: 0xffffff });
  });
});
```

Add `lightBase` to the file's existing import from `../../src/render/looks.js`.

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/test/render/looks.test.ts -t "lightBase"`
Expected: FAIL — `lightBase` is not exported.

- [x] **Step 3: Export it**

In `packages/core/src/render/looks.ts`, below `tintTargetOf`. It takes a `Look` and resolves
against `DEFAULTS`, mirroring `frameOwnedBase` — which is the function `word.ts` already calls for
exactly this job.

```ts
export interface LightBase {
  /** The look's own emissive, which lamp light adds onto rather than replacing. */
  emissive: number;
  /** The colour the look reads as, whichever property carries it. What a lamp multiplies against. */
  hue: number;
}

export function lightBase(look: Look, tint?: number): LightBase {
  const spec = specOf(look);
  const params = resolveParams(spec);
  const target = tintTargetOf(params, spec.tintTarget);
  if (tint !== undefined) params[target] = tint;
  return { emissive: params.emissive, hue: params[target] };
}
```

The declared override is `spec.tintTarget` — `LookSpec` has no `tint` field.

It takes `tint` for the same reason `applyLook` does: `applyLook` writes the tint over
`params[tintTargetOf(...)]`, so on a tinted word the hue on the material is the tint and the look's
own colour is not on screen anywhere. Reading the untinted one would light a pink letter gold, and
on a look whose tint target is `emissive` it would reset the tint on every frame.

- [x] **Step 4: Run the test**

Run: `npx vitest run packages/core/test/render/looks.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/core/src/render/looks.ts packages/core/test/render/looks.test.ts
git commit -m "expose the emissive and hue a lamp resolves against"
```

---

### Task 5: `word.ts` resolves the light channel

**Decide this first: does the light channel sum in sRGB or in linear?** Task 1's review raised it
and deferred it here. `ResolvedOffset.light` accumulates sRGB-encoded bytes over 255, and
`litEmissive` below stays in that space and hands the result to `THREE.Color.setHex()`, which does
the sRGB-to-linear conversion. That is self-consistent, but summing sRGB is not summing radiance:
two lamps at half strength do not add to the brightness one lamp at full strength gives.

It matters only where two lamps overlap, which is why the design did not catch it. **Decided: ship
the sRGB version below unchanged.** Task 9 Step 3 renders two overlapping lamps and looks at the
seam; if it reads wrong, the fix is to decode in `rgb()` and encode once in `litEmissive`, not to
change the channel's shape.


This is the task no unit test can prove. Write the unit test anyway for the arithmetic, then prove
it on screen in Task 9.

**Files:**
- Modify: `packages/core/src/render/word.ts`
- Test: `packages/core/test/render/word-light.test.ts`

- [x] **Step 1: Write the failing test**

Create `packages/core/test/render/word-light.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { litEmissive } from '../../src/render/word.js';

describe('litEmissive', () => {
  it('leaves the base alone when no lamp reached the part', () => {
    expect(litEmissive(0x000000, 0xffc44d, [0, 0, 0])).toBe(0x000000);
    expect(litEmissive(0xff2d95, 0xff2d95, [0, 0, 0])).toBe(0xff2d95);
  });

  // A white lamp on gold must reflect gold. Adding white washes it to cream.
  it('multiplies the lamp by the look hue', () => {
    const out = litEmissive(0x000000, 0xff8000, [1, 1, 1]);
    expect((out >> 16) & 0xff).toBe(0xff);
    expect((out >> 8) & 0xff).toBe(0x80);
    expect(out & 0xff).toBe(0x00);
  });

  // neon carries its own glow; a lamp that assigns emissive would delete it off every unlit part.
  it('adds onto the base rather than replacing it', () => {
    const out = litEmissive(0x004000, 0x00ff00, [0.25, 0.25, 0.25]);
    expect((out >> 8) & 0xff).toBeGreaterThan(0x40);
  });

  it('clamps rather than wrapping', () => {
    const out = litEmissive(0xffffff, 0xffffff, [8, 8, 8]);
    expect(out).toBe(0xffffff);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/test/render/word-light.test.ts`
Expected: FAIL — `litEmissive` is not exported.

- [x] **Step 3: Write the resolver**

In `packages/core/src/render/word.ts`, near `setEmissiveIntensity`:

```ts
const clamp255 = (n: number): number => Math.min(255, Math.max(0, Math.round(n)));

/**
 * Lamp light landing on a part: `base + lamp x hue`. Multiplying by the hue is what keeps a
 * material's identity — a white lamp on gold reflects gold, and adding white reflects cream.
 * @internal exported for test; not part of the public surface.
 */
export function litEmissive(base: number, hue: number, light: Vec3): number {
  const [lr, lg, lb] = light;
  if (!lr && !lg && !lb) return base;
  // A non-finite channel contributes nothing rather than blacking the channel out: clamp255(NaN)
  // is NaN, and NaN << 16 is 0, so the base would vanish on one channel and survive on the others.
  const ch = (shift: number, l: number): number =>
    clamp255(((base >> shift) & 0xff) + (Number.isFinite(l) ? l : 0) * ((hue >> shift) & 0xff));
  return (ch(16, lr) << 16) | (ch(8, lg) << 8) | ch(0, lb);
}
```

The hue byte is not divided by 255 and re-multiplied — `light` is already a 0..n multiplier.

- [x] **Step 4: Run the test**

Run: `npx vitest run packages/core/test/render/word-light.test.ts`
Expected: PASS, 4 tests.

- [x] **Step 5: Apply it in `writePart`**

`writePart` currently branches on `part.kind`. Give each branch the light.

For a `body` part, the light lands on the material's emissive. The hue belongs to the letter rather
than the word — `tint` takes a per-letter function — so this is an array pushed in `buildCell`
beside `bodyMaterials`, reusing the `hue` already resolved there and pushing `null` on the
empty-glyph path that pushes `null` to the others:

```ts
  private readonly bodyLights: (LightBase | null)[] = [];
```
Hoist the tint expression rather than writing it twice — `applyLook` and `lightBase` resolving
against different hues is silent, and is the defect Task 4 exists to prevent:

```ts
    const bodyTint = tintMaterialOf(spec) === 'body' ? hue : undefined;
```
```ts
    this.bodyLights.push(lightBase(look, bodyTint));
```

Clear it in `dispose` where `bodyMaterials.length = 0`.

Import `lightBase` and `type LightBase` from `./looks.js` alongside the existing `frameOwnedBase`.
Then in the `body` branch. Key it on `partSlot`, not on `part.letter.index`: `LetterInfo.index` is
the letter's place in the word, which `regroup` renumbers, while `bodyLights` is filled per slot.

```ts
    if (part.kind === 'body') {
      const material = mesh.material as THREE.MeshPhysicalMaterial;
      const light = this.bodyLights[this.partSlot[index] as number];
      if (light) material.emissive.setHex(litEmissive(light.emissive, light.hue, out.light));
      setEmissiveIntensity(material, this.bodyBase.emissiveIntensity * out.gain);
      return;
    }
```

`apply`'s per-letter loop already resets `emissiveIntensity` every frame for every letter, retired
ones included, because `retiredPart` skips `writePart` for a letter a regroup dropped. `emissive` now
needs the same reset beside it — otherwise a letter that was lit when it was dropped keeps that lamp
frozen on it for the whole exit:

```ts
        const light = this.bodyLights[i];
        if (light) material.emissive.setHex(light.emissive);
```

For a `run` part, the hue is the run's own colour, and the light adds into the vertex colour
already being written. Replace the colour computation with:

```ts
    const base = this.partBaseColor[index] as number;
    const color = this.partColor
      .setHex(litEmissive(out.color ?? base, base, out.light))
      .multiplyScalar(out.gain);
```

- [x] **Step 6: Thread the context through `applyEffects`**

Change `apply(driver, elapsed)` to `apply(driver, elapsed, ctx: FrameCtx)`, pass `ctx` down to
`applyEffects(elapsed, ctx)`, and pass it to the piece: `effect.piece.at(t, part, ctx)`.

- [x] **Step 7: Add the extent accessor**

`fromPointer` needs the word's real extent to map into, and the design records that it is not
centred on zero — `KLIEG` gives `x ∈ [-1.72, 0.89]`.

**It must be the box of the letters' ink, not of their origins.** `part.x`/`part.y` are the glyph
origin and the baseline, and `placement.ts` sets `y = -line * LINE_HEIGHT_EM` — constant per line.
So a box built from `part.x`/`part.y` alone has **zero height on any single-line sign**, and Task 7's
mapping would hand every pointer position the same `y`, costing `fromPointer` its vertical tracking
entirely. On x it is short by the last glyph's advance.

Fold each glyph's own bounds in, the way `fitOf` already does with `y + geoMinY[i]`. `geoMinY`/
`geoMaxY` are per-slot on `Word`; store `geoMinX`/`geoMaxX` beside them from the same
`geo.boundingBox`, and offset them by the part's own `x`/`y` so the box stays in the frozen pool's
space. Glyph bounds are a property of the glyph, not of the layout, so they are constant across a
regroup and mixing them with a frozen `part.x` is consistent.

Test it on a single-line word: the extent must have non-zero height, and must be wider than the
span of the origins alone.

```ts
  /**
   * The ink bounding box of the part pool in layout space, or null before any part exists.
   * Describes the pool as built: `regroup` re-lays the letters and leaves the pool alone.
   * Each glyph's own bounds are folded in the way `fitOf` does. A box of origins alone would have
   * zero height on a single-line sign, since every letter on a line shares its baseline.
   */
  partExtent(): { minX: number; maxX: number; minY: number; maxY: number } | null {
    if (this.parts.length === 0) return null;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < this.parts.length; i++) {
      const part = this.parts[i] as PartInfo;
      const slot = this.partSlot[i] as number;
      minX = Math.min(minX, part.x + (this.geoMinX[slot] ?? 0));
      maxX = Math.max(maxX, part.x + (this.geoMaxX[slot] ?? 0));
      minY = Math.min(minY, part.y + (this.geoMinY[slot] ?? 0));
      maxY = Math.max(maxY, part.y + (this.geoMaxY[slot] ?? 0));
    }
    return { minX, maxX, minY, maxY };
  }
```

- [x] **Step 8: Typecheck and run everything**

Run: `npm run check`
Expected: PASS. `index.ts` will not compile until it passes a ctx — fix it by passing
`{ pointer: null, pointerInWord: null, dt }` at the call site for now; Task 7 fills it in.

- [x] **Step 9: Commit**

```bash
git add packages/core/src/render/word.ts packages/core/test/render/word-light.test.ts packages/core/src/index.ts
git commit -m "resolve lamp light onto a part's material"
```

---

### Task 6: `lighting` becomes a slot

**Files:**
- Modify: `packages/core/src/render/lighting.ts`
- Test: `packages/core/test/render/lighting.test.ts`

- [x] **Step 1: Write the failing test**

Append to `packages/core/test/render/lighting.test.ts`:

```ts
import { mergeEnv, sweep, track } from '../../src/render/lighting.js';

const CTX = { pointer: null, pointerInWord: null, dt: 16 };

describe('sweep', () => {
  it('turns a full rotation over its own period', () => {
    const piece = sweep({ periodMs: 1000 });
    expect(piece.duration).toBe(1000);
    expect(piece.env(0, CTX).yaw).toBeCloseTo(0);
    expect(piece.env(0.5, CTX).yaw).toBeCloseTo(Math.PI);
  });
});

describe('mergeEnv', () => {
  it('rests flat', () => {
    expect(mergeEnv([])).toEqual({ yaw: 0, pitch: 0 });
  });

  // Additive, like the pose compositor: two layers must both be visible in the result.
  it('sums yaw and pitch across layers', () => {
    const merged = mergeEnv([{ yaw: 1, pitch: 0.2 }, { yaw: 0.5 }, { pitch: -0.1 }]);
    expect(merged.yaw).toBeCloseTo(1.5);
    expect(merged.pitch).toBeCloseTo(0.1);
  });
});

describe('track', () => {
  it('holds the static pose until a pointer has been seen', () => {
    const piece = track();
    piece.env(0, CTX);
    expect(piece.env(0, CTX)).toEqual({ yaw: 0, pitch: 0 });
  });

  it('swings less on pitch than on yaw', () => {
    const piece = track();
    const ctx = { pointer: { x: -1, y: -1 }, pointerInWord: null, dt: 100_000 };
    piece.env(0, ctx);
    const out = piece.env(0, ctx);
    expect(Math.abs(out.pitch as number)).toBeLessThan(Math.abs(out.yaw as number));
  });

  it('takes its ranges from the caller', () => {
    const piece = track({ yawRange: 1, pitchRange: 0.5, followMs: 1 });
    const ctx = { pointer: { x: 1, y: 1 }, pointerInWord: null, dt: 100_000 };
    piece.env(0, ctx);
    const out = piece.env(0, ctx);
    expect(out.yaw).toBeCloseTo(1);
    expect(out.pitch).toBeCloseTo(0.5);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/test/render/lighting.test.ts`
Expected: FAIL — `sweep`, `track` and `mergeEnv` are not exported.

- [x] **Step 3: Rewrite `lighting.ts`**

Keep `LightingName`, `LIGHTING` and `envRotationAt` exactly as they are — the existing tests cover
them and the names stay as presets. Add:

```ts
export interface EnvOffset {
  yaw?: number;
  pitch?: number;
}

export interface EnvPiece {
  /** Milliseconds for one pass. Zero holds still. */
  duration: number;
  /** `t` is normalized 0..1 within this pass. */
  env(t: number, ctx: FrameCtx): EnvOffset;
}

/** Everything `mergeEnv` resolved. Both axes rest at 0. */
export interface ResolvedEnv {
  yaw: number;
  pitch: number;
}

/** Additive, matching the pose compositor: layering two pieces must show both. */
export function mergeEnv(offsets: readonly EnvOffset[]): ResolvedEnv {
  let yaw = 0;
  let pitch = 0;
  for (const o of offsets) {
    yaw += o.yaw ?? 0;
    pitch += o.pitch ?? 0;
  }
  return { yaw, pitch };
}

export function sweep(spec: { periodMs?: number } = {}): EnvPiece {
  const periodMs = spec.periodMs ?? LIGHTING.sweep.periodMs;
  return { duration: periodMs, env: (t) => ({ yaw: t * TAU }) };
}

export function still(): EnvPiece {
  return { duration: 0, env: () => ({}) };
}

export interface TrackSpec {
  /** Radians the environment swings between opposite edges of the canvas. */
  yawRange?: number;
  /** Radians on the other axis. Shallower than yaw: tipping the studio far swings its floor into frame. */
  pitchRange?: number;
  /** Milliseconds to cover ~63% of the way to a new pointer position. Zero snaps. */
  followMs?: number;
}

/**
 * Aims the environment at the pointer. Not a light anywhere: it turns the same scene-wide knob
 * `sweep` turns, from position instead of time. For a cursor that lights the letter under it,
 * see `lamp`.
 */
export function track(spec: TrackSpec = {}): EnvPiece {
  const yawRange = spec.yawRange ?? YAW_RANGE;
  const pitchRange = spec.pitchRange ?? PITCH_RANGE;
  const followMs = spec.followMs ?? FOLLOW_MS;
  let yaw = 0;
  let pitch = 0;
  return {
    duration: 0,
    env(_t, ctx) {
      if (ctx.pointer) {
        const k = followMs > 0 ? 1 - Math.exp(-Math.max(0, ctx.dt) / followMs) : 1;
        yaw += (ctx.pointer.x * yawRange - yaw) * k;
        pitch += (ctx.pointer.y * pitchRange - pitch) * k;
      }
      return { yaw, pitch };
    },
  };
}

export const ENV_PIECES = {
  sweep,
  static: still,
  pointer: track,
} satisfies Record<LightingName, () => EnvPiece>;
```

`still` rather than `static`: `static` is a reserved word and cannot be a function declaration name.

`satisfies` rather than an annotation, matching `EFFECTS` in `effects/pieces.ts`, which carries the
comment arguing for it. An annotation erases each factory's own spec parameter, so
`ENV_PIECES.sweep({ periodMs: 1000 })` would stop compiling while still working at runtime.

`followMs > 0` guards the follow: `Math.exp(-0 / 0)` is `NaN`, and because `track` accumulates its
ease in a closure rather than recomputing it, one `NaN` frame means the piece never returns a number
again for its whole life. Zero reads as "snap", which is the only sensible meaning.

- [x] **Step 4: Run the test**

Run: `npx vitest run packages/core/test/render/lighting.test.ts`
Expected: PASS — the new cases plus every existing `envRotationAt` and `PointerLight` case.

- [x] **Step 5: Commit**

```bash
git add packages/core/src/render/lighting.ts packages/core/test/render/lighting.test.ts
git commit -m "make lighting pieces that compose"
```

---

### Task 7: Wire the slot and the pointer into the render loop

**Files:**
- Modify: `packages/core/src/index.ts:186` (the `lighting` option), `:283`, `:359-362`, `:469`, `:503-515`
- Modify: `packages/core/src/motion/types.ts`, `packages/core/src/motion/compositor.ts:53-54`
- Test: `packages/core/test/render/lighting.test.ts`

- [x] **Step 1: Widen the option**

In `packages/core/src/index.ts`:

```ts
export type LightingSlot = LightingName | EnvPiece | (LightingName | EnvPiece)[];

  /** How the environment lights the type. `sweep` rakes the highlight, `static` holds it still.
   * Layers compose: `['sweep', track({ pitchRange: 0.1 })]`. */
  lighting?: LightingSlot;
```

- [x] **Step 2: Resolve it**

```ts
function resolveLighting(slot: LightingSlot): EnvPiece[] {
  const one = (s: LightingName | EnvPiece): EnvPiece =>
    typeof s === 'string' ? ENV_PIECES[s]() : s;
  return Array.isArray(slot) ? slot.map(one) : [one(slot)];
}
```

and in `run`, replace the `const lighting = …` / `tracksPointer` lines with
`const envPieces = resolveLighting(opts.lighting ?? 'sweep');`

**Resolve once per run, never inside the frame callback.** `track` accumulates its ease in a
closure, so rebuilding it every frame pins it at `1 - e^(-16/90)` — about 16% of the way to the
pointer, forever. It reads as a damping bug rather than a lifecycle one.

- [x] **Step 3: Build the context each frame**

Replace the `PointerLight` instance at `:283` with a canvas-relative pointer. The bug this fixes is
that `aimAt` normalized against `globalThis.innerWidth/innerHeight` — the viewport, never the box.

```ts
  let pointerClient: { x: number; y: number } | null = null;
  const onMove = (event: PointerEvent) => {
    pointerClient = { x: event.clientX, y: event.clientY };
  };
  globalThis.addEventListener('pointermove', onMove, { passive: true });
```

and per frame, before `word.apply`:

```ts
      let pointer: FrameCtx['pointer'] = null;
      let pointerInWord: FrameCtx['pointerInWord'] = null;
      const box = stage.canvas?.getBoundingClientRect();
      if (pointerClient && box && box.width > 0 && box.height > 0) {
        const nx = ((pointerClient.x - box.left) / box.width) * 2 - 1;
        const ny = ((pointerClient.y - box.top) / box.height) * 2 - 1;
        // FrameCtx promises -1..1, and the listener is document-wide: a pointer beside a small
        // anchored canvas would otherwise aim past every range that scales it.
        pointer = { x: Math.max(-1, Math.min(1, nx)), y: Math.max(-1, Math.min(1, ny)) };
        const extent = word.partExtent();
        if (extent && extent.maxX > extent.minX && extent.maxY > extent.minY) {
          // The word is not centred on zero, so map into its real extent rather than scaling.
          // y flips: clientY grows downward and layout y grows upward, so passing the pointer
          // straight through moves the lamp opposite the cursor on a multi-line sign.
          pointerInWord = {
            x: extent.minX + ((pointer.x + 1) / 2) * (extent.maxX - extent.minX),
            y: extent.maxY - ((pointer.y + 1) / 2) * (extent.maxY - extent.minY),
          };
        }
      }
      const ctx: FrameCtx = { pointer, pointerInWord, dt: still ? Number.POSITIVE_INFINITY : dt };
```

A degenerate extent leaves `pointerInWord` null, which `fromPointer` already reads as rest — better
than mapping every pointer position onto one constant and calling it tracking.

**The extent describes the pool as it was built.** `regroup` re-lays the letters but deliberately
leaves the part pool alone, so after one, a pointer at fraction *f* across the canvas lights whatever
was at fraction *f* in the original layout. Recomputing `PartInfo.x`/`y` per frame is the real fix
and it is not this task's to make — `stagger`'s positional ordering reads the same fields and would
change behavior on every regroup. Leave it; Task 9 should sweep the pointer across a regrouped sign
and record what it looks like.

- [x] **Step 4: Drive the environment from the merged pieces**

Replace the whole `envDriven` / `tracksPointer` block at `:507-515` with:

```ts
          const env = mergeEnv(
            envPieces.map((piece) =>
              piece.env(piece.duration > 0 ? (elapsed % piece.duration) / piece.duration : 0, ctx),
            ),
          );
          stage.scene.environmentRotation.x = env.pitch;
          stage.scene.environmentRotation.y = env.yaw;
```

Pass `ctx` to `word.apply(driver, elapsed, ctx)` at `:469`, and remove the `onMove` listener
wherever the effect settles, beside the other teardown.

- [x] **Step 5: Leave `slotDrivesEnv` to Task 8**

Stop *reading* `slotDrivesEnv` here — Step 4 already does — but delete nothing. The removal reaches
further than this task's files: `CycleSpec.envRotation` (`motion/build.ts`) is a documented public
option, so deleting `MotionPiece.envRotation` is a `tsc` error there and a README change. Task 8
owns the public surface and does it in one piece.

Between this task and that one, `cycle(3400, { envRotation: true })` sets a flag nothing reads. That
is a public option silently doing nothing — the exact defect class this branch exists to fix — so it
must not outlive Task 8.

- [x] **Step 6: Run everything**

Run: `npm run check`
Expected: PASS. Any failure naming `slotDrivesEnv` or `envRotation` is a leftover reference.

- [x] **Step 7: Commit**

```bash
git add packages/core/src packages/core/test
git commit -m "drive the environment from a composable lighting slot"
```

---

### Task 8: Public surface and CHANGELOG

**Files:**
- Modify: `packages/core/src/index.ts` (exports)
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **Step 1: Export the new surface**

```ts
export { type LampSpec, along, fixed, fromPointer, lamp, type LightPose, type LightSource, orbit, type OrbitSpec } from './effects/lamp.js';
export { ENV_PIECES, type EnvOffset, type EnvPiece, mergeEnv, type ResolvedEnv, still, sweep, track, type TrackSpec } from './render/lighting.js';
```

`LightingSlot` is already exported at `index.ts:171` and `resolveLighting` lives in
`render/lighting.ts` beside it — exported for its test, and deliberately not in the barrel. Do not
add a second `export type { LightingSlot }`.

Delete `PointerLight` and `envRotationAt` from `render/lighting.ts`, their exports, and their tests.
`track` carries its own follow and `sweep` its own period, so once Task 7 rewrites the render loop
nothing calls either. `PointerLight`'s viewport normalization is the bug the Fixed note below names —
it must not survive as a second, wrong way to do this.

**Three things must survive that deletion**, and two of them sit inside the block a reader would
take for the `PointerLight` section. Keep `YAW_RANGE`, `PITCH_RANGE` and `FOLLOW_MS` with their doc
comments — they are `track`'s defaults, and `PITCH_RANGE`'s note about a studio's floor swinging
into frame is not derivable from anything else — but fix `YAW_RANGE`'s doc, which still says
"viewport" where it means the canvas box. That is the exact word the Fixed note below calls a bug,
and the public `TrackSpec.yawRange` beside it already says "canvas". Move `envRotationAt`'s
"effect-relative: absolute
clock time would start every effect at an arbitrary angle" onto `sweep`, whose `t` still carries
that constraint. `tsc` catches a deleted binding; it does not catch a deleted reason.

**Collapse what is left of `LIGHTING` rather than leaving it vestigial.** With `envRotationAt` gone,
nothing reads `tracksPointer` or the `static`/`pointer` periods, and `sweep()` reads only
`LIGHTING.sweep.periodMs`. Neither `LIGHTING` nor `LightingMode` is exported from the barrel, so
this costs no public surface: replace the record with `const SWEEP_PERIOD_MS` carrying the period's
doc line, delete `LightingMode`, drop the `tracksPointer` assertion from `lighting.test.ts`, and
derive `LIGHTING_NAMES` from `ENV_PIECES` — which is the rule `index.ts` already states, "read off
the records the effect itself indexes". `Object.keys(ENV_PIECES)` preserves the order `index.test.ts`
pins.

Also re-export `LightOffset` **and `FrameCtx`** from `./effects/types.js` beside the existing
`PartOffset` export. `FrameCtx` names a parameter of three exported types — `EffectPiece.at`,
`EnvPiece.env` and `LightSource` — so without it a consumer writing a standalone source or piece,
which is the documented reason those types are public, cannot type the argument.
Task 1 added it as a named interface following the `FlakeSpec` precedent but deliberately left the
barrel alone, since `PartOffset` already re-exports and consumers get the shape structurally. It
wants the name once callers are writing lamps.


- [ ] **Step 1b: Retire `envRotation` in one piece**

Task 7 stopped reading it and deleted nothing, because the field reaches public API. The whole set:

- `motion/types.ts` — drop `envRotation?: boolean` from `MotionPiece` and its doc line.
- `motion/compositor.ts` — drop `slotDrivesEnv`. It is not in the barrel; `index.ts` was its only
  caller and no longer reads it.
- `motion/build.ts` — drop `CycleSpec.envRotation` (`:121`) and the flag it threads (`:156`), where
  `cycle` collapses to a single `return`.
- Delete the assertions at `test/motion/compositor.test.ts:243-245`, `test/motion/build.test.ts:172`
  and `test/readme.test.ts:45`.
- `README.md:330` — rewrite the sentence beginning "`envRotation: true` rakes the environment
  highlight", which documents an option that no longer exists. The replacement is `lighting`.

One of the tests Task 7 found here (`lets a caller-supplied active piece rake the highlight`) was a
false green even before this change: the default `sweep` turns the environment anyway, so it passed
without `envRotation` doing anything. Do not port its assertion forward.

- [ ] **Step 1c: Five doc lines the exported surface is wrong without**

Each is one clause, and each is a silent wrong answer rather than a restatement:

- **`track()` is stateful.** It accumulates its ease in a closure, and `resolveLighting` hands a
  caller-supplied piece back by reference. So one `track()` shared across two concurrent fires is
  stepped twice per frame, and a second sequential fire starts from the first's leftover angle
  rather than rest. Say on `track` and on `FireOptions.lighting` that a constructed `track()`
  belongs to one fire. The name form (`lighting: 'pointer'`) is safe — it builds a piece per run.
- **`FrameCtx.dt` is `Infinity` under reduced motion.** The doc says "Milliseconds since the previous
  frame." A piece that integrates (`phase += ctx.dt * rate`) then goes to `Infinity`, and the next
  subtraction to `NaN`, permanently — the defect `track`'s `followMs` guard already exists for. Say
  it must snap, not integrate.
- **`FrameCtx.pointer` is +y down; `FrameCtx.pointerInWord` is +y up.** Two fields on one object with
  opposite conventions, and neither says which. This is what the Task 7 y-inversion bug was.
- **`pointerInWord` stretches, it does not project.** The canvas's full −1..1 maps onto the word's
  extent per axis, so the lamp sits under the cursor only when the word fills the canvas; on a small
  anchored sign it travels several times faster. That is a deliberate reach guarantee — the far
  corners must be able to light every part — but the current doc, "the same pointer in the word's
  layout space", oversells it as a projection.
- **`EnvPiece.duration: 0` does not mean "holds still".** `track` reports 0 and moves. It means
  aperiodic: `t` is always 0.

- [ ] **Step 2: Write the CHANGELOG entry**

Under `## Unreleased`:

```markdown
### Added
- `lighting` accepts a piece or an array of them, not only a name. `sweep({ periodMs })`,
  `still()` and `track({ yawRange, pitchRange, followMs })` expose what were module constants.
- `lamp()`, an effect piece that puts light on the parts near a position, with `fixed`, `orbit`,
  `along` and `fromPointer` as sources.
- `PartOffset.light`, an additive channel carrying a lamp's colour and amount.

### Fixed
- A tracked pointer normalized against the viewport rather than the canvas box, so an anchored
  sign in a small box only ever saw a slice of the yaw range.

### Removed
- `MotionPiece.envRotation`. Declare an env piece in `lighting` instead.
```

- [ ] **Step 3: Document the option in the README**

Find the `lighting` row in the options table and widen it to name the slot form and `lamp`.

**Give `lamp` its own entry under `### effects`.** `flicker`, `hue` and `roving` each get a
signature and their spec fields there; `lamp` is the branch's headline piece and currently appears
only as two cross-references. A reader who follows the CHANGELOG's "put a `lamp` in `effects`" lands
in a section that never mentions it. Cover the four sources and say which of them needs a pointer.

**Document `sweep`'s spec.** `TrackSpec` documents every field and `sweep` takes a bare inline
`{ periodMs?: number }` with none, while the CHANGELOG advertises `sweep({ periodMs })`.

**Say that layers keep their own periods.** The design's claim is "the same grammar as `active`", and
the *shape* matches exactly — a name, a piece, or an array. The layering does not: `Timeline.poseAt`
gives every member of a motion slot one shared `t` from the slot's duration, with phase weights,
while each lighting piece gets its own `t` from its own `duration` and there are no phases. So
`['sweep', sweep({ periodMs: 1000 })]` runs two independent periods, which `active` cannot express.
The lighting behavior is the one we want; a reader who learned layering from `active` will expect
phase-lock and needs telling.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src packages/core/test CHANGELOG.md README.md
git commit -m "export the lighting surface and record the change"
```

The staging list covers more than the three files at the top of this task: Step 1b reaches
`motion/types.ts`, `motion/compositor.ts`, `motion/build.ts` and three test files, and Steps 1 and 1c
reach `render/lighting.ts` and `effects/types.ts`.

Add `CycleSpec.envRotation` to the Removed block beside `MotionPiece.envRotation` — it is the half of
that removal a caller actually wrote. `PointerLight` and `envRotationAt` need no entry: neither was
ever in the barrel.

---

### Task 9: Prove it reaches the screen

Nothing above is evidence. The whole reason `gain` was the wrong channel is that the effect ran,
the compositor merged, the material was written, and the image did not change.

**Files:**
- Create: `spikes/lamp-proof.mjs`
- Modify: `spikes/.gitignore`

- [ ] **Step 1: Write the proof script**

Copy `spikes/lamp-blend.mjs` to `spikes/lamp-proof.mjs` and replace its render loop body with a
lamp-on/lamp-off pair per look, driving the real `lamp()` through `effects` rather than a hand-rolled
piece. Its page should import `lamp` and `fixed` from `klieg` and fire:

```js
effects: [{ piece: lamp({ source: fixed(0, 0), radius: 0.6, strength: 2.5 }), target: { kind: 'body', by: 'index' } }]
```

Exit non-zero when any look renders lamp-on and lamp-off to the same md5, the way
`tint-matrix.mjs` does for tints.

- [ ] **Step 2: Build and run it**

Run: `npm run build -w klieg && node spikes/lamp-proof.mjs --looks gold,chrome,gem,velvet,neon,tubing`
Expected: every look reports `reads`. A `NO-OP` row means the lamp never reached the GPU on that
look, which is the exact failure this plan exists to fix.

**`tubing` is in the list because none of the other five has a single `run` part**, and a lamp on a
run takes a different write path from a lamp on a body — a vertex-buffer write gated on
`partReadsRunColor` and an early return when the geometry carries no run-colour attribute, versus
one `material.emissive.setHex`. The run path has strictly more places to silently do nothing, and it
is the path under the two looks people will most want to light. Target it with `{ kind: 'run' }`.

**Render `lamp({ source: orbit() })` on its bare defaults too.** Task 8 measured it and found zero
lit samples across a full pass on a short sign: `orbit`'s default radius is 2 em and a lamp's default
reach is 0.5 em, so the two defaults compose into a lamp that lights nothing. A part placed out at
2 em does light, so the source works and the defaults do not meet. This script exists to catch
exactly that, and a `NO-OP` row here is a real finding about the API rather than a bug in the render
— decide whether the defaults move, and record which.

`sequin` will not pass and is out of scope — it has zero `run` parts and a near-black body. See
the findings note.

**Sweep the pointer across a small anchored sign**, not only a fullscreen one. `pointerInWord`
stretches the canvas onto the word's extent per axis rather than projecting through the camera, so
the lamp is under the cursor only when the word fills the frame. `projectLetters` in
`text/projection.ts` is a true inverse and `index.ts` already drives it for the DOM layer. Whether
the stretch reads as wrong is a pixels question; decide it here.

Three things the pixels are the only judge of, beyond the no-op check above. A lamp on a **run**
passes the run's own colour as the hue and not `out.color`, so a part recoloured by `hue()` reflects
the colour it started with — deliberate, and surprising enough to look at. On a **gradient** look the
lamp multiplies against one blueprint stop while the pixel colour comes from the ramp in the shader,
so lit and unlit stops disagree; this is pre-existing for `gain` and `color` and the lamp inherits
it. And a lamp targeting **every** run rewrites and re-uploads each run's vertex buffer every frame —
already true of `gain` and `chase`, but a lamp is the first effect that invites `by: 'all'`.

- [ ] **Step 3: Render the overlap**

Task 5 ships the light channel summing in sRGB rather than in linear radiance. **Do not try to judge
this from an offset seam.** Two half-strength lamps whose pools cross will read darker at the seam
than one full lamp under *either* scheme, because the two falloff curves generally do not sum to 1
there — the geometry swamps the colour space and the test fires either way.

Nor does strength discriminate it: `amount` scales linearly in both schemes, so two coincident lamps
at half strength and one at full strength are byte-identical whichever is in use.

**What discriminates is the colour decode.** `rgb()` divides the byte by 255 with no gamma decode, so
a mid-grey lamp contributes 0.502 where linear radiance would give it 0.216. Render two frames, same
position, same everything else:

- a lamp at `color: 0x808080, amount: 1`
- a lamp at `color: 0xffffff, amount: 0.5`

Under the shipped sRGB sum those are the same light (0.502 against 0.500) and the two frames must
md5 to the same value. Under a linear sum they differ by 2.3x and plainly do not. That is one
assertion, and it either holds or the channel is not doing what Task 5 says.

Then render the offset seam as the thing you **look at** rather than assert on, and attach it — a
seam nobody looked at is the same evidence `gain` had.

- [ ] **Step 3b: Render the pointer, and a regrouped sign**

The md5 proof drives `fixed(0, 0)`, so `fromPointer` — the default source, and the headline of the
whole feature — is never rendered by any of this. The script already drives a real page, so
`page.mouse.move()` gives a pointer-off and pointer-over pair for nothing.

That pair is also the only place the open question gets an answer: `pointerInWord` **stretches** the
canvas onto the word's extent per axis rather than projecting through the camera, so on a sign that
does not fill the frame the lamp travels further than the cursor. Render a small anchored sign and
look at whether the light sits where the cursor is. If it reads wrong, `projectLetters` in
`text/projection.ts` is a true inverse and `index.ts` already drives it for the DOM layer. Record the
answer either way — the README currently promises the light is under the cursor, and nothing has
measured that.

Then sweep the pointer across a sign that has **regrouped**. The part pool is a construction-time
snapshot, so a pointer at fraction *f* lights whatever was at *f* in the original layout. The handoff
has promised this render since Task 5 and nothing has produced it. If it reads acceptably, say so and
close it; if not, it is its own change, not this branch's.

- [ ] **Step 4: Ignore its output**

`spikes/.gitignore` already carries `lamp-*/`, which covers it. Confirm with `git status`.

- [ ] **Step 5: Commit**

```bash
git add spikes/lamp-proof.mjs
git commit -m "prove the lamp reaches the screen on every look it claims"
```

---

## Not in this plan

- **Construction versus material.** `LookName` fuses materials with constructions. Its own design.
- **`envMapIntensity`.** It has never been applied on any look and fixing it moves every visual
  baseline. Its own change — see the findings note.
- **`sequin`.** Needs a `'chunk'` `PartKind`.
- **Real three.js lights.** A spike for ambience, not an API.
