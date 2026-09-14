# `hinge` and signals — design

**For:** whoever builds or later reads `hinge`. **Answers:** how an effect piece comes to depend on
something outside the clock — the cursor, to begin with — and why that takes two modes rather than
one.

**Status: unbuilt.** Nothing below is implemented. Written 2026-09-14 against `main` at klieg
0.11.0.

## What this is

An effect piece is a function of time: `at(t, part, ctx)` runs on a pass and loops. `hinge` makes a
piece a function of a **signal** as well — a 0..1 scalar resolved per part per frame. The first
signal is `near`, the cursor's proximity to a part, so a tube run can flicker harder as the pointer
approaches it.

The generality is the point. `near` is one signal among several the same shape will carry, and what
proximity *does* is authored per use rather than chosen from a list.

## Why a wrapper cannot just turn the knob

`flicker(spec)` is a factory that closes over its spec and precomputes a step count, a pass length
and a gate share. Its `unrest` is a probability tested **inside** `at`, before anything is emitted:
a step that does not bite returns `{ gain: 1 }`, which is indistinguishable from a step that had no
chance of biting. So a wrapper downstream sees rest and has nothing to scale. Depth is reachable
after the fact; rate is not.

Rebuilding the inner per frame would reach it, and cannot be done: `EffectFrame.resolve` reads
`effect.piece.duration` once per effect, before the per-part loop (`effects/frame.ts:77`), so a
piece whose duration varies by part has no coherent pass.

That single constraint produces the two modes.

## The shape

```ts
/** A scalar a piece can hinge on: 0..1, resolved per part, per frame. */
export type Signal = (t: number, part: PartInfo, ctx: FrameCtx) => number;

export function near(spec?: NearSpec): Signal;
export interface NearSpec {
  /** How far influence reaches, in em of layout space. Default 0.5, as `LampSpec.radius`. */
  radius?: number;
  /** Where the signal is measured from. Defaults to the cursor. */
  source?: LightSource;
}

export function hinge(signal: Signal, make: (k: number) => EffectPiece, spec?: StopsSpec): EffectPiece;
export function hinge(signal: Signal, piece: EffectPiece, spec?: BlendSpec): EffectPiece;
```

The two overloads discriminate on whether the second argument is callable.

`near` takes a `LightSource`, the pluggable pose that `lamp` already uses, so `fixed`, `orbit`,
`along` and `fromPointer` all work as signal origins on day one. `near({ source: orbit() })` is a
clock-driven sweep across the word with no cursor involved, for free. Distance is measured from the
pose to the part's **ink center**, not its letter origin, matching `lamp`; falloff is lamp's curve,
`(1-u)²(1+2u)` — flat at the center, zero at the edge. A source returning `null`, which
`fromPointer` does until the pointer has been inside the canvas, yields 0, so an untouched page
shows the `k = 0` authoring rather than something parked mid-word.

### Mode one — `stops`, for knobs only a rebuild can reach

```ts
interface StopsSpec { stops?: number }   // default 8, minimum 2
```

`make` is called **at construction**, once per stop, at `i / (stops - 1)` for `i` in `0..stops-1`,
so both ends are hit exactly. The built pieces are kept. At draw time the signal is evaluated and
the nearest stop is taken, `Math.round(k * (stops - 1))`, which puts quantization error at
±1/(2(stops−1)) — ±0.036 at the default.

Every stop must report the same `duration`, or the constructor throws naming both values. Varying
`unrest` or `depth` across stops leaves duration alone; varying `spell` or `calm` does not, and the
resulting phase chaos is invisible in the source and obvious on screen. A loud failure at build
time is the cheap version of that lesson.

No allocation per frame, and one `at` call per part — the same cost the piece had unwrapped.

### Mode two — `blend`, continuous, for channels scalable after the fact

```ts
interface BlendSpec { blend?: (offset: PartOffset, k: number) => PartOffset }
```

The piece is built once and run unchanged; the signal scales what it emitted. No rebuild, so no
quantization — but only the channels with an identity to fade toward can move:

| channel | rest | blended |
|---|---|---|
| `gain` | 1 | `1 + (gain − 1) × k` |
| `scale` | 1 | `1 + (scale − 1) × k` |
| `position`, `rotation` | 0 | each component × k |
| `crawl` | 0 | `crawl × k` |
| `dark` | 0 | `dark × k` |
| `light.amount` | 0 | `amount × k` |
| `color` | — | passed through unchanged |

`color` is a replacement rather than a contribution, so there is no identity to lerp toward without
knowing the part's own color, which an offset does not carry. The default blend short-circuits:
**at `k ≤ 0` it returns `{}`**, no contribution at all, which is what keeps a color-writing piece
from staying awake at the far end of the falloff. Above zero, color passes through.

`blend` is overridable, and that is the escape hatch's own escape hatch — an author who wants
color handled differently writes it.

## Rest, and `turns`

`turns` hands a part over at the first moment the outgoing piece reports `isRest`. Both modes
preserve that. Continuous mode returns `{}` at `k = 0`, which is rest by construction. Factory mode
rests exactly when the piece `make` returned rests, so a `make` that never returns a resting piece
holds its part until `turns`' deadline — the caveat `hue` already carries.

`hinge` does not integrate, so `ctx.dt` being `Infinity` under reduced motion costs it nothing.

## What moves

`LightSource` and its factories live in `effects/lamp.ts` today, and `near` needs them without
needing lamps. A pure move, no behavior change:

- **`effects/source.ts`** (new) — `LightPose`, `LightSource`, `fixed`, `orbit`, `along`,
  `fromPointer`, and `falloff`, all lifted from `lamp.ts`.
- **`effects/signal.ts`** (new) — `Signal`, `near`.
- **`effects/hinge.ts`** (new) — the wrapper.
- **`effects/lamp.ts`** — keeps `LampSpec` and `lamp`; imports the rest.
- **`index.ts`** — re-exports the moved names from their new home, so the published surface is
  unchanged, and adds `hinge`, `near`, `Signal`, `NearSpec`, `StopsSpec`, `BlendSpec`.

`hinge` is a wrapper, so like `roving`, `intermittent` and `turns` it stays out of the `EffectName`
registry.

## Decided against

**One mode that rebuilds continuously.** It is the obvious unification and the duration read at
`frame.ts:77` forbids it.

**A modulation channel on `FrameCtx`.** Continuous and allocation-free, but every piece would have
to be taught to read it, a bare scalar means something different in each one, and `ctx` is shared
per frame so a wrapper would have to mutate and restore it per part.

**Knobs typed as `number | ((k: number) => number)`.** Continuous and explicit, but it touches every
piece's spec type, reaches only pieces klieg owns, and is a concession repeated per piece instead of
a mechanism.

## Tests

- `near` is 1 at the source, 0 at `radius`, 0 when the source returns `null`.
- `near` measures to the part's ink center, not the letter origin — two runs of one letter differ.
- `near({ source: orbit() })` sweeps with no pointer in `ctx`.
- `make` is called exactly `stops` times, all at construction and none during `at`.
- `k = 0` and `k = 1` reach the first and last stop exactly.
- Stops whose durations disagree throw, and the message names both.
- Continuous mode at `k = 0` satisfies `isRest`; a color-writing piece included.
- Continuous mode lerps `gain` toward 1 and scales `position` toward 0.
- `hinge` inside `turns` hands over, in both modes.
