# Composable lighting — design

**For:** whoever implements composable lighting. **Answers:** what to build, what the spikes already
settled by rendering it, and which traps are silent.

## The problem

`lighting` takes one of three names — `sweep`, `static`, `pointer` — and every number behind them is
a module constant no caller can reach: `sweep`'s `periodMs: 3400`, and `YAW_RANGE`, `PITCH_RANGE`,
`FOLLOW_MS` (`render/lighting.ts`).

And `pointer` is not a light. It maps the cursor to `scene.environmentRotation` — x to yaw over ±90°,
y to pitch over ±20° — which is one scene-wide value, so hovering over the **K** does not light the K
any differently. It turns the same knob `sweep` turns, from position instead of time.

## Two axes, two homes

Lighting is two orthogonal things, and they do not belong in one slot:

- **The environment's pose** — scene-wide, one yaw and pitch. This stays `lighting`.
- **Light landing on a part** — per-part, positional, with falloff. This goes in `effects`, which is
  already the per-part-appearance channel and already carries a `target` selector.

## 1. `lighting` becomes a slot

Same grammar as `active`:

```ts
interface EnvPiece {
  duration: number;
  env(t: number, ctx: FrameCtx): { yaw?: number; pitch?: number };
}
type LightingSlot = LightingName | EnvPiece | (LightingName | EnvPiece)[];

lighting: ['sweep', track({ pitchRange: 0.1 })]
```

`yaw` and `pitch` sum across layers, matching the pose compositor. The three names become factories
whose arguments are today's constants: `sweep({ periodMs })`, `static()`,
`track({ yawRange, pitchRange, followMs })`. The bare names keep working as presets.

**`slotDrivesEnv` retires here.** A motion piece can currently declare `envRotation: true` to hijack
the environment, and `index.ts` resolves the conflict with an `envDriven` branch that wins over
`tracksPointer`. Composable lighting gives that intent a real home; leaving both would be two ways to
drive one value, with a precedence rule between them.

## 2. `lamp` is an effect piece

```ts
effects: [{ piece: lamp({ source: fromPointer(), radius: 0.5, color: 0xffffff }), target: { kind: 'body', by: 'index' } }]
```

It returns the new `light` channel below, computed from the distance between the lamp's pose and
`part.x` / `part.y`. Because it is an ordinary `EffectPiece`, it merges with `flicker` and `hue`
through the compositor that already exists, and `target` addresses one letter or a selected group.

## 3. A light source is a function

```ts
type LightPose = { x: number; y: number; direction?: number };
type LightSource = (t: number, ctx: FrameCtx) => LightPose;
```

In the word's own layout space — the same em, block-relative space `PartInfo.x/y` uses. Built-ins
`fixed`, `fromPointer(map?)`, `along(path)`, `orbit({ radius, periodMs })`; anything else is a
caller's own function. The cursor is one source among several, not the concept.

## 4. The light channel

`PartOffset` gains one field. It is **not** `gain`.

```ts
interface PartOffset {
  /** Light landing on the part. Lamps sum; rest is no light. */
  light?: { color: number; amount: number };
}
```

**Why not `gain`.** `gain` multiplies `emissiveIntensity` (`word.ts`, `writePart`), and
`DEFAULTS.emissive` is `0x000000`. `spikes/lamp-falloff.mjs` rendered every look with the lamp on and
off and compared md5s: on `body` parts a gain multiplier is a **byte-identical no-op on seven of
eight looks**. Only `neon` responds, because only `neon` ships a non-black emissive. On `run` parts
only `tubing` and `piping` respond, and they respond by borrowing `neon`'s emissive through their
decoration.

**How it resolves.** The lamp's light is multiplied by the property that carries the look's hue, and
added onto that look's base emissive:

```
emissive = base.emissive + lampColor × hueOf(look) × amount
```

`hueOf` is `tintTargetOf` (`looks.ts`), which already exists to answer this question for `tint`:
`attenuationColor` when the look transmits, `emissive` when it has one, `color` otherwise.

`spikes/lamp-blend.mjs` rendered the candidates side by side. Multiplying by the look's hue is the
only one that keeps each material's identity: `gold` lights to bright gold rather than cream,
`chrome` keeps its blue-steel cast, and `gem` lights **crimson** — its `color` is white and its red
lives in `attenuationColor`, so both plain-additive and multiply-by-`color` wash it out.

Additive from zero, never a baseline the lamp scales. A constant emissive that `gain` multiplies is
present on every part whether the lamp reaches it or not, and it flattens `gold` to gray plastic.

## 5. `FrameCtx`

One value passed to both `env` pieces and light sources:

```ts
interface FrameCtx {
  /** −1..1 over the canvas box. */
  pointer: { x: number; y: number } | null;
  /** The same pointer projected into the word's layout space. */
  pointerInWord: { x: number; y: number } | null;
  dt: number;
}
```

`null` until the pointer has been inside — a fresh load, an iframe scrolled past, a touch device
nobody has touched. `track` holds the static pose there and a lamp contributes nothing, which is
today's behavior kept.

**This fixes a shipped bug.** `PointerLight.aimAt` normalizes against
`globalThis.innerWidth/innerHeight` — the viewport, never the canvas box. Under
`placement: element`, an anchored sign in a 400px box on a 1600px page only ever sees a slice of the
yaw range, and a cursor dead-centre on the type does not centre the highlight.

## Out of scope

**Construction × material.** `LookName` fuses two orthogonal axes — materials (`gold`, `chrome`,
`gem`, …) and constructions (`tubing`, `piping`, `sequin`), with the constructions hard-coding
`neon`'s emissive. That decomposition is its own design. Lighting does not depend on it: the `light`
channel resolves per material however looks end up categorized.

**Real three.js lights.** A `PointLight` in the scene is physically correct for `gem` and `gold` and
invisible on emissive tubing, and it is not a pure function. Worth a spike for ambience; not an API
here.

## Traps

**`envMapIntensity` is inert, and that is a shipped bug.** klieg lights through `scene.environment`,
so no material owns an `envMap` — and `material.envMapIntensity` only scales a material's *own* map.
`looks.ts` constructs every material with `envMapIntensity: 2.2` and that value has never been
applied: `spikes/lamp-blend.mjs --blends envown --env 1` reproduces the shipped render byte for byte.
Every look has been rendering at an effective env intensity of 1.

Assigning the scene's environment texture to the material makes the knob live, which gives lighting
a second, more honest channel than emissive — **for metals**. Gold holds its hue from `env=2.2`
through `14` and simply gets brighter, where an emissive add pushes it toward cream.

**It is the wrong knob for `gem`, in the opposite direction.** At `env=0` gem reads red — the
`attenuationColor` is doing its job. Raising env adds specular reflection *over* that, and the red
washes to blue-gray. So gem is red-but-dark at low env and bright-but-gray at high env; one
intensity cannot give both, and a lamp that only raises env desaturates the stone it is lighting.
Transmissive looks need a channel that raises transmitted light rather than reflected.

**Adding onto existing emissive, not replacing it.** `neon` has its own glow. A lamp that assigns
`material.emissive` deletes it everywhere the lamp does not reach.

**Three part topologies, not one.** Run parts are built only from the tube pipeline
(`word.ts`, from `tubeBlueprints` and `litMeshes`), so `sequin` — decoration `kind: 'chunks'` —
produces **zero** of them and no run-targeted lamp reaches it. Its `body` is the wrong target too: a
near-black `0x2a0f1c` backing under the disc field that carries the whole look.

Lighting `sequin` means a `'chunk'` `PartKind` addressing the letter's `InstancedMesh`. That is
cheaper than it sounds — `createMaterial()` runs per letter, so each letter's chunk field already
owns its material. Only lighting *individual* sequins needs `instanceColor`.

**Layout space is not centered on zero.** `KLIEG` gives `x ∈ [-1.72, 0.89]`, `y = 0` on every part.
`fromPointer`'s mapping must read the word's real extent rather than assume a symmetric range, and
`y` only earns its keep on multi-line blocks.

## Testing

Pieces, sources and the merge are pure functions of `(t, part, ctx)` with no GL, so they unit-test
directly — including the falloff at the centre, at the radius and beyond it, and that layered lamps
sum.

What unit tests cannot see is whether any of it reaches the screen. That is what caught the `gain`
no-op, and only a rendered md5 comparison caught it: the effect ran, the compositor merged, the
material was written, and the image did not change. Every look the lamp claims to light needs a
lamp-on/lamp-off render that differs.
