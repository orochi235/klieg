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
| `packages/core/src/render/lighting.ts` | **Rewrite.** `EnvPiece`, `FrameCtx`, the `sweep`/`static`/`track` factories, and `mergeEnv`. `PointerLight` stays as `track`'s internals. |
| `packages/core/src/effects/lamp.ts` | **New.** `LightPose`, `LightSource`, the `fixed`/`orbit`/`along`/`fromPointer` sources, and `lamp()`. |
| `packages/core/src/effects/types.ts` | `PartOffset.light`, `ResolvedOffset.light`, `EffectPiece.at` gains a `ctx`. |
| `packages/core/src/effects/compositor.ts` | Sums the light channel. Stays pure — no three import. |
| `packages/core/src/render/looks.ts` | Exports `lightBase(look)` — the emissive a lamp adds onto, and the hue it multiplies. |
| `packages/core/src/render/word.ts` | Resolves the light channel onto materials; `partExtent()`; threads `ctx`. |
| `packages/core/src/index.ts` | `LightingSlot`, the ctx build from the canvas rect, and the render loop. |
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

**Files:**
- Modify: `packages/core/src/render/lighting.ts`
- Create: `packages/core/src/effects/lamp.ts`
- Test: `packages/core/test/effects/lamp.test.ts`

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/test/effects/lamp.test.ts`
Expected: FAIL — `packages/core/src/effects/lamp.js` does not exist.

- [ ] **Step 3: Add `FrameCtx` to lighting**

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

- [ ] **Step 4: Write the sources**

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

- [ ] **Step 5: Run the test**

Run: `npx vitest run packages/core/test/effects/lamp.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

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

- [ ] **Step 1: Write the failing test**

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
    expect(piece.at(0, partAt(1), NO_POINTER).light?.amount).toBeCloseTo(0);
    expect(piece.at(0, partAt(5), NO_POINTER).light?.amount).toBeCloseTo(0);
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

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/test/effects/lamp.test.ts -t "lamp"`
Expected: FAIL — `lamp` is not exported.

- [ ] **Step 3: Give `EffectPiece.at` the context**

In `packages/core/src/effects/types.ts`, change the `at` signature. A third parameter is additive:
an existing piece that declares two keeps typechecking.

```ts
export interface EffectPiece {
  /** Milliseconds for one pass. Loops. */
  duration: number;
  /** `t` is normalized 0..1 within this pass. */
  at(t: number, part: PartInfo, ctx: FrameCtx): PartOffset;
}
```

Import the type at the top: `import type { FrameCtx } from '../render/lighting.js';`

- [ ] **Step 4: Write `lamp`**

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

- [ ] **Step 5: Run the test**

Run: `npx vitest run packages/core/test/effects/lamp.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 6: Run the whole suite — the `at` signature touched every piece**

Run: `npm run typecheck && npx vitest run`
Expected: PASS. `flicker`, `hue`, `chase` and `roving` declare two parameters and are unaffected.

- [ ] **Step 7: Commit**

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

- [ ] **Step 1: Write the failing test**

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
});
```

Add `lightBase` to the file's existing import from `../../src/render/looks.js`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/test/render/looks.test.ts -t "lightBase"`
Expected: FAIL — `lightBase` is not exported.

- [ ] **Step 3: Export it**

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

export function lightBase(look: Look): LightBase {
  const spec = specOf(look);
  const params = resolveParams(spec);
  return {
    emissive: params.emissive,
    hue: params[tintTargetOf(params, spec.tintTarget)] as number,
  };
}
```

The declared override is `spec.tintTarget` — `LookSpec` has no `tint` field.

- [ ] **Step 4: Run the test**

Run: `npx vitest run packages/core/test/render/looks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

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

It matters only where two lamps overlap, which is why the design did not catch it. Ship the simple
version, then render two overlapping lamps and look at the seam — if it reads wrong, the fix is to
decode in `rgb()` and encode once in `litEmissive`, not to change the channel's shape. Add that
render to Task 9 either way.


This is the task no unit test can prove. Write the unit test anyway for the arithmetic, then prove
it on screen in Task 9.

**Files:**
- Modify: `packages/core/src/render/word.ts`
- Test: `packages/core/test/render/word-light.test.ts`

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/test/render/word-light.test.ts`
Expected: FAIL — `litEmissive` is not exported.

- [ ] **Step 3: Write the resolver**

In `packages/core/src/render/word.ts`, near `setEmissiveIntensity`:

```ts
const clamp255 = (n: number): number => Math.min(255, Math.max(0, Math.round(n)));

/**
 * Lamp light landing on a part: `base + lamp x hue`. Multiplying by the hue is what keeps a
 * material's identity — a white lamp on gold reflects gold, and adding white reflects cream.
 * @internal exported for test; not part of the public surface.
 */
export function litEmissive(base: number, hue: number, light: readonly number[]): number {
  if (!light[0] && !light[1] && !light[2]) return base;
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    const shift = 16 - i * 8;
    const b = (base >> shift) & 0xff;
    const h = ((hue >> shift) & 0xff) / 255;
    out.push(clamp255(b + (light[i] as number) * h * 255));
  }
  return ((out[0] as number) << 16) | ((out[1] as number) << 8) | (out[2] as number);
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run packages/core/test/render/word-light.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Apply it in `writePart`**

`writePart` currently branches on `part.kind`. Give each branch the light.

For a `body` part, the light lands on the material's emissive. Add one field beside `bodyBase`,
and set it on the line after `this.bodyBase = frameOwnedBase(spec);` (`word.ts:221`):

```ts
  private readonly bodyLight: LightBase;
```
```ts
    this.bodyLight = lightBase(spec);
```

Import `lightBase` and `type LightBase` from `./looks.js` alongside the existing `frameOwnedBase`.
Then in the `body` branch:

```ts
    if (part.kind === 'body') {
      const material = mesh.material as THREE.MeshPhysicalMaterial;
      material.emissive.setHex(litEmissive(this.bodyLight.emissive, this.bodyLight.hue, out.light));
      setEmissiveIntensity(material, this.bodyBase.emissiveIntensity * out.gain);
      return;
    }
```

For a `run` part, the hue is the run's own colour, and the light adds into the vertex colour
already being written. Replace the colour computation with:

```ts
    const base = this.partBaseColor[index] as number;
    const color = this.partColor
      .setHex(litEmissive(out.color ?? base, base, out.light))
      .multiplyScalar(out.gain);
```

- [ ] **Step 6: Thread the context through `applyEffects`**

Change `apply(driver, elapsed)` to `apply(driver, elapsed, ctx: FrameCtx)`, pass `ctx` down to
`applyEffects(elapsed, ctx)`, and pass it to the piece: `effect.piece.at(t, part, ctx)`.

- [ ] **Step 7: Add the extent accessor**

`fromPointer` needs the word's real extent to map into, and the design records that it is not
centred on zero — `KLIEG` gives `x ∈ [-1.72, 0.89]`.

```ts
  /** The bounding box of the part pool in layout space, or null before any part exists. */
  partExtent(): { minX: number; maxX: number; minY: number; maxY: number } | null {
    if (this.parts.length === 0) return null;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const part of this.parts) {
      minX = Math.min(minX, part.x);
      maxX = Math.max(maxX, part.x);
      minY = Math.min(minY, part.y);
      maxY = Math.max(maxY, part.y);
    }
    return { minX, maxX, minY, maxY };
  }
```

- [ ] **Step 8: Typecheck and run everything**

Run: `npm run check`
Expected: PASS. `index.ts` will not compile until it passes a ctx — fix it by passing
`{ pointer: null, pointerInWord: null, dt }` at the call site for now; Task 7 fills it in.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/render/word.ts packages/core/test/render/word-light.test.ts packages/core/src/index.ts
git commit -m "resolve lamp light onto a part's material"
```

---

### Task 6: `lighting` becomes a slot

**Files:**
- Modify: `packages/core/src/render/lighting.ts`
- Test: `packages/core/test/render/lighting.test.ts`

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/test/render/lighting.test.ts`
Expected: FAIL — `sweep`, `track` and `mergeEnv` are not exported.

- [ ] **Step 3: Rewrite `lighting.ts`**

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

/** Additive, matching the pose compositor: layering two pieces must show both. */
export function mergeEnv(offsets: readonly EnvOffset[]): { yaw: number; pitch: number } {
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
  yawRange?: number;
  pitchRange?: number;
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
        const k = 1 - Math.exp(-Math.max(0, ctx.dt) / followMs);
        yaw += (ctx.pointer.x * yawRange - yaw) * k;
        pitch += (ctx.pointer.y * pitchRange - pitch) * k;
      }
      return { yaw, pitch };
    },
  };
}

export const ENV_PIECES: Record<LightingName, () => EnvPiece> = {
  sweep,
  static: still,
  pointer: track,
};
```

`still` rather than `static`: `static` is a reserved word and cannot be a function declaration name.

- [ ] **Step 4: Run the test**

Run: `npx vitest run packages/core/test/render/lighting.test.ts`
Expected: PASS — the new cases plus every existing `envRotationAt` and `PointerLight` case.

- [ ] **Step 5: Commit**

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

- [ ] **Step 1: Widen the option**

In `packages/core/src/index.ts`:

```ts
export type LightingSlot = LightingName | EnvPiece | (LightingName | EnvPiece)[];

  /** How the environment lights the type. `sweep` rakes the highlight, `static` holds it still.
   * Layers compose: `['sweep', track({ pitchRange: 0.1 })]`. */
  lighting?: LightingSlot;
```

- [ ] **Step 2: Resolve it**

```ts
function resolveLighting(slot: LightingSlot): EnvPiece[] {
  const one = (s: LightingName | EnvPiece): EnvPiece =>
    typeof s === 'string' ? ENV_PIECES[s]() : s;
  return Array.isArray(slot) ? slot.map(one) : [one(slot)];
}
```

and in `fire`, replace the `const lighting = …` / `tracksPointer` lines with
`const envPieces = resolveLighting(opts.lighting ?? 'sweep');`

- [ ] **Step 3: Build the context each frame**

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
        pointer = {
          x: ((pointerClient.x - box.left) / box.width) * 2 - 1,
          y: ((pointerClient.y - box.top) / box.height) * 2 - 1,
        };
        const extent = word.partExtent();
        if (extent) {
          // The word is not centred on zero, so map into its real extent rather than scaling.
          pointerInWord = {
            x: extent.minX + ((pointer.x + 1) / 2) * (extent.maxX - extent.minX),
            y: extent.minY + ((pointer.y + 1) / 2) * (extent.maxY - extent.minY),
          };
        }
      }
      const ctx: FrameCtx = { pointer, pointerInWord, dt: still ? Number.POSITIVE_INFINITY : dt };
```

- [ ] **Step 4: Drive the environment from the merged pieces**

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

- [ ] **Step 5: Retire `slotDrivesEnv`**

Delete `slotDrivesEnv` from `packages/core/src/motion/compositor.ts` and its export from
`index.ts`. Delete `envRotation?: boolean` from `MotionPiece` in `packages/core/src/motion/types.ts`
and its doc line. Delete any test asserting on it.

- [ ] **Step 6: Run everything**

Run: `npm run check`
Expected: PASS. Any failure naming `slotDrivesEnv` or `envRotation` is a leftover reference.

- [ ] **Step 7: Commit**

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
export { type EnvOffset, type EnvPiece, type FrameCtx, mergeEnv, still, sweep, track, type TrackSpec } from './render/lighting.js';
export type { LightingSlot };
```

Also re-export `LightOffset` from `./effects/types.js` beside the existing `PartOffset` export.
Task 1 added it as a named interface following the `FlakeSpec` precedent but deliberately left the
barrel alone, since `PartOffset` already re-exports and consumers get the shape structurally. It
wants the name once callers are writing lamps.


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

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/index.ts CHANGELOG.md README.md
git commit -m "export the lighting surface and record the change"
```

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

Run: `npm run build -w klieg && node spikes/lamp-proof.mjs --looks gold,chrome,gem,velvet,neon`
Expected: every look reports `reads`. A `NO-OP` row means the lamp never reached the GPU on that
look, which is the exact failure this plan exists to fix.

`sequin` will not pass and is out of scope — it has zero `run` parts and a near-black body. See
the findings note.

- [ ] **Step 3: Ignore its output**

`spikes/.gitignore` already carries `lamp-*/`, which covers it. Confirm with `git status`.

- [ ] **Step 4: Commit**

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
